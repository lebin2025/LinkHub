import { Router } from 'express';
import { snapshot } from '../core/metrics';
import { MessageService } from '../services/message';

export function healthRouter(svc: MessageService) {
  const r = Router();
  r.get('/health', (_req, res) => {
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      ...snapshot(),
      dlq: svc.listDlq().length,
    });
  });
  return r;
}
