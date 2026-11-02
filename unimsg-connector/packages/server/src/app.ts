/**
 * Express 应用工厂：健康检查（公共）、Webhook（平台验签）、业务接口（Bearer 鉴权）。
 */
import express from 'express';
import cors from 'cors';
import { MessageService } from './services/message';
import { healthRouter } from './routes/health';
import { webhookRouter } from './routes/webhook';
import { messagesRouter } from './routes/messages';
import { apiAuth } from './middlewares/auth';

export function createApp(svc: MessageService) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', healthRouter(svc)); // 公共
  app.use('/api', webhookRouter(svc)); // 平台验签
  app.use('/api', apiAuth, messagesRouter(svc)); // Bearer 鉴权

  return app;
}
