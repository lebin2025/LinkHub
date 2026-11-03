/**
 * 企业微信连接器（真实接入）。
 *
 * 收：
 *  - GET  /api/webhook/wecom?msg_signature&timestamp&nonce&echostr
 *        URL 验证握手：校验 SHA1 签名后把 echostr AES 解密成明文原样返回（challenge）。
 *  - POST /api/webhook/wecom  text/xml，<xml><Encrypt><![CDATA[密文]]></Encrypt></xml>
 *        decrypt 解出内层 XML → 字段映射为统一消息；verify 用原始密文重算 SHA1 签名。
 * 发：
 *  - GET  /cgi-bin/gettoken?corpid&corpsecret → access_token（real.ts 统一缓存）
 *  - POST /cgi-bin/message/send?access_token  { touser, msgtype, agentid, text:{content} }
 *
 * MOCK=true 且报文未加密时全部走本地 Mock，保证零凭据也能跑通演示；
 * 只要配置了 Token/EncodingAESKey，无论 MOCK 与否都按真实规则严格验签。
 */
import {
  Platform, MsgStatus, UnifiedMessage, PlatformConnector,
} from '@unimsg/shared';
import { config } from '../config';
import { genTraceId, mockSend, verifyMock, inferType } from './base';
import { safeEqual, wecomDecrypt, wecomEncrypt, wecomSign } from './crypto';
import { buildXml, parseXml, type XmlObject } from './wecomXml';
import { postJson, wecomAccessToken } from './real';

const SEND_URL = 'https://qyapi.weixin.qq.com/cgi-bin/message/send';
/** 回调时间戳容忍窗口（防重放），与钉钉一致取 1 小时 */
const SIGN_TTL_SEC = 3600;

function pick(src: Record<string, unknown> | undefined, name: string): string {
  const v = src?.[name];
  if (Array.isArray(v)) return String(v[0] ?? '');
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** 报文来源有三种：express.text 解析出的 XML 字符串、解密后的对象、Mock/单测里的 JSON 对象。 */
function toFields(payload: unknown): XmlObject {
  if (typeof payload === 'string') return payload.trim() ? parseXml(payload) : {};
  if (payload && typeof payload === 'object') return payload as XmlObject;
  return {};
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string {
  const v = headers?.[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/** 签名四要素里的 timestamp/nonce：企微放在 query 上，webhook 路由已并入 headers。 */
function signFields(
  fields: XmlObject,
  headers: Record<string, string | string[] | undefined> | undefined,
): { signature: string; timestamp: string; nonce: string } {
  return {
    signature: headerValue(headers, 'msg_signature') || pick(fields, 'msg_signature'),
    timestamp: headerValue(headers, 'timestamp') || pick(fields, 'timestamp'),
    nonce: headerValue(headers, 'nonce') || pick(fields, 'nonce'),
  };
}

/**
 * 解密：外层 Encrypt → 内层 XML 字段表。
 * 注意要保留原始 Encrypt —— 路由是 decrypt → verify 的顺序，验签必须基于密文本身。
 */
export function decrypt(payload: unknown): unknown {
  const fields = toFields(payload);
  const encrypted = pick(fields, 'Encrypt');
  if (!encrypted) return fields;

  const { aesKey, corpId } = config.platforms.wecom;
  if (!aesKey) throw new Error('收到加密回调，但未配置 WECOM_AES_KEY');
  const { message } = wecomDecrypt(aesKey, encrypted, corpId);
  return { ...parseXml(message), Encrypt: encrypted };
}

/**
 * URL 验证握手（GET 回调）。payload 是 query 参数表：
 * 签名对得上 → 返回解密后的 echostr 明文；对不上 → 返回 undefined（路由回 400）。
 */
export function challenge(payload: unknown): unknown | undefined {
  const q = toFields(payload);
  const echostr = pick(q, 'echostr');
  if (!echostr) return undefined;

  const { token, aesKey } = config.platforms.wecom;
  if (!token || !aesKey) {
    // 本地 Mock 演示：没有任何凭据时原样回显；真实模式绝不放水
    return config.mock ? echostr : undefined;
  }
  const { signature, timestamp, nonce } = signFields(q, undefined);
  if (!signature || !timestamp || !nonce) return undefined;
  if (!safeEqual(wecomSign(token, timestamp, nonce, echostr), signature)) return undefined;
  return wecomDecrypt(aesKey, echostr, config.platforms.wecom.corpId).message;
}

/** 验签：SHA1(sort([token, timestamp, nonce, Encrypt]))，密文缺失或过期一律拒绝。 */
export function verify(
  payload: unknown,
  sig: string,
  headers?: Record<string, string | string[] | undefined>,
): boolean {
  const fields = toFields(payload);
  const encrypted = pick(fields, 'Encrypt');
  if (config.mock && !encrypted) return verifyMock(sig);

  const { token } = config.platforms.wecom;
  if (!token) return false;

  const { signature, timestamp, nonce } = signFields(fields, headers);
  const msgSignature = signature || sig;
  if (!msgSignature || !timestamp || !nonce || !encrypted) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SIGN_TTL_SEC) return false;
  return safeEqual(wecomSign(token, timestamp, nonce, encrypted), msgSignature);
}

export function receive(raw: unknown): UnifiedMessage {
  const r = toFields(raw);
  const text = pick(r, 'Content') || pick(r, 'content');
  const senderId = pick(r, 'FromUserName') || pick(r, 'fromUserName') || 'unknown';
  const now = new Date().toISOString();
  const msgType = (pick(r, 'MsgType') || pick(r, 'msgtype')).toLowerCase();
  const type = msgType === 'image' ? 'image'
    : msgType === 'file' ? 'file' : inferType(text);
  const chatId = pick(r, 'ChatId') || pick(r, 'chatid');

  return {
    traceId: genTraceId(),
    platform: Platform.WECOM,
    externalId: pick(r, 'MsgId') || 'unknown',
    sender: { id: senderId, name: senderId },
    conversation: chatId ? { id: chatId, type: 'group' } : undefined,
    type,
    body: String(text),
    status: MsgStatus.RECEIVED,
    createdAt: now,
    updatedAt: now,
  };
}

/** 统一消息 → 企微应用消息请求体（touser + agentid + text.content）。 */
export function convert(msg: UnifiedMessage): unknown {
  const { agentId } = config.platforms.wecom;
  return {
    touser: msg.sender.id,
    msgtype: 'text',
    ...(agentId ? { agentid: Number(agentId) } : {}),
    text: { content: msg.reply ?? msg.body },
  };
}

/**
 * 被动回复加密报文（企微允许即时回一段文本给用户时用到）。
 * 默认 5 秒内未回包企微不再等待，所以 webhook 走的是明文 "success"。
 */
export function encryptReply(
  reply: XmlObject | string,
  timestamp = String(Math.floor(Date.now() / 1000)),
  nonce = genTraceId(),
): string {
  const { aesKey, corpId, token } = config.platforms.wecom;
  if (!aesKey) throw new Error('未配置 WECOM_AES_KEY，无法加密被动回复');
  const plain = typeof reply === 'string' ? reply : buildXml(reply);
  const encrypt = wecomEncrypt(aesKey, plain, corpId);
  const signature = wecomSign(token, timestamp, nonce, encrypt);
  return buildXml({ Encrypt: encrypt, MsgSignature: signature, TimeStamp: timestamp, Nonce: nonce });
}

export async function send(msg: UnifiedMessage): Promise<{ ok: boolean; platformReply?: string }> {
  const payload = convert(msg) as any;
  if (config.mock) {
    mockSend(Platform.WECOM, payload);
    return { ok: true };
  }

  const { corpId, secret, agentId } = config.platforms.wecom;
  if (!corpId || !secret) throw new Error('企业微信真实发送缺少 WECOM_CORP_ID / WECOM_SECRET');
  if (!agentId) throw new Error('企业微信真实发送缺少 WECOM_AGENT_ID');
  if (!payload.touser || payload.touser === 'unknown') {
    throw new Error('企业微信真实发送缺少接收人（touser，来自消息的 FromUserName）');
  }

  const token = await wecomAccessToken();
  const data = await postJson(`${SEND_URL}?access_token=${encodeURIComponent(token)}`, payload);
  if (data.errcode !== 0) {
    const invalid = data.invaliduser ? ` invaliduser=${data.invaliduser}` : '';
    throw new Error(`企业微信发送失败: ${data.errcode ?? 'unknown'} ${data.errmsg ?? ''}${invalid}`);
  }
  return { ok: true, platformReply: data.msgid ? String(data.msgid) : undefined };
}

export const wecomConnector: PlatformConnector = {
  verify, decrypt, challenge, receive, send, convert,
};
