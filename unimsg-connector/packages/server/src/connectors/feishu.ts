/**
 * 飞书连接器。
 *
 * receive：解析 im.message.receive_v1（也兼容旧版简化结构）→ 统一消息。
 * convert：统一消息 → 飞书 im/v1/messages 请求体。
 * send   ：MOCK=true 写入 sentBox；否则换取 tenant_access_token 真实发送。
 * verify ：MOCK=true 宽松验签；否则校验事件头里的 verification token。
 * decrypt：配置了 Encrypt Key 时解密 encrypt 字段。
 */
import {
  Platform, MsgStatus, UnifiedMessage, PlatformConnector,
} from '@unimsg/shared';
import { config } from '../config';
import { genTraceId, mockSend, verifyMock, inferType } from './base';
import { feishuDecrypt } from './crypto';
import { feishuTenantToken, postJson } from './real';

function safeParse(content: unknown): any {
  if (typeof content !== 'string') return content;
  try { return JSON.parse(content); } catch { return content; }
}

function pickText(content: any): string {
  if (typeof content === 'object' && content) return content.text ?? content.title ?? '';
  return String(content ?? '');
}

export function receive(raw: unknown): UnifiedMessage {
  const r = raw as any;
  // 飞书 v2 事件：{ schema, header, event: { message } }
  const e = r?.event ?? r;
  const m = e?.message ?? {};
  const content = safeParse(m.content);
  const text = pickText(content);
  const senderId = m.sender?.sender_id?.user_id ?? m.sender?.sender_id?.open_id ?? 'unknown';
  const now = new Date().toISOString();
  const kind = m.message_type;
  const type = kind === 'image' ? 'image' : kind === 'file' ? 'file' : inferType(text);
  const chatId = m.chat_id ?? e?.chat_id;
  const chatType = m.chat_type ?? e?.chat_type;

  return {
    traceId: genTraceId(),
    platform: Platform.FEISHU,
    externalId: m.message_id ?? 'unknown',
    sender: { id: senderId, name: senderId },
    conversation: chatId
      ? { id: String(chatId), type: chatType === 'p2p' ? 'p2p' : 'group' }
      : undefined,
    type,
    body: text,
    status: MsgStatus.RECEIVED,
    createdAt: now,
    updatedAt: now,
  };
}

export function convert(msg: UnifiedMessage): unknown {
  return {
    receive_id: msg.conversation?.id ?? msg.sender.id,
    msg_type: 'text',
    content: JSON.stringify({ text: msg.reply ?? msg.body }),
  };
}

export function decrypt(payload: unknown): unknown {
  const p = payload as any;
  if (!p?.encrypt) return payload;
  const key = config.platforms.feishu.encryptKey;
  if (!key) throw new Error('收到加密事件，但未配置 FEISHU_ENCRYPT_KEY');
  return JSON.parse(feishuDecrypt(key, String(p.encrypt)));
}

export function challenge(payload: unknown): unknown | undefined {
  const p = payload as any;
  if (p?.type !== 'url_verification') return undefined;
  return { challenge: p.challenge };
}

export function verify(payload: unknown, sig: string): boolean {
  if (config.mock) return verifyMock(sig);
  const expected = config.platforms.feishu.verifyToken;
  if (!expected) return false;
  const p = payload as any;
  const token = p?.header?.token ?? p?.token;
  return typeof token === 'string' && token === expected;
}

export async function send(msg: UnifiedMessage): Promise<{ ok: boolean; platformReply?: string }> {
  const payload = convert(msg) as any;
  if (config.mock) {
    mockSend(Platform.FEISHU, payload);
    return { ok: true };
  }

  const chatId = msg.conversation?.id;
  if (!chatId) throw new Error('飞书真实发送缺少 conversation.id（需先收到该会话的消息）');

  const token = await feishuTenantToken();
  const data = await postJson(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    payload,
    { Authorization: `Bearer ${token}` },
  );
  if (data.code !== 0) {
    throw new Error(`飞书发送失败: ${data.code} ${data.msg ?? ''}`);
  }
  return { ok: true, platformReply: data.data?.message_id };
}

export const feishuConnector: PlatformConnector = { verify, decrypt, challenge, receive, send, convert };
