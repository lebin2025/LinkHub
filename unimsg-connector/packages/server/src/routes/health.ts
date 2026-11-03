import { Router } from 'express';
import { Platform } from '@unimsg/shared';
import { snapshot } from '../core/metrics';
import { config } from '../config';
import { MessageService } from '../services/message';

export function healthRouter(svc: MessageService) {
  const r = Router();
  r.get('/health', (_req, res) => {
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      ...snapshot(),
      dlq: svc.listDlq().length,
      // 公开接口也带上每个平台的实际通道，评审 curl 一下就能知道现在是不是真的
      modes: Object.fromEntries(Object.values(Platform).map((p) => [p, config.runtime[p].mode])),
    });
  });
  return r;
}
