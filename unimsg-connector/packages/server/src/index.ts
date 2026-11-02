/**
 * 服务入口：装配依赖 → 创建应用 → 挂 WebSocket → 监听端口。
 */
import http from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { InMemoryRepository } from './db/repository';
import { connectors } from './connectors/registry';
import { LlmService } from './services/llm';
import { OcrService } from './services/ocr';
import { RateLimiter } from './services/rateLimiter';
import { MessageService } from './services/message';
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

server.listen(config.port, () => {
  const store = config.databaseUrl ? 'postgres(未启用·当前内存)' : 'memory';
  console.log(`[unimsg] server listening on :${config.port} (mock=${config.mock}, store=${store})`);
  console.log(`[unimsg] auth=Bearer ${config.apiToken === 'dev-token' ? 'dev-token(默认)' : '***'}`);
});
