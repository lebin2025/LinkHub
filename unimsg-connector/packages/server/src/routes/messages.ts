import { Router } from 'express';
import { Platform, MsgStatus } from '@unimsg/shared';
import { MessageService } from '../services/message';
import { listAccounts } from '../services/account';

export function messagesRouter(svc: MessageService) {
  const r = Router();

  r.get('/accounts', (_req, res) => {
    res.json({ ok: true, data: listAccounts() });
  });

  // 全链路回放：消息 + 闭环日志
  r.get('/messages/trace/:traceId', (req, res) => {
    const traceId = req.params.traceId;
    res.json({ ok: true, data: svc.getTrace(traceId), log: svc.getLoopLog(traceId) });
  });

  r.get('/messages', (req, res) => {
    const platform = typeof req.query.platform === 'string' ? (req.query.platform as Platform) : undefined;
    const status = typeof req.query.status === 'string' ? (req.query.status as MsgStatus) : undefined;
    res.json({ ok: true, data: svc.list({ platform, status }) });
  });

  r.get('/messages/:id', (req, res) => {
    const m = svc.get(req.params.id);
    if (!m) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    res.json({ ok: true, data: m });
  });

  // 异步回写：202 + 入队即返回 processing，结果经 WS 推送
  r.post('/messages/:id/reply', async (req, res) => {
    const text = String((req.body as { text?: string })?.text ?? '').trim();
    if (!text) {
      res.status(400).json({ ok: false, error: 'text required' });
      return;
    }
    try {
      const ack = await svc.reply(req.params.id, text);
      res.status(202).json({ ok: true, ...ack });
    } catch {
      res.status(404).json({ ok: false, error: 'not found' });
    }
  });

  r.post('/messages/:id/done', async (req, res) => {
    try {
      await svc.markDone(req.params.id);
      res.json({ ok: true });
    } catch {
      res.status(404).json({ ok: false, error: 'not found' });
    }
  });

  return r;
}
