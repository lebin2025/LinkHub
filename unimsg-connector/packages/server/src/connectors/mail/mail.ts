/**
 * 邮箱连接器（QQ / 163 共用一套实现，按账号 key 分流）。
 *
 * 与飞书/钉钉的差别是它没有回调：收信靠本机 IMAP 轮询，发信走 SMTP。
 * 因此 externalId 带账号与目录（<key>:<目录>:<UID>），多邮箱、多目录的 UID 互不撞车；
 * conversation.id 存"回信地址"，mailMeta 存原主题与 Message-ID 以便串联会话。
 */
import { randomUUID } from 'node:crypto';
import {
  Platform, MsgStatus, UnifiedMessage, PlatformConnector,
} from '@unimsg/shared';
import { config, type MailAccount } from '../../config';
import { genTraceId, mockSend, verifyMock, inferType } from '../base';
import { buildMail, type ParsedMessage } from './mime';
import { sendMail } from './smtpClient';

/** 正文入库上限：邮件可能很长，中枢与 LLM 只需要前面的要点 */
const BODY_LIMIT = 2000;

export interface MailRaw extends ParsedMessage {
  source: 'imap';
  account: string;
  folder: string;
  uid: number;
}

export interface MailEnvelope {
  accountKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo: string;
}

export function findAccount(key: string): MailAccount {
  const found = config.mail.accounts.find((a) => a.key === key);
  if (!found) throw new Error(`邮箱账号未配置：${key}（检查 MAIL_${key.toUpperCase()}_ADDRESS / AUTH_CODE）`);
  return found;
}

function accountKeyOf(msg: UnifiedMessage): string {
  return msg.mailMeta?.account ?? msg.externalId.split(':')[0] ?? '';
}

export function receive(raw: unknown): UnifiedMessage {
  const r = raw as MailRaw;
  if (r?.source !== 'imap' || !r.account) throw new Error('邮箱事件缺少 source=imap/account');
  const now = new Date().toISOString();
  const body = [r.subject, r.text].filter(Boolean).join('\n\n').slice(0, BODY_LIMIT);
  const fromName = r.from.name || r.from.address;
  return {
    traceId: genTraceId(),
    platform: Platform.MAIL,
    externalId: `${r.account}:${r.folder || 'INBOX'}:${r.uid}`,
    sender: { id: r.from.address, name: fromName },
    conversation: { id: r.from.address, type: 'p2p' },
    type: inferType(body),
    body,
    mailMeta: { account: r.account, inReplyTo: r.messageId, subject: r.subject },
    status: MsgStatus.RECEIVED,
    createdAt: r.date ? new Date(r.date).toISOString() : now,
    updatedAt: now,
  };
}

export function convert(msg: UnifiedMessage): MailEnvelope {
  const key = accountKeyOf(msg);
  const from = config.mail.accounts.find((a) => a.key === key)?.address ?? '';
  return {
    accountKey: key,
    from,
    to: msg.conversation?.id ?? '',
    subject: msg.mailMeta?.subject ?? '',
    text: msg.reply ?? msg.body,
    inReplyTo: msg.mailMeta?.inReplyTo ?? '',
  };
}

export async function send(msg: UnifiedMessage): Promise<{ ok: boolean; platformReply?: string }> {
  const envelope = convert(msg);
  if (config.mock) return mockSend(Platform.MAIL, envelope);
  if (!envelope.to) throw new Error('邮箱真实回写缺少收件人（conversation.id）');

  const account = findAccount(envelope.accountKey);
  const raw = buildMail(account.address, envelope.to, envelope.subject, envelope.text, {
    inReplyTo: envelope.inReplyTo,
    messageId: `${randomUUID()}@linkhub.local`,
  });
  const receipt = await sendMail(account, envelope.to, raw);
  return { ok: true, platformReply: receipt };
}

/**
 * 验签：邮箱没有平台回调，真实模式一律拒绝 /webhook/mail，
 * 防止任何人伪造"邮件事件"入库；新邮件只能由本机轮询直接 ingest。
 */
export function verify(_payload: unknown, sig: string): boolean {
  if (config.mock) return verifyMock(sig);
  return false;
}

export const mailConnector: PlatformConnector = { verify, receive, send, convert };
