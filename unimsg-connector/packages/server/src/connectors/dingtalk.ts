/**
 * 钉钉连接器（Mock 先行）。
 *
 * 钉钉真实回调是 AES 加密的，这里用简化 JSON 结构演示字段映射；
 * receive/convert/send/verify 四件套与飞书对称，保证三平台等价接入。
 */
import {
  Platform, MsgStatus, UnifiedMessage, PlatformConnector,
} from '@unimsg/shared';
import { config } from '../config';
import { genTraceId, mockSend, verifyMock, inferType } from './base';

export function receive(raw: unknown): UnifiedMessage {
  const r = raw as any;
  const text = r?.text?.content ?? r?.content ?? '';
  const senderId = r?.senderId ?? 'unknown';
  const now = new Date().toISOString();
  const type = r?.msgtype === 'image' ? 'image'
    : r?.msgtype === 'file' ? 'file' : inferType(text);
  return {
    traceId: genTraceId(),
    platform: Platform.DINGTALK,
    externalId: r?.msgId ?? 'unknown',
    sender: { id: senderId, name: r?.senderNick ?? senderId },
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
  if (config.mock) return mockSend(Platform.DINGTALK, payload);
  // TODO(real): 用 DINGTALK_APP_SECRET 换 access_token，调 robot 消息发送
  throw new Error('dingtalk real send 未配置：请置 MOCK=false 并填写 DINGTALK_* 后由真实适配器实现');
}

export function verify(_payload: unknown, sig: string): boolean {
  if (config.mock) return verifyMock(sig);
  // TODO(real): 校验 AES 解密 + token 签名
  return false;
}

export const dingtalkConnector: PlatformConnector = { verify, receive, send, convert };
