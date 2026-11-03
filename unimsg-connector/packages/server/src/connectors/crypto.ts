/**
 * 真实回调的加解密与签名工具（无第三方依赖）。
 *
 * 飞书：AES-256-CBC，key = SHA256(encryptKey)，密文 base64 前 16 字节为 IV，PKCS7。
 * 钉钉：AES-256-CBC，key = Base64(aesKey + "=")，IV 取 key 前 16 字节，自定义 32 字节块填充；
 *      签名 = Base64(HMAC-SHA256(aesToken, timestamp + "\n" + aesKey))。
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';

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
