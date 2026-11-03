/**
 * 真实回调的加解密与签名工具（无第三方依赖）。
 *
 * 飞书：AES-256-CBC，key = SHA256(encryptKey)，密文 base64 前 16 字节为 IV，PKCS7。
 * 钉钉：AES-256-CBC，key = Base64(aesKey + "=")，IV 取 key 前 16 字节，自定义 32 字节块填充；
 *      签名 = Base64(HMAC-SHA256(aesToken, timestamp + "\n" + aesKey))。
 * 企业微信：AES-256-CBC，key = Base64(EncodingAESKey + "=")，IV 取 key 前 16 字节；
 *      明文 = 16 随机字节 + 4 字节网络序长度 + XML + receiveId(corpId)，32 字节块填充；
 *      签名 = SHA1(sort([token, timestamp, nonce, encrypt]).join(""))。
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function unpad(buf: Buffer): Buffer {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) return buf;
  return buf.subarray(0, buf.length - pad);
}

export function feishuDecrypt(encryptKey: string, encrypted: string): string {
  const key = createHash('sha256').update(encryptKey).digest();
  const raw = Buffer.from(encrypted, 'base64');
  if (raw.length <= 16) throw new Error('feishu payload too short');
  const decipher = createDecipheriv('aes-256-cbc', key, raw.subarray(0, 16));
  decipher.setAutoPadding(false);
  return unpad(Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()])).toString('utf8');
}

/** 仅供单测构造密文，生产不会调用 */
export function feishuEncrypt(encryptKey: string, plain: string, iv = Buffer.alloc(16, 0)): string {
  const key = createHash('sha256').update(encryptKey).digest();
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(true);
  return Buffer.concat([iv, cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]).toString('base64');
}

function dingtalkKey(aesKey: string): Buffer {
  return Buffer.from(`${aesKey}=`, 'base64');
}

export function dingtalkDecrypt(aesKey: string, encrypted: string): string {
  const key = dingtalkKey(aesKey);
  const raw = Buffer.from(encrypted, 'base64');
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  return unpad(Buffer.concat([decipher.update(raw), decipher.final()])).toString('utf8');
}

/** 仅供单测构造密文：钉钉使用 32 字节块填充 */
export function dingtalkEncrypt(aesKey: string, plain: string): string {
  const key = dingtalkKey(aesKey);
  const data = Buffer.from(plain, 'utf8');
  const pad = 32 - (data.length % 32);
  const padded = Buffer.concat([data, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

export function dingtalkSign(aesToken: string, timestamp: string, aesKey: string): string {
  return createHmac('sha256', aesToken).update(`${timestamp}\n${aesKey}`).digest('base64');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ---------- 企业微信 ----------

/** EncodingAESKey 是 43 位 base64，补 "=" 后解出 32 字节密钥；IV 取前 16 字节。 */
export function wecomAesKey(encodingAesKey: string): Buffer {
  if (encodingAesKey.length !== 43) throw new Error('WECOM_AES_KEY(EncodingAESKey) 必须为 43 位');
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  if (key.length !== 32) throw new Error('WECOM_AES_KEY 解码后必须为 32 字节');
  return key;
}

/** 签名：4 个字段按字典序排序后直接拼接取 SHA1（回调 URL 与推送报文都用它）。 */
export function wecomSign(token: string, timestamp: string, nonce: string, encrypt: string): string {
  return createHash('sha1').update([token, timestamp, nonce, encrypt].sort().join(''), 'utf8').digest('hex');
}

export interface WecomPlain {
  /** 解密出来的 XML 报文（或 URL 验证时的随机串） */
  message: string;
  /** 明文尾部携带的 receiveId，企业自建应用即 corpId */
  receiveId: string;
}

/**
 * 解密：去 PKCS7 填充 → 去掉 16 字节随机前缀 → 读 4 字节网络序长度 → 截取 XML → 剩余即 receiveId。
 * 传入 expectedReceiveId 时强制校验，防止拿别的企业密文冒充。
 */
export function wecomDecrypt(aesKey: string, encrypted: string, expectedReceiveId = ''): WecomPlain {
  const key = wecomAesKey(aesKey);
  const raw = Buffer.from(encrypted, 'base64');
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const body = unpad(Buffer.concat([decipher.update(raw), decipher.final()]));
  if (body.length < 20) throw new Error('企业微信密文长度不足');
  const len = body.readUInt32BE(16);
  if (len <= 0 || 20 + len > body.length) throw new Error('企业微信密文长度字段非法');
  const message = body.subarray(20, 20 + len).toString('utf8');
  const receiveId = body.subarray(20 + len).toString('utf8');
  if (expectedReceiveId && receiveId !== expectedReceiveId) {
    throw new Error(`企业微信回调 receiveId 与 WECOM_CORP_ID 不一致：${receiveId.slice(0, 64)}`);
  }
  return { message, receiveId };
}

/**
 * 加密（被动回复 / URL 验证回包用）。
 * random16 仅供单测构造确定性密文，生产留空走 randomBytes。
 */
export function wecomEncrypt(aesKey: string, plain: string, receiveId: string, random16?: Buffer): string {
  const key = wecomAesKey(aesKey);
  const data = Buffer.from(plain, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const raw = Buffer.concat([random16 ?? randomBytes(16), lenBuf, data, Buffer.from(receiveId, 'utf8')]);
  const pad = 32 - (raw.length % 32);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(Buffer.concat([raw, Buffer.alloc(pad, pad)])), cipher.final()]).toString('base64');
}
