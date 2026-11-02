/**
 * 飞书连接器（Mock 先行）。
 *
 * receive：解析飞书 im.message.receive_v1 回调（简化版）-> 统一消息。
 * convert：统一消息 -> 飞书发送格式（msg_type/content）。
 * send   ：MOCK=true 时写入 sentBox；否则调用飞书开放 API（待真密钥接入）。
 * verify ：MOCK=true 时宽松验签；否则按飞书规则校验签名（待补）。
 */
import {
  Platform, MsgStatus, UnifiedMessage, PlatformConnector,
} from '@unimsg/shared';
import { config } from '../config';
import { genTraceId, mockSend, verifyMock, inferType } from './base';

function safeParse(content: unknown): any {
  if (typeof content !== 'string') return content;
  try { return JSON.parse(content); } catch { return content; }
}

export function receive(raw: unknown): UnifiedMessage {
  const r = raw as any;
  const m = r?.event?.message ?? {};
  const content = safeParse(m.content);
  const text = typeof content === 'object' && content
    ? (content.text ?? content.title ?? '')
    : String(content ?? '');
  const senderId = m.sender?.sender_id?.user_id ?? 'unknown';
  const now = new Date().toISOString();
  const kind = m.message_type;
  const type = kind === 'image' ? 'image' : kind === 'file' ? 'file' : inferType(text);
  return {
    traceId: genTraceId(),
    platform: Platform.FEISHU,
    externalId: m.message_id ?? 'unknown',
    sender: { id: senderId, name: senderId },
    type,
    body: text,
    status: MsgStatus.RECEIVED,
    createdAt: now,
    updatedAt: now,
  };
}

export function convert(msg: UnifiedMessage): unknown {
  return { msg_type: 'text', content: { text: msg.body } };
}

export async function send(msg: UnifiedMessage): Promise<{ ok: boolean }> {
  const payload = convert(msg);
  if (config.mock) return mockSend(Platform.FEISHU, payload);
  // TODO(real): 用 FEISHU_APP_SECRET 换 tenant_access_token，调 im/v1/messages 发送
  throw new Error('feishu real send 未配置：请置 MOCK=false 并填写 FEISHU_* 后由真实适配器实现');
}

export function verify(_payload: unknown, sig: string): boolean {
  if (config.mock) return verifyMock(sig);
  // TODO(real): 校验 timestamp + nonce + verify_token 的 SHA256 签名
  return false;
}

export const feishuConnector: PlatformConnector = { verify, receive, send, convert };
