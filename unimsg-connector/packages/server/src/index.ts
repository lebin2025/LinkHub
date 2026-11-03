/**
 * 服务入口：装配依赖 → 创建应用 → 挂 WebSocket → 监听端口。
 */
import http from 'node:http';
import { Platform } from '@unimsg/shared';
import { createApp } from './app';
import { config, modeOf } from './config';
import { InMemoryRepository } from './db/repository';
import { connectors } from './connectors/registry';
import { LlmService } from './services/llm';
import { OcrService } from './services/ocr';
import { RateLimiter } from './services/rateLimiter';
import { MessageService } from './services/message';
import { startDingtalkStream } from './stream/dingtalkStream';
import { startMailPoller } from './stream/mailPoller';
import { initWs, wsBroadcast } from './ws';

const repo = new InMemoryRepository();
const svc = new MessageService(
  repo,
  connectors,
  new LlmService(),
  new OcrService(),
  new RateLimiter(config.sendMaxRetry, config.retryBaseMs),
  wsBroadcast,
);

const app = createApp(svc);
const server = http.createServer(app);
initWs(server);

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
    console.log(`[unimsg] 邮箱账号: ${config.mail.accounts.map((a) => `${a.label}<${a.address}>[${a.folders.join(',')}]`).join(' / ')}`);
  }
  console.log('[unimsg] 自检: pnpm run doctor（凭据/网络/出口IP/修复建议一文看清）');
}

server.listen(config.port, () => {
  const store = config.databaseUrl ? 'postgres(未启用·当前内存)' : 'memory';
  console.log(`[unimsg] server listening on :${config.port} (store=${store})`);
  console.log(`[unimsg] auth=Bearer ${config.apiToken === 'dev-token' ? 'dev-token(默认)' : '***'}`);
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
