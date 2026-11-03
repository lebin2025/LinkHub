/**
 * Express 应用工厂：健康检查（公共）、Webhook（平台验签）、业务接口（Bearer 鉴权）。
 *
 * 启动体验相关（CORS 白名单 / 监听错误人话提示）也放在这里：
 * 都是无副作用的纯函数，index.ts 与单测共用，避免为了测试去 import 有启动副作用的入口文件。
 */
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import cors from 'cors';
import { MessageService } from './services/message';
import { healthRouter } from './routes/health';
import { webhookRouter } from './routes/webhook';
import { messagesRouter } from './routes/messages';
import { apiAuth } from './middlewares/auth';

/**
 * 解析 CORS_ORIGINS（逗号分隔）。不填/全是空白 → null，表示保持 `*` 全放行（兼容本地演示）。
 * 例：CORS_ORIGINS=http://localhost:5173,https://demo.example.com
 */
export function parseCorsOrigins(raw: string | undefined): string[] | null {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/**
 * 白名单模式下，带 Origin 的跨域请求必须是名单内的才放行；
 * 没有 Origin 的请求（curl / 服务端到服务端 / 同源）一律放行，否则会误伤现有调用方。
 */
function corsWhitelistGuard(origins: string[] | null): RequestHandler {
  return (req, res, next) => {
    if (!origins) return next(); // 未配置白名单：保持原 * 行为
    const origin = req.headers.origin;
    if (!origin) return next();
    if (origins.includes(origin)) return next();
    res.status(403).json({
      ok: false,
      error: `Origin 不在 CORS 白名单内：${origin}（如需放行，请在 .env 的 CORS_ORIGINS 中追加，逗号分隔）`,
    });
  };
}

/** 请求体解析失败（畸形 JSON / 超大）时给可读 JSON，而不是 Express 默认的 HTML 报错页 */
const bodyErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  const type = (err as { type?: string } | undefined)?.type;
  if (type === 'entity.parse.failed') {
    res.status(400).json({ ok: false, error: '请求体不是合法 JSON（检查 Content-Type 与 JSON 语法）' });
    return;
  }
  if (type === 'entity.too.large') {
    res.status(413).json({ ok: false, error: '请求体超过 2MB 限制' });
    return;
  }
  next(err);
};

export interface CreateAppOptions {
  /**
   * CORS 白名单：传数组 = 只放行这些 Origin；传 null = 保持 `*`；
   * 不传 = 读取环境变量 CORS_ORIGINS（不填等价 null）。
   */
  corsOrigins?: string[] | null;
}

export function createApp(svc: MessageService, options: CreateAppOptions = {}) {
  const origins = options.corsOrigins !== undefined
    ? options.corsOrigins
    : parseCorsOrigins(process.env.CORS_ORIGINS);

  const app = express();
  app.use(corsWhitelistGuard(origins));
  // 白名单模式只回显名单内的 Origin；未配置则沿用 `*`（本地演示/旧调用方零改动）
  app.use(cors(origins ? { origin: origins } : {}));
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', healthRouter(svc)); // 公共
  app.use('/api', webhookRouter(svc)); // 平台验签
  app.use('/api', apiAuth, messagesRouter(svc)); // Bearer 鉴权

  // 必须挂在最后：才能兜住 app 级 json 与路由级 text 解析器的报错
  app.use(bodyErrorHandler);

  return app;
}

/**
 * 把 `server.listen` 的报错翻译成中文可操作提示（index.ts 启动失败时打印）。
 * 纯函数：单测直接传入 ErrnoException 即可，不需要真的占端口。
 */
export function formatListenError(error: NodeJS.ErrnoException, port: number): string {
  const code = error?.code;
  if (code === 'EADDRINUSE') {
    return [
      `[unimsg] 启动失败：端口 ${port} 已被占用。`,
      '  改 .env 里的 SERVER_PORT 换一个端口；或结束占用这个端口的进程：',
      `    Windows: netstat -ano | findstr :${port}   然后  taskkill /PID <pid> /F`,
      `    macOS/Linux: lsof -i :${port}   然后  kill <pid>`,
    ].join('\n');
  }
  if (code === 'EACCES') {
    return [
      `[unimsg] 启动失败：没有权限监听端口 ${port}（EACCES）。`,
      '  1024 以下的端口需要管理员/root 权限；或改 .env 的 SERVER_PORT 用 3001 这类高端口。',
    ].join('\n');
  }
  if (code === 'EADDRNOTAVAIL') {
    return [
      `[unimsg] 启动失败：监听地址不可用（EADDRNOTAVAIL）。`,
      '  检查 .env 的 SERVER_HOST 是否写成了本机不存在的网卡地址；留空 = 监听所有网卡。',
    ].join('\n');
  }
  return `[unimsg] 启动失败（${code ?? 'UNKNOWN'}）：${error?.message ?? String(error)}`;
}
