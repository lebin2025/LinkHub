/**
 * 钉钉连接器（企业内部机器人）。
 *
 * receive：解析钉钉回调（conversationId / senderStaffId / msgId）→ 统一消息。
 * convert：统一消息 → 机器人发送参数。
 * send   ：Mock 模式写入 sentBox 并返回 mode='mock'；否则换取 accessToken 调机器人接口。
 * verify ：Mock 模式宽松验签；否则校验 timestamp + HMAC 签名。
 * decrypt：AES 解密 encrypt 字段。
 */
import {
  Platform, MsgStatus, UnifiedMessage, PlatformConnector, type SendResult,
} from '@unimsg/shared';
import { config } from '../config';
import { genTraceId, mockSend, verifyMock, inferType, isMock, assertRealSendable } from './base';
import { dingtalkDecrypt, dingtalkSign, safeEqual } from './crypto';
import { dingtalkAccessToken, postJson } from './real';

function header(headers: Record<string, string | string[] | undefined> | undefined, name: string): string {
  const v = headers?.[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/**
 * 会话映射：钉钉回调里群聊是 conversationType='2'（文档为字符串），
 * 但不同入口/版本偶尔给数字 2 或 'group'，这里统一兼容，
 * 避免群消息被误判成单聊——单聊分支会把回复私聊给发送人，而不是发回群里。
 */
export function parseConversation(r: any): UnifiedMessage['conversation'] {
  const id = r?.conversationId;
  if (id === undefined || id === null || String(id).trim() === '') return undefined;

  const rawType = r?.conversationType;
  const typeText = String(rawType ?? '').trim().toLowerCase();
  const isGroup = rawType === 2 || typeText === '2' || typeText === 'group';

  const title = isGroup && r?.conversationTitle ? String(r.conversationTitle).trim() : '';
  return { id: String(id), type: isGroup ? 'group' : 'p2p', ...(title ? { title } : {}) };
}

/**
 * 入站事件的一行摘要（Stream 日志用）：
 * 钉钉 Stream 只推「单聊」和「群聊里 @机器人」的消息，普通群消息平台根本不会推送。
 * 所以这条日志是排查「群里 @ 了机器人却没反应」最直接的判据：
 * 有这行 = 平台确实推到了；没有 = 平台没推（机器人没进群 / 不是同一个应用机器人 / 连接断开）。
 */
export function describeInbound(raw: unknown): string {
  const r = raw as any;
  const conversation = parseConversation(r);
  const where = !conversation
    ? '无会话'
    : conversation.type === 'group'
      ? `群聊${conversation.title ? `「${conversation.title}」` : ''}`
      : '单聊';
  const sender = r?.senderNick ?? r?.senderStaffId ?? r?.senderId ?? '未知发送者';
  return `收到钉钉消息：${where} · 发送者=${sender} · 类型=${r?.msgtype ?? 'unknown'} · msgId=${r?.msgId ?? '?'}`;
}

export function receive(raw: unknown): UnifiedMessage {
  const r = raw as any;
  const text = r?.text?.content ?? r?.content ?? '';
  const senderId = r?.senderStaffId ?? r?.senderId ?? 'unknown';
  const now = new Date().toISOString();
  const type = r?.msgtype === 'image' ? 'image'
    : r?.msgtype === 'file' ? 'file' : inferType(text);

  return {
    traceId: genTraceId(),
    platform: Platform.DINGTALK,
    externalId: r?.msgId ?? 'unknown',
    sender: { id: senderId, name: r?.senderNick ?? senderId },
    conversation: parseConversation(r),
    type,
    body: String(text),
    status: MsgStatus.RECEIVED,
    createdAt: now,
    updatedAt: now,
  };
}

export function convert(msg: UnifiedMessage): unknown {
  return {
    msgKey: 'sampleText',
    msgParam: JSON.stringify({ content: msg.reply ?? msg.body }),
  };
}

export function decrypt(payload: unknown): unknown {
  const p = payload as any;
  if (!p?.encrypt) return payload;
  const key = config.platforms.dingtalk.aesKey;
  if (!key) throw new Error('收到加密回调，但未配置 DINGTALK_AES_KEY');
  return JSON.parse(dingtalkDecrypt(key, String(p.encrypt)));
}

export function verify(
  _payload: unknown,
  _sig: string,
  headers?: Record<string, string | string[] | undefined>,
): boolean {
  if (isMock(Platform.DINGTALK)) return verifyMock(_sig);

  const { aesToken, aesKey } = config.platforms.dingtalk;
  if (!aesToken || !aesKey) return false;

  const timestamp = header(headers, 'timestamp');
  const sign = header(headers, 'sign');
  if (!timestamp || !sign) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 60 * 60 * 1000) return false;

  return safeEqual(dingtalkSign(aesToken, timestamp, aesKey), sign);
}

export async function send(msg: UnifiedMessage): Promise<SendResult> {
  const payload = convert(msg) as any;
  if (isMock(Platform.DINGTALK)) {
    return mockSend(Platform.DINGTALK, payload);
  }
  assertRealSendable(Platform.DINGTALK);

  const { robotCode } = config.platforms.dingtalk;
  if (!robotCode) throw new Error('未配置 DINGTALK_ROBOT_CODE');

  const token = await dingtalkAccessToken();
  const headers = { 'x-acs-dingtalk-access-token': token };
  const base = config.platforms.dingtalk.baseUrl;

  if (msg.conversation?.type === 'p2p') {
    const data = await postJson(
      `${base}/v1.0/robot/oToMessages/batchSend`,
      { robotCode, userIds: [msg.sender.id], ...payload },
      headers,
    );
    return { ok: true, mode: 'real', platformReply: data.processQueryKey };
  }

  if (!msg.conversation?.id) throw new Error('钉钉群消息缺少 conversation.id');
  const data = await postJson(
    `${base}/v1.0/robot/groupMessages/send`,
    { robotCode, openConversationId: msg.conversation.id, ...payload },
    headers,
  );
  return { ok: true, mode: 'real', platformReply: data.processQueryKey };
}

export const dingtalkConnector: PlatformConnector = { verify, decrypt, receive, send, convert };
