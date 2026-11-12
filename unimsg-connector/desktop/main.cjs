'use strict';
/**
 * LinkHub 桌面版主进程（Electron）。
 *
 * 形态：双击 LinkHub.exe → 原生窗口；内部自动起一个**只监听 127.0.0.1** 的本地服务
 * （server/server.cjs，esbuild 打好的单文件），窗口加载 http://127.0.0.1:<port>。
 * 对用户来说就是"一个 App"，不需要命令行、不需要浏览器、不需要 Node/pnpm。
 *
 * 关键设计：
 *  - 配置：%APPDATA%\LinkHub\.env（首次启动自动从内置模板创建；菜单「配置」可直接打开编辑）
 *  - 数据：%APPDATA%\LinkHub\data（消息快照 / 飞书用户令牌 / 各平台水位；重装不丢）
 *  - 日志：%APPDATA%\LinkHub\logs\server.log（服务崩溃时弹窗并给出日志尾部）
 *  - 端口：优先 3901（被占用则顺延），只绑定 127.0.0.1，不对外网暴露
 *  - 安全：contextIsolation 开、nodeIntegration 关、sandbox 开；弹窗/外链一律交给系统浏览器
 *  - 退出：关窗即退出，并结束本地服务（含 dws 等子进程：taskkill /T）
 */
const { app, BrowserWindow, Menu, dialog, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

/** 构建脚本会替换成随机 token（web 构建时用同一个值，二者必须一致） */
const DESKTOP_TOKEN = '__LINKHUB_DESKTOP_TOKEN__';
const APP_TITLE = 'LinkHub · 统一消息中心';
const PREFERRED_PORT = Number(process.env.LINKHUB_DESKTOP_PORT || 3901);
const PORT_TRIES = 30;
const STARTUP_TIMEOUT_MS = 30_000;

let mainWindow = null;
let splashWindow = null;
let serverProc = null;
let serverPort = 0;
let logStream = null;
let quitting = false;
let restarting = false;

// ---------------------------------------------------------------------------
// 路径与目录
// ---------------------------------------------------------------------------

function appRoot() {
  // 打包后：<LinkHub>/resources/app；开发时：desktop/
  return app.getAppPath();
}

function paths() {
  const base = app.getPath('userData');
  return {
    base,
    envFile: path.join(base, '.env'),
    dataDir: path.join(base, 'data'),
    logsDir: path.join(base, 'logs'),
    logFile: path.join(base, 'logs', 'server.log'),
  };
}

function ensureUserDirs() {
  const p = paths();
  for (const dir of [p.base, p.dataDir, p.logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // 单份日志过大时滚动一次，避免长期使用无限增长
  try {
    if (fs.existsSync(p.logFile) && fs.statSync(p.logFile).size > 8 * 1024 * 1024) {
      fs.renameSync(p.logFile, `${p.logFile}.1`);
    }
  } catch {
    /* 日志滚动失败不影响启动 */
  }
}

/** .env 里是否显式配置了某个 key（用于决定默认值是否注入） */
function envFileHasKey(file, key) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return new RegExp(`^\\s*${key}\\s*=`, 'm').test(text);
  } catch {
    return false;
  }
}

/**
 * 首次启动：把内置 .env.example 复制成用户配置，并在文件头写清「桌面版说明」。
 * 返回 true 表示本次是首次创建（用于引导提示）。
 */
function ensureUserEnvFile() {
  const p = paths();
  if (fs.existsSync(p.envFile)) return false;
  const template = path.join(appRoot(), 'config', '.env.example');
  let content = '';
  try {
    content = fs.readFileSync(template, 'utf8');
  } catch {
    content = '# LinkHub 配置\n# 平台账号凭据按 .env.example / docs/personal-identity.md 填写\n';
  }
  const header = [
    '# ============================================================',
    '# LinkHub 桌面版用户配置（只在本机生效，不会进仓库/交付包）',
    '#',
    '# · 本文件位置：%APPDATA%\\LinkHub\\.env',
    '# · 改完保存后，菜单「配置 → 重新加载」或重启 App 生效',
    '# · 平台账号填写方法：菜单「帮助 → 打开配置说明」或见仓库 docs/personal-identity.md',
    '# · 不填任何凭据也能用：四平台自动 Mock，可完整走通演示闭环',
    '# ============================================================',
    '',
  ].join('\n');
  fs.writeFileSync(p.envFile, header + content, 'utf8');
  return true;
}

// ---------------------------------------------------------------------------
// 端口 / 本地服务
// ---------------------------------------------------------------------------

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen({ host: '127.0.0.1', port }, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function pickPort() {
  for (let i = 0; i < PORT_TRIES; i += 1) {
    const port = PREFERRED_PORT + i;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
  }
  throw new Error(`端口 ${PREFERRED_PORT}–${PREFERRED_PORT + PORT_TRIES - 1} 均被占用`);
}

function tailLog(lines = 25) {
  try {
    const text = fs.readFileSync(paths().logFile, 'utf8');
    return text.trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '（暂无服务日志）';
  }
}

function appendLogChunk(chunk) {
  if (!logStream) return;
  const stamp = new Date().toISOString();
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line.trim()) logStream.write(`[${stamp}] ${line}\n`);
  }
}

/** 找到 dws.exe（钉钉本人身份可选依赖）：PATH 或 %USERPROFILE%\.local\bin */
function resolveDwsBin() {
  if (process.env.DWS_BIN && process.env.DWS_BIN.trim()) return process.env.DWS_BIN.trim();
  const candidates = [
    path.join(process.env.USERPROFILE || '', '.local', 'bin', 'dws.exe'),
    'dws',
  ];
  for (const candidate of candidates) {
    if (candidate === 'dws') return 'dws'; // 交给 PATH 查找
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return 'dws';
}

function startServer(port) {
  const p = paths();
  ensureUserDirs();
  logStream = fs.createWriteStream(p.logFile, { flags: 'a' });
  logStream.write(`\n===== ${new Date().toISOString()} 启动 LinkHub 桌面版 v${APP_VERSION}（port=${port}）=====\n`);

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    LINKHUB_DESKTOP: '1',
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: String(port),
    // 桌面版使用独立随机令牌（只在本机回环地址上使用），web 构建时已烤入同一个值
    API_TOKEN: DESKTOP_TOKEN,
    WEB_DIST: path.join(appRoot(), 'web'),
    DATA_DIR: p.dataDir,
    DWS_BIN: resolveDwsBin(),
    // 让 doctor/日志里提示的配置路径指向桌面版用户目录
    LINKHUB_CONFIG_FILE: p.envFile,
  };
  // 飞书 OAuth 回调依赖端口：用户没在 .env 里显式配置时，按本次实际端口给出默认值
  if (!envFileHasKey(p.envFile, 'FEISHU_REDIRECT_URI')) {
    env.FEISHU_REDIRECT_URI = `http://localhost:${port}/api/feishu/oauth/callback`;
  }

  const entry = path.join(appRoot(), 'server', 'server.cjs');
  const child = spawn(process.execPath, [entry], {
    cwd: p.base,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', appendLogChunk);
  child.stderr.on('data', appendLogChunk);
  child.on('exit', (code) => {
    if (quitting || restarting) return;
    serverProc = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'error',
        title: 'LinkHub 本地服务已停止',
        message: `本地服务意外退出（退出码 ${code === null ? '未知' : code}）。`,
        detail: `最近日志：\n\n${tailLog(12)}\n\n可先「重启服务」；仍失败请打开日志查看原因。`,
        buttons: ['重启服务', '查看日志', '退出'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (choice === 0) restartServer();
      else if (choice === 1) shell.openPath(paths().logFile);
      else quitApp();
    }
  });
  return child;
}

function stopServer() {
  const child = serverProc;
  serverProc = null;
  if (!child || child.killed) {
    if (logStream) { try { logStream.end(); } catch {} logStream = null; }
    return;
  }
  try {
    if (process.platform === 'win32') {
      // /T 连带结束服务派生的子进程（如 dws 个人事件监听），不留孤儿
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try { child.kill(); } catch {}
  }
  if (logStream) { try { logStream.end(); } catch {} logStream = null; }
}

function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error(`本地服务在 ${Math.round(timeoutMs / 1000)} 秒内没有就绪`));
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const json = await res.json();
          if (json && json.ok) { resolve(json); return; }
        }
      } catch {
        /* 服务还没起来 */
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function startAndLoad() {
  serverPort = await pickPort();
  serverProc = startServer(serverPort);
  showSplash(`正在启动本地服务（端口 ${serverPort}）…`);
  try {
    await waitForHealth(serverPort, STARTUP_TIMEOUT_MS);
  } catch (e) {
    closeSplash();
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'LinkHub 启动失败',
      message: e instanceof Error ? e.message : String(e),
      detail: `最近日志：\n\n${tailLog(15)}`,
      buttons: ['查看日志', '退出'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice === 0) shell.openPath(paths().logFile);
    quitApp();
    return;
  }
  closeSplash();
  createMainWindow(serverPort);
}

function restartServer() {
  restarting = true;
  stopServer();
  restarting = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  mainWindow = null;
  setTimeout(() => {
    if (quitting) return;
    startAndLoad().catch((e) => {
      dialog.showErrorBox('重启失败', e instanceof Error ? e.message : String(e));
    });
  }, 400);
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

const SPLASH_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:#0f172a;color:#e2e8f0;font-family:system-ui,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
  .logo{width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#2563eb,#0ea5e9);
        display:flex;align-items:center;justify-content:center;font-weight:700;font-size:30px;color:#fff;
        box-shadow:0 10px 30px rgba(37,99,235,.35)}
  .title{font-size:18px;font-weight:600;letter-spacing:.5px}
  .sub{font-size:12.5px;color:#94a3b8}
  .bar{width:210px;height:3px;border-radius:2px;background:#1e293b;overflow:hidden}
  .bar>i{display:block;width:40%;height:100%;border-radius:2px;background:linear-gradient(90deg,#2563eb,#0ea5e9);
         animation:slide 1.1s ease-in-out infinite}
  @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}
</style></head><body><div class="wrap">
  <div class="logo">L</div><div class="title">LinkHub · 统一消息中心</div>
  <div class="sub" id="sub">正在启动本地服务…</div><div class="bar"><i></i></div>
</div></body></html>`;

function showSplash(text) {
  if (splashWindow || quitting) return;
  splashWindow = new BrowserWindow({
    width: 420,
    height: 250,
    frame: false,
    resizable: false,
    movable: true,
    show: true,
    backgroundColor: '#0f172a',
    center: true,
  });
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
  splashWindow.webContents.on('did-finish-load', () => {
    if (!splashWindow) return;
    splashWindow.webContents.executeJavaScript(
      `document.getElementById('sub').textContent = ${JSON.stringify(String(text || ''))}`,
    ).catch(() => {});
  });
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = null;
}

function allowInternalUrl(url) {
  try {
    const u = new URL(url);
    const hostOk = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    return hostOk && Number(u.port || '80') === serverPort;
  } catch {
    return false;
  }
}

function createMainWindow(port) {
  const iconPath = path.join(appRoot(), 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    title: APP_TITLE,
    backgroundColor: '#0f172a',
    show: false,
    autoHideMenuBar: false,
    icon: fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  // 外链 / 平台授权页交给系统默认浏览器；应用内只允许访问本地服务
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!allowInternalUrl(url) && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------------------------------------------------------------------
// 菜单
// ---------------------------------------------------------------------------

function openEnvFile() {
  const p = paths();
  if (!fs.existsSync(p.envFile)) ensureUserEnvFile();
  shell.openPath(p.envFile);
}

function showConfigHelp() {
  const p = paths();
  dialog.showMessageBox({
    type: 'info',
    title: 'LinkHub 桌面版配置说明',
    message: '平台账号配置位置',
    detail: [
      `配置文件：${p.envFile}`,
      `数据目录：${p.dataDir}`,
      `日志文件：${p.logFile}`,
      '',
      '· 不填任何凭据 = 四平台 Mock，可完整演示闭环；',
      '· 要接真实平台：按内置模板或 docs/personal-identity.md 填写后，菜单「配置 → 重新加载」；',
      '· 飞书本人身份：账号页点「连接本人账号」完成 OAuth；',
      '· 钉钉本人身份：需本机安装官方 dws CLI 并在终端执行 dws auth login（App 会自动探测）。',
    ].join('\n'),
    buttons: ['打开配置文件', '打开配置文件夹', '关闭'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }).then(({ response }) => {
    if (response === 0) openEnvFile();
    else if (response === 1) shell.openPath(path.dirname(p.envFile));
  });
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '重新加载界面', accelerator: 'F5', click: () => mainWindow && mainWindow.reload() },
        { label: '重启本地服务', click: () => restartServer() },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => quitApp() },
      ],
    },
    {
      label: '配置',
      submenu: [
        { label: '打开配置文件（.env）', click: () => openEnvFile() },
        { label: '打开配置文件夹', click: () => shell.openPath(paths().base) },
        { label: '打开数据文件夹', click: () => shell.openPath(paths().dataDir) },
        { label: '打开日志', click: () => shell.openPath(paths().logFile) },
        { type: 'separator' },
        { label: '查看服务健康状态', click: () => showHealth() },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '配置说明', click: () => showConfigHelp() },
        {
          label: '关于 LinkHub',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '关于 LinkHub',
              message: `LinkHub 桌面版 v${APP_VERSION}`,
              detail: [
                '多平台连接器与统一消息管理（赛题 A）',
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
                '',
                `本地服务端口：${serverPort || '未启动'}`,
                '所有数据只保存在本机，不上传任何服务器。',
              ].join('\n'),
              buttons: ['好'],
              noLink: true,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showHealth() {
  try {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/health`, { signal: AbortSignal.timeout(3000) });
    const json = await res.json();
    const modes = json.modes || {};
    const lines = Object.entries(modes).map(([k, v]) => `${k} = ${v}`).join('\n');
    dialog.showMessageBox({
      type: 'info',
      title: '服务健康状态',
      message: `本地服务运行正常（端口 ${serverPort}）`,
      detail: `各平台通道：\n${lines}\n\n接收 ${json.received ?? 0} · 发送 ${json.sent ?? 0} · 模拟发送 ${json.sentMock ?? 0} · 失败 ${json.failed ?? 0}`,
      buttons: ['好'],
      noLink: true,
    });
  } catch (e) {
    dialog.showMessageBox({
      type: 'warning',
      title: '服务状态异常',
      message: '无法访问本地服务',
      detail: `${e instanceof Error ? e.message : String(e)}\n\n最近日志：\n${tailLog(10)}`,
      buttons: ['好'],
      noLink: true,
    });
  }
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

const APP_VERSION = (() => {
  try {
    return require('./package.json').version || '1.0.0';
  } catch {
    return '1.0.0';
  }
})();

function quitApp() {
  quitting = true;
  stopServer();
  closeSplash();
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.linkhub.desktop');
    const firstRun = ensureUserEnvFile();
    buildMenu();
    startAndLoad()
      .then(() => {
        if (!firstRun) return;
        // 首次启动引导：告知配置位置（不自动导入任何已有 .env，避免把凭据带进 App）
        const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const opts = {
          type: 'info',
          title: '欢迎使用 LinkHub 桌面版',
          message: '已创建本机配置文件',
          detail: [
            `配置文件：${paths().envFile}`,
            '',
            '不填任何凭据也能直接体验完整演示（四平台自动 Mock）。',
            '要接入真实账号：菜单「配置 → 打开配置文件（.env）」，填写后「重启本地服务」。',
            '不会自动复制任何已有工作区的 .env —— 需要时请自行导入该文件。',
          ].join('\n'),
          buttons: ['开始使用'],
          noLink: true,
        };
        (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)).catch(() => {});
      })
      .catch((e) => {
        closeSplash();
        dialog.showErrorBox('LinkHub 启动失败', e instanceof Error ? e.stack || e.message : String(e));
        quitApp();
      });
  });

  app.on('window-all-closed', () => quitApp());
  app.on('before-quit', () => { quitting = true; stopServer(); });
  app.on('will-quit', () => stopServer());

  process.on('uncaughtException', (e) => {
    try {
      dialog.showErrorBox('LinkHub 未捕获错误', e instanceof Error ? e.stack || e.message : String(e));
    } catch {}
  });
}