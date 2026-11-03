/**
 * 服务入口：装配依赖 → 创建应用 → 挂 WebSocket → 监听端口。
 */
import http from 'node:http';
import { Platform } from '@unimsg/shared';
import { createApp, formatListenError, parseCorsOrigins } from './app';
import { config, modeOf } from './config';
import { DEFAULT_DEV_TOKEN, apiTokenWarning, productionTokenBlocker, resolveApiToken } from './middlewares/auth';
import { InMemoryRepository } from './db/repository';
import { connectors } from './connectors/registry';
import { maskAddress } from './services/account';
import { LlmService } from './services/llm';
import { OcrService } from './services/ocr';
import { RateLimiter } from './services/rateLimiter';
import { MessageService } from './services/message';
import { startDingtalkStream } from './stream/dingtalkStream';
import { startMailPoller } from './stream/mailPoller';
import { initWs, wsBroadcast } from './ws';

// 空 API_TOKEN 视同未配置 → 回退 dev-token（绝不因此关闭鉴权）
const effectiveToken = resolveApiToken(config.apiToken);

// 生产环境安全闸门：拒绝把默认演示令牌带到线上（宁可启动失败，也不裸奔）。
// 传原始 env 值，便于区分「API_TOKEN 没填/空串」与「还写着 dev-token」。
const tokenBlocker = productionTokenBlocker(process.env.API_TOKEN, process.env.NODE_ENV);
if (tokenBlocker) {
  console.error(`[unimsg] ${tokenBlocker}`);
  process.exit(1);
}

const repo = new InMemoryRepository();
const svc = new MessageService(
  repo,
  connectors,
  new LlmService(),
  new OcrService(),
  new RateLimiter(config.sendMaxRetry, config.retryBaseMs),
  wsBroadcast,
);

const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
const app = createApp(svc, { corsOrigins });
const server = http.createServer(app);
const wss = initWs(server);

/** 启动时把"每个平台现在走真实还是 Mock、缺什么"打印成人话 */
function logRuntime(): void {
  const rows = Object.values(Platform).map((p) => {
    const r = config.runtime[p];
    const cap = `${r.canReceive ? '收✓' : '收✗'} ${r.canSend ? '发✓' : '发✗'}`;
    return `${r.label}=${r.mode}(${r.policy}) ${cap}`;
  });
  console.log(`[unimsg] 运行模式: ${rows.join(' | ')}`);
  for (const p of Object.values(Platform)) {
    const r = config.runtime[p];
    for (const w of r.warnings) console.warn(`[unimsg] ${r.label}: ${w}`);
  }
  for (const w of config.modeWarnings) console.warn(`[unimsg] 配置提示: ${w}`);
  const missing = Object.values(Platform)
    .map((p) => ({ r: config.runtime[p], names: config.runtime[p].missing }))
    .filter((x) => x.r.mode === 'real' && x.r.missing.length > 0);
  for (const x of missing) {
    console.warn(`[unimsg] ${x.r.label} 真实模式缺配置: ${x.names.join(' / ')}（可运行 pnpm run doctor 自检）`);
  }
  if (config.mail.accounts.length > 0) {
    // 地址脱敏后再打印：日志会被贴进 issue/截图，绝不暴露完整邮箱
    console.log(`[unimsg] 邮箱账号: ${config.mail.accounts.map((a) => `${a.label}<${maskAddress(a.address)}>[${a.folders.join(',')}]`).join(' / ')}`);
  }
  console.log('[unimsg] 自检: pnpm run doctor（凭据/网络/出口IP/修复建议一文看清）');
}

/**
 * 监听地址：不填 = Node 默认（等价监听所有网卡，Docker / 局域网演示保持原行为）；
 * 需要收紧暴露面时设 SERVER_HOST=127.0.0.1，只允许本机访问。
 */
const listenHost = process.env.SERVER_HOST?.trim() || undefined;
const displayHost = !listenHost || listenHost === '0.0.0.0' || listenHost === '::'
  ? '127.0.0.1'
  : listenHost;

// 端口占用/权限不足等启动失败必须说人话，而不是甩一段英文调用栈。
// 注意 ws 库会把 http server 的 'error' 转发到 WebSocketServer，两边都要挂监听，
// 否则会变成 unhandled 'error' 的英文栈。
const onListenError = (err: NodeJS.ErrnoException): void => {
  console.error(formatListenError(err, config.port));
  process.exit(1);
};
server.on('error', onListenError);
wss.on('error', onListenError);

server.listen(config.port, listenHost, () => {
  const store = config.databaseUrl ? 'postgres(未启用·当前内存)' : 'memory';
  console.log(`[unimsg] server listening on ${listenHost ?? '0.0.0.0'}:${config.port} (store=${store})`);
  console.log(`[unimsg] 本机访问: http://${displayHost}:${config.port}`);
  console.log(`[unimsg] auth=Bearer ${effectiveToken === DEFAULT_DEV_TOKEN ? 'dev-token(默认/空值回退)' : '***'}`);
  const tokenWarning = apiTokenWarning(config.apiToken);
  if (tokenWarning) {
    console.warn('[unimsg] ============================================================');
    console.warn(`[unimsg] ⚠️ 安全警告：${tokenWarning}`);
    console.warn('[unimsg] ============================================================');
  }
  if (corsOrigins) {
    console.log(`[unimsg] CORS 白名单: ${corsOrigins.join(', ')}（未列出的浏览器 Origin 会被 403）`);
  }
  logRuntime();
});

if (config.dingtalkStream) {
  if (modeOf(Platform.DINGTALK) === 'real') {
    startDingtalkStream(svc).catch((e) => {
      console.error('[stream] 启动失败:', e instanceof Error ? e.message : e);
    });
  } else {
    console.log('[stream] 钉钉当前为 Mock 模式，跳过 Stream 长连接（DINGTALK_MODE=real 才会连）');
  }
}

startMailPoller(svc);
