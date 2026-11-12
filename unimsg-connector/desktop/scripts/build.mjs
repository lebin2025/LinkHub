#!/usr/bin/env node
/**
 * LinkHub 桌面版构建脚本（Windows 便携 App）。
 *
 * 产物：desktop/dist/LinkHub/（双击 LinkHub.exe 即用）+ desktop/dist/LinkHub-<ver>-win-x64.zip
 *
 * 流程：
 *   1) web 构建：Vite 产出同源前端（VITE_API_BASE=/ + 随机本机 token，烤进 bundle）
 *   2) server 打包：esbuild 把 packages/server 打成单文件 server/server.cjs（内含 express/ws/dingtalk-stream/飞书 SDK）
 *   3) Electron 运行时：从 npmmirror 镜像下载 win32-x64 版（缓存在 desktop/.cache，不进仓库）
 *   4) 组装：electron 运行时 + resources/app（主进程/服务/前端/配置模板），electron.exe 改名 LinkHub.exe
 *   5) 品牌化：resedit 写入图标与版本信息（纯 JS，无需 rcedit 外部工具）
 *   6) 打包 zip
 *
 * 用法（在 unimsg-connector/ 下）：pnpm app:build
 *   node desktop/scripts/build.mjs [--skip-web] [--skip-zip] [--zip-only]
 * 环境变量：ELECTRON_VERSION（默认 33.2.0）、ELECTRON_MIRROR（默认 npmmirror）
 */
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// build.mjs 是 ESM：需要 require 的地方（esbuild / resedit 是 CJS 包）走 createRequire
const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const unimsgRoot = path.resolve(desktopRoot, '..');
const repoRoot = path.resolve(unimsgRoot, '..');
const distRoot = path.join(desktopRoot, 'dist');
const appDir = path.join(distRoot, 'app');
const runtimeDir = path.join(distRoot, 'LinkHub');
const cacheDir = path.join(desktopRoot, '.cache');
const electronVersion = (process.env.ELECTRON_VERSION || '33.2.0').trim();
const electronPlatform = 'win32-x64';
const tokenPlaceholder = '__LINKHUB_DESKTOP_TOKEN__';

/** 下载脚本：独立 node 进程执行，避免大文件下载阻塞构建主流程 */
const DOWNLOAD_SCRIPT = `
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
(async () => {
  const [url, out] = process.argv.slice(1);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(out + '.part'));
  fs.renameSync(out + '.part', out);
  console.log('downloaded', fs.statSync(out).size, 'bytes ->', out);
})().catch((e) => { console.error('download failed:', e.message); process.exit(1); });
`;

const args = new Set(process.argv.slice(2));
const skipWeb = args.has('--skip-web');
const skipZip = args.has('--skip-zip');
const zipOnly = args.has('--zip-only');
/** 轻量版：不打包 Electron（避开 Windows 11 智能应用控制对未签名 exe 的拦截），
 *  改为 已签名 node.exe + Edge/Chrome App 模式窗口，效果接近桌面 App 且可直接运行。 */
const liteMode = args.has('--lite');

function log(step, msg) {
  console.log(`[desktop] ${step} ${msg}`);
}
function fail(msg) {
  console.error(`[desktop] ✖ ${msg}`);
  process.exit(1);
}
function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}
function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 0) 环境检查
// ---------------------------------------------------------------------------
if (process.platform !== 'win32' && !process.env.LINKHUB_ALLOW_CROSS_BUILD) {
  fail('当前脚本只针对 Windows 便携包；其它平台构建请设置 LINKHUB_ALLOW_CROSS_BUILD=1 并自行解决交叉打包');
}
if (!fs.existsSync(path.join(unimsgRoot, 'package.json'))) fail(`找不到 monorepo 根：${unimsgRoot}`);

const desktopPkg = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const appVersion = desktopPkg.version || '1.0.0';

// 本机专用随机 token：web bundle 与内嵌 server 共用（只监听 127.0.0.1，不对外暴露）
const token = `linkhub-desktop-${crypto.randomBytes(18).toString('hex')}`;

// ---------------------------------------------------------------------------
// 1) 前端构建（同源部署）
// ---------------------------------------------------------------------------
if (!zipOnly) {
  // 只清理本次要重建的子目录：让 Electron 版与轻量版可以共存于 dist/
  fs.mkdirSync(distRoot, { recursive: true });
  rmrf(appDir);
  fs.mkdirSync(appDir, { recursive: true });

  if (!skipWeb) {
    const webOut = path.join(appDir, 'web');
    const webCache = path.join(cacheDir, 'vite-cache');
    log('web', '构建前端（VITE_API_BASE=/ 同源 + 本机 token）…');
    const pnpm = process.env.LINKHUB_PNPM || (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
    const res = spawnSync(pnpm, ['--filter', '@unimsg/web', 'build'], {
      cwd: unimsgRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        VITE_API_BASE: '/',
        VITE_API_TOKEN: token,
        WEB_OUT_DIR: webOut,
        WEB_CACHE_DIR: webCache,
      },
    });
    if (res.status !== 0) fail(`前端构建失败（exit=${res.status}）。请确认已在 unimsg-connector 下执行过 pnpm install`);
    if (!fs.existsSync(path.join(webOut, 'index.html'))) fail('前端构建产物缺少 index.html');
    const hasToken = walkFiles(webOut).some(
      (f) => f.endsWith('.js') && fs.readFileSync(f, 'utf8').includes(token),
    );
    log('web', `完成：${walkFiles(webOut).length} 个文件`);
    if (!hasToken) {
      fail('构建产物里没有找到本次 token —— 说明 VITE_API_TOKEN 未生效（检查 packages/web 是否残留 .env 覆盖）');
    }
  } else {
    log('web', '跳过（--skip-web）');
  }

  // -------------------------------------------------------------------------
  // 2) server 单文件打包
  // -------------------------------------------------------------------------
  log('server', 'esbuild 打包 server 为单文件…');
  const esbuild = require('esbuild');
  const serverOut = path.join(appDir, 'server', 'server.cjs');
  esbuild.buildSync({
    absWorkingDir: unimsgRoot,
    entryPoints: [path.join(unimsgRoot, 'packages', 'server', 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // Electron 33 内置 Node 20：target 固定 node20，避免用到 Electron 运行时不支持的语法
    target: 'node20',
    outfile: serverOut,
    external: ['bufferutil', 'utf-8-validate'],
    define: { 'import.meta.url': '__IMPORT_META_URL__' },
    banner: {
      js: "const __IMPORT_META_URL__ = require('node:url').pathToFileURL(__filename).href;",
    },
    logLevel: 'warning',
  });
  log('server', `完成：${(fs.statSync(serverOut).size / 1024 / 1024).toFixed(2)} MB`);

  // -------------------------------------------------------------------------
  // 3) 组装 resources/app
  // -------------------------------------------------------------------------
  log('app', '复制主进程 / 配置模板 / 图标…');
  const mainSrc = fs.readFileSync(path.join(desktopRoot, 'main.cjs'), 'utf8');
  if (!mainSrc.includes(tokenPlaceholder)) fail('main.cjs 里找不到 token 占位符');
  fs.writeFileSync(path.join(appDir, 'main.cjs'), mainSrc.replaceAll(tokenPlaceholder, token), 'utf8');

  for (const asset of ['icon.ico', 'icon.png']) {
    const src = path.join(desktopRoot, 'assets', asset);
    if (!fs.existsSync(src)) fail(`缺少图标资源：${src}（先运行 pnpm desktop:icon 或 python desktop/scripts/make-icon.py）`);
  }
  fs.mkdirSync(path.join(appDir, 'assets'), { recursive: true });
  for (const asset of ['icon.ico', 'icon.png']) {
    fs.copyFileSync(path.join(desktopRoot, 'assets', asset), path.join(appDir, 'assets', asset));
  }

  fs.mkdirSync(path.join(appDir, 'config'), { recursive: true });
  fs.copyFileSync(path.join(unimsgRoot, '.env.example'), path.join(appDir, 'config', '.env.example'));

  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        name: 'linkhub-desktop-app',
        productName: 'LinkHub',
        version: appVersion,
        description: 'LinkHub 桌面版（多平台连接器与统一消息管理）',
        main: 'main.cjs',
      },
      null,
      2,
    ),
    'utf8',
  );

  // -------------------------------------------------------------------------
  // 3.5) 轻量版：跳过 Electron，组装「已签名 node.exe + App 模式浏览器」版本
  // -------------------------------------------------------------------------
  if (liteMode) {
    const liteDir = buildLite(appDir, token, appVersion);
    if (!skipZip) zipLite(liteDir, appVersion);
    printLiteSummary(liteDir, appVersion);
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // 4) Electron 运行时
  // -------------------------------------------------------------------------
  const zipName = `electron-v${electronVersion}-${electronPlatform}.zip`;
  const zipCache = path.join(cacheDir, 'electron', zipName);
  fs.mkdirSync(path.dirname(zipCache), { recursive: true });
  if (!fs.existsSync(zipCache) || fs.statSync(zipCache).size < 50 * 1024 * 1024) {
    log('electron', `下载运行时 v${electronVersion}（约 110MB，之后走本地缓存）…`);
    const mirrors = [
      process.env.ELECTRON_MIRROR,
      'https://cdn.npmmirror.com/binaries/electron',
      'https://npmmirror.com/mirrors/electron',
    ].filter(Boolean);
    let ok = false;
    for (const mirror of mirrors) {
      const url = `${mirror.replace(/\/+$/, '')}/v${electronVersion}/${zipName}`;
      try {
        log('electron', `尝试：${url}`);
        const dl = spawnSync(process.execPath, ['-e', DOWNLOAD_SCRIPT, url, zipCache], {
          stdio: 'inherit',
          env: process.env,
        });
        if (dl.status === 0 && fs.existsSync(zipCache) && fs.statSync(zipCache).size > 50 * 1024 * 1024) {
          ok = true;
          break;
        }
      } catch (e) {
        log('electron', `失败：${e instanceof Error ? e.message : e}`);
      }
    }
    if (!ok) fail('Electron 运行时下载失败：请检查网络，或设置 ELECTRON_MIRROR 指向可用镜像');
  } else {
    log('electron', `使用本地缓存 ${zipCache}`);
  }

  log('electron', '解压并组装运行时…');
  rmrf(runtimeDir);
  fs.mkdirSync(runtimeDir, { recursive: true });
  try {
    execFileSync('tar', ['-xf', zipCache, '-C', runtimeDir], { stdio: 'inherit' });
  } catch {
    // 兜底：Windows PowerShell 解压（老系统没有 bsdtar 时）
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipCache}' -DestinationPath '${runtimeDir}' -Force`],
      { stdio: 'inherit' },
    );
  }
  for (const must of ['electron.exe', 'resources']) {
    if (!fs.existsSync(path.join(runtimeDir, must))) fail(`Electron 运行时不完整：缺少 ${must}`);
  }

  const resourcesApp = path.join(runtimeDir, 'resources', 'app');
  rmrf(resourcesApp);
  copyDir(appDir, resourcesApp);
  const defaultApp = path.join(runtimeDir, 'resources', 'default_app.asar');
  if (fs.existsSync(defaultApp)) fs.rmSync(defaultApp); // 用不到，去掉避免混淆

  // -------------------------------------------------------------------------
  // 5) 品牌化：改 exe 名 + 图标 + 版本信息
  // -------------------------------------------------------------------------
  log('brand', '写入图标与版本信息（resedit）…');
  const oldExe = path.join(runtimeDir, 'electron.exe');
  const newExe = path.join(runtimeDir, 'LinkHub.exe');
  const ResEdit = require('resedit');
  const exeBuf = fs.readFileSync(oldExe);
  const exe = ResEdit.NtExecutable.from(exeBuf);
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(desktopRoot, 'assets', 'icon.ico')));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    1033,
    ico.icons.map((i) => i.data),
  );
  const versionInfoList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (versionInfoList.length > 0) {
    const vi = versionInfoList[0];
    const [maj = 1, min = 0, pat = 0] = appVersion.split('.').map((n) => Number(n) || 0);
    vi.setFileVersion(maj, min, pat, 0);
    vi.setProductVersion(maj, min, pat, 0);
    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        ProductName: 'LinkHub',
        FileDescription: 'LinkHub · 统一消息中心',
        CompanyName: 'LinkHub',
        LegalCopyright: 'LinkHub',
        InternalName: 'LinkHub',
        OriginalFilename: 'LinkHub.exe',
        FileVersion: appVersion,
        ProductVersion: appVersion,
      },
    );
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(newExe, Buffer.from(exe.generate()));
  fs.rmSync(oldExe);

  // -------------------------------------------------------------------------
  // 6) 说明文件
  // -------------------------------------------------------------------------
  const readme = [
    'LinkHub 桌面版（Windows 便携包）',
    '================================',
    '',
    '启动：双击 LinkHub.exe',
    '  · 首次启动会在 %APPDATA%\\LinkHub\\ 自动创建配置与数据目录；',
    '  · 窗口关闭 = 退出 App（本地服务一并停止，不留后台进程）。',
    '',
    '配置：菜单「配置 → 打开配置文件（.env）」',
    `  · 配置文件：%APPDATA%\\LinkHub\\.env`,
    `  · 数据目录：%APPDATA%\\LinkHub\\data（消息/令牌/水位，重装不丢）`,
    `  · 日志文件：%APPDATA%\\LinkHub\\logs\\server.log`,
    '',
    '不填任何账号也能用：四平台自动 Mock，可完整走通「接收 → 处理 → 回写 → 回流 → 回放」演示。',
    '接真实平台：飞书 / 钉钉 / 企业微信 / 邮箱按 .env 模板或 docs/personal-identity.md 填写；',
    '钉钉本人身份需要本机安装官方 dws CLI 并在终端执行 dws auth login（App 会自动探测）。',
    '',
    '安全：本地服务只监听 127.0.0.1，使用每次构建随机生成的入口令牌；数据不上传任何服务器。',
    '本包不含任何真实凭据；升级时直接替换程序目录即可，%APPDATA%\\LinkHub 配置与数据保留。',
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(runtimeDir, 'README.txt'), readme, 'utf8');

  log('app', `组装完成：${runtimeDir}`);
}

// ---------------------------------------------------------------------------
// 7) 打 zip
// ---------------------------------------------------------------------------
if (!skipZip) {
  const zipOut = path.join(distRoot, `LinkHub-${appVersion}-win-x64.zip`);
  if (fs.existsSync(zipOut)) fs.rmSync(zipOut);
  log('zip', '压缩便携包（约 100MB，压缩后 80–100MB）…');
  execFileSync('tar', ['-a', '-cf', zipOut, '-C', distRoot, 'LinkHub'], { stdio: 'inherit' });
  const size = fs.statSync(zipOut).size;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zipOut)).digest('hex');
  log('zip', `完成：${zipOut}`);
  log('zip', `大小：${(size / 1024 / 1024).toFixed(1)} MB`);
  log('zip', `SHA256：${sha}`);
}

log('done', '构建结束');
console.log('');
console.log('  双击运行：' + path.join(runtimeDir, 'LinkHub.exe'));
console.log('  便携 zip ：' + path.join(distRoot, `LinkHub-${appVersion}-win-x64.zip`));
console.log('  用户配置 ：%APPDATA%\\LinkHub\\.env');
console.log('');


// ===========================================================================
// 轻量版（--lite）：已签名 node.exe + Edge/Chrome App 模式
// 适用：Windows 11 开启「智能应用控制」拦截未签名 exe 的机器（Electron 官方二进制无签名）。
// ===========================================================================

function liteReadme(version) {
  return [
    `LinkHub 桌面版（轻量版 v${version}）`,
    '====================================',
    '',
    '启动：双击「启动 LinkHub.vbs」',
    '  · 会以 App 模式打开一个独立窗口（无地址栏/标签页，任务栏是一扇独立窗口）；',
    '  · 关闭该窗口 = 退出 App（后台本地服务会一并停止，不留后台进程）；',
    '  · 不要直接关闭 node.exe 进程（任务管理器里可不看）；一切以窗口为准。',
    '',
    '为什么是「轻量版」而不是 exe：',
    '  这台 Windows 开启了「智能应用控制」（Smart App Control），会拦截未签名的 exe。',
    '  Electron 官方运行时没有数字签名，因此会被系统直接拦截（“应用程序控制策略已阻止此文件”）。',
    '  轻量版改用系统已签名的 node.exe 跑本地服务、用已签名的 Edge/Chrome 以 App 模式开窗口，',
    '  不需要关闭任何系统安全设置即可运行，效果接近普通桌面 App。',
    '',
    '配置：%APPDATA%\\LinkHub\\.env',
    '  · 首次启动自动创建（模板 = 包内 config\\.env.example）；',
    '  · 数据目录：%APPDATA%\\LinkHub\\data（消息 / 飞书令牌 / 水位，重装不丢）；',
    '  · 日志：%APPDATA%\\LinkHub\\logs（启动器 launcher.log + 服务 server.log）。',
    '',
    '不填任何账号也能用：四平台自动 Mock，可完整走通「接收 → 处理 → 回写 → 回流 → 回放」演示。',
    '接真实平台：按 .env 模板或 docs/personal-identity.md 填写；',
    '钉钉本人身份需要本机安装官方 dws CLI 并在终端执行 dws auth login（App 会自动探测）。',
    '',
    '安全：本地服务只监听 127.0.0.1，入口令牌在构建时随机生成；数据不上传任何服务器；',
    '本包不含任何真实凭据。',
    '',
    '想关闭「智能应用控制」用完整 Electron 版（可选）：',
    '  Windows 设置 → 隐私和安全性 → Windows 安全中心 → 应用和浏览器控制 → 智能应用控制 → 关闭。',
    '  注意该设置关闭后需重置系统才能重新开启。普通 Windows（未开启该功能）可直接运行 Electron 版。',
    '',
  ].join('\r\n');
}

function buildLite(appDirPath, buildToken, version) {
  const liteRoot = path.join(distRoot, 'LinkHub-Lite');
  rmrf(liteRoot);
  fs.mkdirSync(liteRoot, { recursive: true });
  log('lite', '组装轻量版（node.exe + App 模式浏览器）…');

  const nodeSrc = process.env.LINKHUB_NODE_EXE || process.execPath;
  if (!/^node(\.exe)?$/i.test(path.basename(nodeSrc))) {
    fail(`当前构建进程不是 node：${nodeSrc}（可设置 LINKHUB_NODE_EXE 指向 node.exe）`);
  }
  const runtimeLite = path.join(liteRoot, 'runtime');
  fs.mkdirSync(runtimeLite, { recursive: true });
  fs.copyFileSync(nodeSrc, path.join(runtimeLite, 'node.exe'));
  log('lite', `内置运行时：${nodeSrc}（${(fs.statSync(path.join(runtimeLite, 'node.exe')).size / 1024 / 1024).toFixed(0)} MB，已签名）`);

  for (const part of ['server', 'web', 'config']) {
    copyDir(path.join(appDirPath, part), path.join(liteRoot, part));
  }
  fs.mkdirSync(path.join(liteRoot, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(desktopRoot, 'assets', 'icon.ico'), path.join(liteRoot, 'assets', 'icon.ico'));

  const launcherSrc = fs.readFileSync(path.join(desktopRoot, 'launcher', 'launcher.ps1'), 'utf8');
  if (!launcherSrc.includes(tokenPlaceholder)) fail('launcher.ps1 里找不到 token 占位符');
  const launcherText = '\uFEFF' + launcherSrc.replaceAll(tokenPlaceholder, buildToken);
  fs.mkdirSync(path.join(liteRoot, 'launcher'), { recursive: true });
  fs.writeFileSync(path.join(liteRoot, 'launcher', 'launcher.ps1'), launcherText, 'utf8');
  fs.copyFileSync(path.join(desktopRoot, 'launcher', '启动 LinkHub.vbs'), path.join(liteRoot, '启动 LinkHub.vbs'));
  fs.writeFileSync(path.join(liteRoot, 'README.txt'), liteReadme(version), 'utf8');

  log('lite', `完成：${liteRoot}`);
  return liteRoot;
}

function zipLite(liteRoot, version) {
  const zipOut = path.join(distRoot, `LinkHub-Lite-${version}-win-x64.zip`);
  if (fs.existsSync(zipOut)) fs.rmSync(zipOut);
  log('zip', '压缩轻量包…');
  execFileSync('tar', ['-a', '-cf', zipOut, '-C', distRoot, path.basename(liteRoot)], { stdio: 'inherit' });
  const size = fs.statSync(zipOut).size;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zipOut)).digest('hex');
  log('zip', `完成：${zipOut}`);
  log('zip', `大小：${(size / 1024 / 1024).toFixed(1)} MB`);
  log('zip', `SHA256：${sha}`);
  return zipOut;
}

function printLiteSummary(liteRoot, version) {
  console.log('');
  console.log('  双击启动：' + path.join(liteRoot, '启动 LinkHub.vbs'));
  console.log('  轻量 zip ：' + path.join(distRoot, `LinkHub-Lite-${version}-win-x64.zip`));
  console.log('  用户配置 ：%APPDATA%\\LinkHub\\.env');
  console.log('');
}

