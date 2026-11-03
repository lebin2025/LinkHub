/**
 * 真实平台调用的公共设施：token 缓存 + JSON 请求。
 * 只使用 Node 内置 fetch，不引入第三方 SDK。
 */
import { config } from '../config';

interface CachedToken {
  token: string;
  exp: number;
}

const tokens = new Map<string, CachedToken>();

export function resetTokenCache(): void {
  tokens.clear();
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = config.llmTimeoutMs,
): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

/** GET 取 JSON（企业微信 gettoken 一类只认 GET 的接口）。 */
export async function getJson(url: string, timeoutMs = config.llmTimeoutMs): Promise<any> {
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

export async function feishuTenantToken(): Promise<string> {
  const { appId, appSecret } = config.platforms.feishu;
  if (!appId || !appSecret) throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET 未配置');

  const cacheKey = `feishu:${appId}`;
  const hit = tokens.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.token;

  const data = await postJson('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: appId,
    app_secret: appSecret,
  });
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`飞书 tenant_access_token 获取失败: ${data.code} ${data.msg ?? ''}`);
  }
  const ttl = Math.max(60, Number(data.expire ?? 7200) - 120);
  tokens.set(cacheKey, { token: data.tenant_access_token, exp: Date.now() + ttl * 1000 });
  return data.tenant_access_token;
}

export async function dingtalkAccessToken(): Promise<string> {
  const { appKey, appSecret } = config.platforms.dingtalk;
  if (!appKey || !appSecret) throw new Error('DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET 未配置');

  const cacheKey = `dingtalk:${appKey}`;
  const hit = tokens.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.token;

  const data = await postJson('https://api.dingtalk.com/v1.0/oauth2/accessToken', { appKey, appSecret });
  if (!data.accessToken) {
    throw new Error(`钉钉 accessToken 获取失败: ${JSON.stringify(data).slice(0, 200)}`);
  }
  const ttl = Math.max(60, Number(data.expireIn ?? 7200) - 120);
  tokens.set(cacheKey, { token: data.accessToken, exp: Date.now() + ttl * 1000 });
  return data.accessToken;
}

/**
 * 企业微信 access_token：GET /cgi-bin/gettoken?corpid=&corpsecret=（应用 Secret）。
 * 与飞书/钉钉共用同一份缓存，提前 120s 过期，避免边界失效。
 */
export async function wecomAccessToken(): Promise<string> {
  const { corpId, secret } = config.platforms.wecom;
  if (!corpId || !secret) throw new Error('WECOM_CORP_ID / WECOM_SECRET 未配置');

  const cacheKey = `wecom:${corpId}:${secret}`;
  const hit = tokens.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.token;

  const qs = new URLSearchParams({ corpid: corpId, corpsecret: secret });
  const data = await getJson(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?${qs.toString()}`);
  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(`企业微信 access_token 获取失败: ${data.errcode ?? 'unknown'} ${data.errmsg ?? ''}`);
  }
  const ttl = Math.max(60, Number(data.expires_in ?? 7200) - 120);
  tokens.set(cacheKey, { token: data.access_token, exp: Date.now() + ttl * 1000 });
  return data.access_token;
}
