/**
 * 平台 Webhook 入口：公共接口（用平台签名验签，不用用户 token）。
 * 同一入口既收“新消息”，也收“状态回流事件”（由 service 分流）。
 */
import { Router } from 'express';
import { Platform } from '@unimsg/shared';
import { connectors } from '../connectors/registry';
import { MessageService } from '../services/message';

export function webhookRouter(svc: MessageService) {
  const r = Router();
  r.post('/webhook/:platform', async (req, res) => {
    const platform = req.params.platform as Platform;
    const connector = connectors[platform];
    if (!connector) {
      res.status(404).json({ ok: false, error: 'unknown platform' });
      return;
    }

    let body: unknown = req.body;
    try {
      if (connector.decrypt) body = connector.decrypt(body);
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'decrypt failed' });
      return;
    }

    // 飞书配置回调地址时会发 url_verification，需要原样返回 challenge
    const handshake = connector.challenge?.(body);
    if (handshake !== undefined) {
      res.json(handshake);
      return;
    }

    const sig = (req.headers['x-signature'] as string)
      ?? (typeof req.query.sig === 'string' ? req.query.sig : 'mock');
    if (!connector.verify(body, sig, req.headers)) {
      res.status(401).json({ ok: false, error: 'verify failed' });
      return;
    }
    try {
      const result = await svc.onPlatformEvent(platform, body);
      // 企微回调要求返回明文 success，否则会重试
      if (platform === Platform.WECOM) {
        res.type('text/plain').send('success');
        return;
      }
      res.status(200).json({ ok: true, duplicate: result.duplicate ?? false });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'error' });
    }
  });
  return r;
}
