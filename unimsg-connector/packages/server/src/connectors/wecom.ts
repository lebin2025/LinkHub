/**
 * 企业微信连接器（Mock 先行）。
 *
 * 字段命名与飞书/钉钉不同（Content / FromUserName / MsgId），
 * 但同样收敛成 UnifiedMessage，证明"新增平台只加一个文件"即可等价接入。
 */
import {
  Platform, MsgStatus, UnifiedMessage, PlatformConnector,
} from '@unimsg/shared';
import { config } from '../config';
import { genTraceId, mockSend, verifyMock, inferType } from './base';

export function receive(raw: unknown): UnifiedMessage {
  const r = raw as any;
  const text = r?.Content ?? r?.content ?? '';
  const senderId = r?.FromUserName ?? 'unknown';
  const now = new Date().toISOString();
  const type = r?.MsgType === 'image' ? 'image'
    : r?.MsgType === 'file' ? 'file' : inferType(text);
  return {
    traceId: genTraceId(),
    platform: Platform.WECOM,
    externalId: r?.MsgId ?? 'unknown',
    sender: { id: senderId, name: senderId },
    type,
    body: String(text),
    status: MsgStatus.RECEIVED,
    createdAt: now,
    updatedAt: now,
  };
}

export function convert(msg: UnifiedMessage): unknown {
  return { msgtype: 'text', text: { content: msg.body } };
}

export async function send(msg: UnifiedMessage): Promise<{ ok: boolean }> {
  const payload = convert(msg);
  if (config.mock) return mockSend(Platform.WECOM, payload);
  // TODO(real): 用 WECOM_CORP_ID + secret 换 access_token，调应用消息发送
  throw new Error('wecom real send 未配置：请置 MOCK=false 并填写 WECOM_* 后由真实适配器实现');
}

export function verify(_payload: unknown, sig: string): boolean {
  if (config.mock) return verifyMock(sig);
  // TODO(real): 校验 WECOM_TOKEN 的 SHA1 签名
  return false;
}

export const wecomConnector: PlatformConnector = { verify, receive, send, convert };
