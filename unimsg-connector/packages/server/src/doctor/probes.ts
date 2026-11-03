/**
 * doctor 探针层：一切探测均为【只读】，绝不发送业务消息。
 *
 *  - token 类探针不复用 connectors/real.ts 的 token 获取（它的错误只有 code），
 *    而是自己用 fetch 发结构化请求，把 errcode 映射成中文原因 + 修复建议；
 *  - 企微 60020 时自动探测出口公网 IP，直接告诉用户要往「企业可信IP」里加哪个 IP；
 *  - 邮箱探针复用生产客户端：IMAP 只做 登录 + SELECT + UID SEARCH 立基线（不取正文），
 *    SMTP 用 verifySmtpAuth 只登录 + QUIT（不投递）；地址一律 maskAddress 脱敏；
 *  - 单测通过 stub globalThis.fetch / 注入假实现，绝不联网。
 */
import { Platform, type DeliveryMode } from '@unimsg/shared';
import type { MailAccount } from '../config';
import {
  DEFAULT_DINGTALK_BASE_URL,
  DEFAULT_FEISHU_BASE_URL,
  DEFAULT_WECOM_BASE_URL,
  MODE_ENV_KEYS,
  PLATFORM_LABELS,
  type ModePolicy,
} from '../config/runtime';
import { fetchNewMails } from '../connectors/mail/imapClient';
import { verifySmtpAuth } from '../connectors/mail/smtpClient';
import { maskAddress } from '../services/account';
import type { CheckResult } from './report';

/** 单个探针的默认超时（任务要求 8s） */
export const PROBE_TIMEOUT_MS = 8_000;
/**
 * 邮箱探针单独放宽到 25s：IMAP/SMTP 登录要做 DNS + TCP + TLS + 登录多次往返，
 * QQ/163 在风控或网络抖动时 8s 会假超时（真实轮询客户端的连接超时本来就是 20s）。
 */
export const MAIL_PROBE_TIMEOUT_MS = 25_000;
/** 出口 IP 探测的默认超时（附加信息，失败不影响主结论） */
export const EGRESS_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// 探针输入
// ---------------------------------------------------------------------------

export interface FeishuProbeInput {
  appId: string;
  appSecret: string;
  baseUrl: string;
}

export interface DingtalkProbeInput {
  appKey: string;
  appSecret: string;
  robotCode: string;
  /** DINGTALK_ROBOT_CODE 是否在 .env 里显式填写（否则由 Client ID 回退而来） */
  robotCodeExplicit: boolean;
  aesToken: string;
  aesKey: string;
  /** 是否开启 Stream 长连接（config.dingtalkStream） */
  stream: boolean;
  baseUrl: string;
}

export interface WecomProbeInput {
  corpId: string;
  secret: string;
  agentId: string;
  baseUrl: string;
}

export interface MailProbeInput {
  accounts: MailAccount[];
  enabled: boolean;
}

/** 探针只需要平台运行画像的这几个字段（config.runtime 的条目可直接传入） */
export interface PlatformProbeRuntime {
  policy: ModePolicy;
  mode: DeliveryMode;
  canSend: boolean;
  canReceive: boolean;
  missing: string[];
  warnings: string[];
}

export interface ProbeInput {
  feishu: FeishuProbeInput;
  dingtalk: DingtalkProbeInput;
  wecom: WecomProbeInput;
  mail: MailProbeInput;
  runtime: Record<Platform, PlatformProbeRuntime>;
}

export interface RunProbesOptions {
  /** 只探测指定平台（--platform 过滤） */
  platformFilter?: Platform[];
  timeoutMs?: number;
  /** 邮箱探针超时（默认 25s，比 HTTP 探针宽：要完成 TLS + IMAP/SMTP 登录往返） */
  mailTimeoutMs?: number;
  /**
   * 无论是否有 60020，都额外采集一次本机出口公网 IP 放进报告：
   * 企业微信「可信 IP」绑定的是出口 IP，电脑重启/换网/开代理后可能变化，
   * 让用户每次跑 doctor 都能一眼看到"现在该加哪个 IP"。
   * 失败只是少一条附加信息，不影响自检结论。
   */
  alwaysFetchEgressIp?: boolean;
  /** 邮箱探针的注入点：单测传假实现，生产不传（走真实客户端，只读） */
  deps?: MailProbeDeps;
}

export interface RunProbesResult {
  checks: CheckResult[];
  /** 探测到的出口公网 IP（仅企微 60020 场景会采集） */
  egressIp?: string;
}

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

export interface ErrorAdvice {
  detail: string;
  hint: string;
}

/** 把任意 Error 压成一行可读文本（会带出 cause 的 message） */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? `（${cause.message}）` : '';
    return `${err.message}${causeMsg}`.trim();
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** 取 Node 网络错误码（含 err.cause.code，如 fetch 的 ENOTFOUND） */
function errorCode(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e.code ?? e.cause?.code;
  return typeof code === 'string' ? code : '';
}

function shortError(err: unknown, max = 160): string {
  return errorMessage(err).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 从 URL 或 host:port 里取主机名（用于提示 nslookup / 检查 host） */
export function hostOf(value: string): string {
  const raw = value.trim();
  // 注意：'imap.qq.com:993' 会被 new URL 当成 scheme='imap.qq.com'，必须先判协议前缀
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw.startsWith('//')) {
    try {
      const normalized = raw.startsWith('//') ? `http:${raw}` : raw;
      const host = new URL(normalized).hostname;
      if (host) return host;
    } catch {
      // 不是合法 URL，继续按 host:port 处理
    }
  }
  const stripped = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return stripped.split('/')[0].split(':')[0];
}

function trimBaseUrl(baseUrl: string, fallback: string): string {
  const raw = (baseUrl ?? '').trim();
  return (raw || fallback).replace(/\/+$/, '');
}

function previewBody(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '（空响应体）';
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function httpHint(name: string, baseUrl: string): string {
  return `检查本机网络/代理能否访问 ${baseUrl}；如果企业网络有网关或代理，确认 HTTPS_PROXY 配置正确，或为 ${name} 域名放行。`;
}

function isIpLike(value: string): boolean {
  return /^[0-9a-fA-F:.]+$/.test(value) && (value.includes('.') || value.includes(':'));
}

// ---------------------------------------------------------------------------
// HTTP 小工具
// ---------------------------------------------------------------------------

interface ProbeHttpResponse {
  status: number;
  ok: boolean;
  data: any;
  text: string;
}

/** 发一个只读 JSON 请求（带 8s AbortSignal 超时），HTTP 状态不抛错，交给调用方映射 */
async function requestJson(
  method: 'GET' | 'POST',
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<ProbeHttpResponse> {
  const init: RequestInit = { method, signal: AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { status: res.status, ok: res.ok, data, text };
}

// ---------------------------------------------------------------------------
// 网络错误 → 中文建议
// ---------------------------------------------------------------------------

export type NetworkErrorKind = 'timeout' | 'dns' | 'refused' | 'tls' | 'other';

/** 把网络错误归类：超时 / DNS / 拒绝连接 / TLS / 其他 */
export function classifyNetworkError(err: unknown): NetworkErrorKind {
  const text = `${errorCode(err)} ${errorMessage(err)}`.toLowerCase();
  if (/(timeouterror|aborterror|etimedout|timed out|timeout|超时)/.test(text)) return 'timeout';
  if (/(enotfound|eai_again|getaddrinfo|nxdomain|dns)/.test(text)) return 'dns';
  if (/(econnrefused|econnreset|ehostunreach|enetunreach|连接被拒绝|连接已关闭)/.test(text)) return 'refused';
  // 注意不要用裸 'tls'：'STARTTLS' 里也包含 tls，会被误判成握手失败
  if (
    /(wrong version number|ssl3|tls handshake|tls connect|tlsv1|certificate|cert_|self[- ]signed|unable_to_verify|hostname mismatch|证书)/.test(
      text,
    )
  ) {
    return 'tls';
  }
  return 'other';
}

/**
 * 网络类错误的统一中文说明；非网络类错误返回 null（调用方继续按平台错误码映射）。
 * target 可以是 host:port（IMAP/SMTP）或 baseUrl（HTTP 探针）。
 */
export function explainNetworkError(err: unknown, target: string, timeoutMs = PROBE_TIMEOUT_MS): ErrorAdvice | null {
  const kind = classifyNetworkError(err);
  if (kind === 'other') return null;
  const host = hostOf(target);
  switch (kind) {
    case 'timeout':
      return {
        detail: `连接 ${target} 超时（超过 ${Math.round(timeoutMs / 1000)}s）`,
        hint: `网络不通或端口被拦截：确认本机能访问外网；公司网络/防火墙/VPN 可能拦住 ${target}（25/465/587 端口尤其常见）。可先换手机热点或排查代理设置，再重跑 doctor。`,
      };
    case 'dns':
      return {
        detail: `域名解析失败：${target}（${shortError(err)}）`,
        hint: `host 写错或本机 DNS 异常：检查 .env 里的 host 是否为服务商域名（如 imap.qq.com / smtp.qq.com / open.feishu.cn），不要带端口、协议前缀或空格。可用 nslookup ${host} 验证；代理/VPN 的 DNS 也可能导致解析失败。`,
      };
    case 'refused':
      return {
        detail: `连接被拒绝：${target}（${shortError(err)}）`,
        hint: `目标端口未开放或被中间设备拒绝：核对 .env 的 host/端口是否与服务商一致（IMAP 993、SMTP 465/587）；若开了代理/VPN，尝试关闭后重试。`,
      };
    case 'tls':
      return {
        detail: `TLS/证书握手失败：${target}（${shortError(err)}）`,
        hint: `加密方式与端口不匹配：993/465 用隐式 TLS，143/587 用 STARTTLS；若使用公司代理，可能需要导入代理根证书。检查 .env 的 *_IMAP_SECURE / *_SMTP_SECURE 与端口是否匹配。`,
      };
  }
}

/** HTTP 探针异常：网络类走 explainNetworkError，其余给通用提示 */
function explainProbeError(err: unknown, target: string, timeoutMs: number): ErrorAdvice {
  const network = explainNetworkError(err, target, timeoutMs);
  if (network) return network;
  return {
    detail: `请求失败：${shortError(err)}`,
    hint: `检查网络/代理能否访问 ${target}；如果是自建网关，确认 .env 的 *_BASE_URL 指向正确地址。`,
  };
}

// ---------------------------------------------------------------------------
// 飞书
// ---------------------------------------------------------------------------

/** 飞书错误码 → 中文原因 + 修复建议（纯函数，单测覆盖 21001 / 10014 / 超时） */
export function explainFeishuError(code: number | undefined, msg?: string): ErrorAdvice {
  const m = (msg ?? '').trim();
  const suffix = m ? `（${m}）` : '';
  switch (code) {
    case 21001:
      return {
        detail: `飞书返回错误码 21001${suffix}：应用所在租户的策略/合规限制，导致无法获取 tenant_access_token`,
        hint: '21001 是租户级策略，改代码/改 Secret 都救不了：① 该应用必须挂在已完成企业认证的租户下（个人版、未认证租户常被拒）；② 飞书开放平台 → 开发者后台，检查「安全设置 → 租户策略」是否禁止自建应用获取 token，以及「可用成员/部门范围」是否为空；③ 实在开不通就换一个合规租户重新创建自建应用，只需改 .env 的 FEISHU_APP_ID / FEISHU_APP_SECRET。',
      };
    case 10014:
      return {
        detail: `飞书返回错误码 10014${suffix}：App Secret 不正确`,
        hint: '到飞书开放平台 → 应用 → 凭证与基础信息，重新复制 App Secret（注意别复制成 App ID），更新 .env 的 FEISHU_APP_SECRET 后重跑 doctor。如果是刚重置过 Secret，旧值会立刻失效。',
      };
    case 10003:
      return {
        detail: `飞书返回错误码 10003${suffix}：App ID 不存在或应用已被删除`,
        hint: '核对 .env 的 FEISHU_APP_ID 是否与开放平台一致（不要带空格）；确认应用没有被删除、当前账号仍能看到该应用。',
      };
    case 99991663:
      return {
        detail: `飞书返回错误码 99991663${suffix}：tenant_access_token 无效`,
        hint: '更换 App Secret 后旧 token 会失效；重跑 doctor 即可。若持续出现，确认 FEISHU_BASE_URL 与创建应用的数据中心一致（国内 open.feishu.cn / 国际版 open.larksuite.com）。',
      };
    default:
      return {
        detail: `飞书返回错误码 ${code ?? '未知'}${suffix}`,
        hint: '对照飞书开放平台错误码文档排查：https://open.feishu.cn/document/server-docs/getting-started/server-error-codes；同时确认应用已发布版本、已开通所需权限。',
      };
  }
}

/** 飞书探针：POST tenant_access_token/internal（只换 token，不发消息） */
export async function probeFeishuToken(input: FeishuProbeInput, timeoutMs = PROBE_TIMEOUT_MS): Promise<CheckResult> {
  const id = 'feishu:token';
  const title = '飞书 tenant_access_token（应用凭据校验）';
  if (!input.appId || !input.appSecret) {
    return {
      group: Platform.FEISHU,
      id,
      title,
      status: 'FAIL',
      detail: '缺少 FEISHU_APP_ID / FEISHU_APP_SECRET，无法获取 tenant_access_token',
      hint: '到飞书开放平台 → 应用 → 凭证与基础信息，复制 App ID / App Secret 填入 .env（注意别把 App Secret 粘成 App ID）。',
    };
  }
  const baseUrl = trimBaseUrl(input.baseUrl, DEFAULT_FEISHU_BASE_URL);
  const url = `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`;
  try {
    const r = await requestJson('POST', url, { app_id: input.appId, app_secret: input.appSecret }, timeoutMs);
    const code = Number(r.data?.code);
    if (r.ok && code === 0 && r.data?.tenant_access_token) {
      const expire = Number(r.data?.expire ?? 0) || '未知';
      return {
        group: Platform.FEISHU,
        id,
        title,
        status: 'PASS',
        detail: `tenant_access_token 获取成功（有效期 ${expire}s；只换取 token，未发送任何消息）。`,
      };
    }
    if (Number.isFinite(code) || r.data?.msg) {
      const advice = explainFeishuError(Number.isFinite(code) ? code : undefined, r.data?.msg);
      return { group: Platform.FEISHU, id, title, status: 'FAIL', ...advice };
    }
    return {
      group: Platform.FEISHU,
      id,
      title,
      status: 'FAIL',
      detail: `飞书接口返回 HTTP ${r.status}：${previewBody(r.text)}`,
      hint: httpHint('飞书', baseUrl),
    };
  } catch (e) {
    const advice = explainProbeError(e, `飞书接口 ${hostOf(baseUrl)}`, timeoutMs);
    return { group: Platform.FEISHU, id, title, status: 'FAIL', ...advice };
  }
}

// ---------------------------------------------------------------------------
// 钉钉
// ---------------------------------------------------------------------------

/** 钉钉错误响应 → 中文原因 + 修复建议（纯函数） */
export function explainDingtalkError(payload: {
  code?: unknown;
  errcode?: unknown;
  message?: unknown;
  errmsg?: unknown;
}): ErrorAdvice {
  const code = String(payload.errcode ?? payload.code ?? '').trim();
  const msg = String(payload.errmsg ?? payload.message ?? '').trim();
  const text = `${code} ${msg}`.toLowerCase();
  const suffix = msg ? `（${msg}）` : '';

  if (/invalidauthentication|不合法的clientid|不合法的clientsecret|invalid client/.test(text)) {
    return {
      detail: `钉钉返回认证失败${code ? `（${code}）` : ''}${suffix}：Client ID / Client Secret 不正确`,
      hint: '钉钉开放平台 → 应用 → 凭证与基础信息，重新复制 Client ID / Client Secret（旧版后台叫 AppKey / AppSecret），更新 .env 的 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET 后重跑 doctor。',
    };
  }
  if (/40089/.test(text)) {
    return {
      detail: `钉钉返回错误码 40089${suffix}：不合法的 Client ID / Client Secret`,
      hint: '同上：核对 .env 的 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET；如果是刚重置过 Secret，旧值已失效。',
    };
  }
  if (/40001|40014/.test(text)) {
    return {
      detail: `钉钉返回 access_token 相关错误${code ? `（${code}）` : ''}${suffix}`,
      hint: 'doctor 是直接换新 token，出现该错误通常说明 baseUrl 指向了错误环境或代理改写了响应；核对 DINGTALK_BASE_URL，并确认应用已发布。',
    };
  }
  if (/forbidden|no permission|无权限|权限|scope/.test(text)) {
    return {
      detail: `钉钉返回权限错误${code ? `（${code}）` : ''}${suffix}`,
      hint: '到钉钉开放平台 → 应用 → 权限管理，开通消息/机器人相关权限并重新发布版本；同时确认机器人已添加到目标群/企业。',
    };
  }
  return {
    detail: `钉钉返回错误 ${code || '未知'}${suffix}`,
    hint: '核对 .env 的 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET；确认应用已发布版本、已添加机器人能力；旧版后台变量名为 DINGTALK_APP_KEY / DINGTALK_APP_SECRET（仍兼容）。',
  };
}

/** 钉钉探针：POST /v1.0/oauth2/accessToken（只换 token，不发消息） */
export async function probeDingtalkToken(input: DingtalkProbeInput, timeoutMs = PROBE_TIMEOUT_MS): Promise<CheckResult> {
  const id = 'dingtalk:token';
  const title = '钉钉 accessToken（应用凭据校验）';
  if (!input.appKey || !input.appSecret) {
    return {
      group: Platform.DINGTALK,
      id,
      title,
      status: 'FAIL',
      detail: '缺少 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET，无法获取 accessToken',
      hint: '到钉钉开放平台 → 应用 → 凭证与基础信息，复制 Client ID / Client Secret 填入 .env（旧版后台叫 AppKey / AppSecret，也兼容）。',
    };
  }
  const baseUrl = trimBaseUrl(input.baseUrl, DEFAULT_DINGTALK_BASE_URL);
  const url = `${baseUrl}/v1.0/oauth2/accessToken`;
  try {
    const r = await requestJson('POST', url, { appKey: input.appKey, appSecret: input.appSecret }, timeoutMs);
    const accessToken = r.data?.accessToken;
    const code = r.data?.code;
    if (accessToken && (code === undefined || Number(code) === 0)) {
      const expire = Number(r.data?.expireIn ?? 0) || '未知';
      return {
        group: Platform.DINGTALK,
        id,
        title,
        status: 'PASS',
        detail: `accessToken 获取成功（有效期 ${expire}s；只换取 token，未发送任何消息）。`,
      };
    }
    if (code !== undefined || r.data?.errcode !== undefined || r.data?.message || r.data?.errmsg) {
      const advice = explainDingtalkError(r.data ?? {});
      return { group: Platform.DINGTALK, id, title, status: 'FAIL', ...advice };
    }
    return {
      group: Platform.DINGTALK,
      id,
      title,
      status: 'FAIL',
      detail: `钉钉接口返回 HTTP ${r.status}：${previewBody(r.text)}`,
      hint: httpHint('钉钉', baseUrl),
    };
  } catch (e) {
    const advice = explainProbeError(e, `钉钉接口 ${hostOf(baseUrl)}`, timeoutMs);
    return { group: Platform.DINGTALK, id, title, status: 'FAIL', ...advice };
  }
}

/** 钉钉的收发配置检查（机器人编码 / Stream vs HTTP 回调），纯函数，不联网 */
export function dingtalkConfigChecks(input: DingtalkProbeInput): CheckResult[] {
  const checks: CheckResult[] = [];

  // 1) 机器人编码 = 真实发送能力
  if (input.robotCode.trim()) {
    checks.push({
      group: Platform.DINGTALK,
      id: 'dingtalk:robot',
      title: '钉钉机器人编码（DINGTALK_ROBOT_CODE）',
      status: 'PASS',
      detail: input.robotCodeExplicit
        ? '已显式配置 DINGTALK_ROBOT_CODE：具备真实发送机器人消息的能力。'
        : '未显式配置 DINGTALK_ROBOT_CODE，已自动回退使用 Client ID（企业内部应用通常可用）；若发送报机器人相关错误，请到开放平台复制 RobotCode 填上。',
    });
  } else {
    checks.push({
      group: Platform.DINGTALK,
      id: 'dingtalk:robot',
      title: '钉钉机器人编码（DINGTALK_ROBOT_CODE）',
      status: 'FAIL',
      detail: '未配置 DINGTALK_ROBOT_CODE：无法真实发送机器人消息（只能换 token）。',
      hint: '钉钉开放平台 → 应用 → 应用能力 → 机器人，获取 RobotCode（企业内部应用通常与 Client ID 相同），写入 .env 的 DINGTALK_ROBOT_CODE。',
    });
  }

  // 2) 收消息通道 = Stream 长连接 或 HTTP 回调
  if (input.stream) {
    checks.push({
      group: Platform.DINGTALK,
      id: 'dingtalk:stream',
      title: '钉钉收消息通道（Stream 长连接 / HTTP 回调）',
      status: 'PASS',
      detail:
        'DINGTALK_STREAM=true：使用 Stream 长连接收消息，本机无需公网回调。请确认开放平台「机器人 → 消息接收模式」选的是 Stream，且应用版本已发布。',
    });
  } else if (input.aesToken && input.aesKey) {
    checks.push({
      group: Platform.DINGTALK,
      id: 'dingtalk:stream',
      title: '钉钉收消息通道（Stream 长连接 / HTTP 回调）',
      status: 'PASS',
      detail: '未开启 Stream，但已配置 DINGTALK_AES_TOKEN / DINGTALK_AES_KEY：走 HTTP 回调收消息，需要公网可访问的回调地址。',
    });
  } else {
    checks.push({
      group: Platform.DINGTALK,
      id: 'dingtalk:stream',
      title: '钉钉收消息通道（Stream 长连接 / HTTP 回调）',
      status: 'FAIL',
      detail: 'DINGTALK_STREAM=false 且未配置 DINGTALK_AES_TOKEN / DINGTALK_AES_KEY：当前收不到任何消息。',
      hint: '二选一：① 开放平台开启 Stream 长连接（推荐，本机无需公网），设置 .env 的 DINGTALK_STREAM=true；② 配置 HTTP 回调的 AES Token / Key 并暴露公网回调地址。改完都要重新发布应用版本。',
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// 企业微信 + 出口 IP
// ---------------------------------------------------------------------------

/** 企业微信 errcode → 中文原因 + 修复建议（纯函数；60020 会带上出口公网 IP） */
export function explainWecomError(
  errcode: number | undefined,
  errmsg?: string,
  opts: { egressIp?: string | null } = {},
): ErrorAdvice {
  const m = (errmsg ?? '').trim();
  const suffix = m ? `（${m}）` : '';
  const ipLine = opts.egressIp
    ? `当前出口公网 IP：${opts.egressIp}`
    : '未能自动探测到出口公网 IP（可手动访问 https://ifconfig.me/ip 查看）';

  switch (errcode) {
    case 60020: {
      const ip = opts.egressIp || '你的公网出口 IP';
      return {
        detail: `企业微信返回 60020${suffix}：调用来源 IP 不在「企业可信IP」内；${ipLine}`,
        hint: `60020 = 出口 IP 不在白名单。修复步骤：① 登录企业微信管理后台（work.weixin.qq.com）→ 应用管理 → 自建应用（AgentId 对应 WECOM_AGENT_ID）→ 企业可信IP → 配置；② 把 ${ip} 加入可信 IP 并保存（必须使用稳定公网出口：云服务器弹性 IP / 固定专线；家用宽带 IP 会变，可先临时加白验证，正式部署建议上云）；③ 保存后等待约 1 分钟，重跑 doctor 确认变 PASS。`,
      };
    }
    case 40013:
      return {
        detail: `企业微信返回 40013${suffix}：WECOM_CORP_ID 不正确（invalid corpid）`,
        hint: '企业微信管理后台 → 我的企业 → 企业信息，复制「企业ID」写入 .env 的 WECOM_CORP_ID（别和 AppID / AgentId 搞混）。',
      };
    case 40001:
      return {
        detail: `企业微信返回 40001${suffix}：WECOM_SECRET 不正确（invalid credential）`,
        hint: '企业微信管理后台 → 应用管理 → 自建 → 应用详情页，点 Secret 的「眼睛」图标复制（不要点重置，重置后旧 Secret 立即失效），写入 .env 的 WECOM_SECRET。',
      };
    case 40014:
      return {
        detail: `企业微信返回 40014${suffix}：access_token 无效`,
        hint: 'doctor 是直接换新 token，出现 40014 通常说明 baseUrl 配置错误或代理改写了响应；核对 WECOM_BASE_URL（默认 https://qyapi.weixin.qq.com），并确认 Secret 没有被重置。',
      };
    case 41001:
      return {
        detail: `企业微信返回 41001${suffix}：缺少 access_token`,
        hint: '通常是 baseUrl/代理问题；核对 WECOM_BASE_URL 后重跑 doctor。',
      };
    case 60011:
      return {
        detail: `企业微信返回 60011${suffix}：应用无权限/不在可见范围`,
        hint: '企业微信管理后台 → 应用管理 → 自建应用 → 可见范围，把需要收发的成员/部门加进去，然后重跑 doctor。',
      };
    default:
      return {
        detail: `企业微信返回错误 ${errcode ?? '未知'}${suffix}`,
        hint: '核对 .env 的 WECOM_CORP_ID / WECOM_SECRET / WECOM_AGENT_ID / WECOM_BASE_URL；若与发信有关，重点检查「企业可信IP」（60020 可先看 doctor 展示的出口公网 IP）。',
      };
  }
}

/**
 * 探测本机出口公网 IP（企微 60020 用）：
 * 先试 api.ipify.org，失败再试 ifconfig.me；都失败返回 null（不阻断主流程）。
 */
export async function fetchEgressIp(timeoutMs = EGRESS_TIMEOUT_MS): Promise<string | null> {
  const endpoints: { url: string; parse: (res: Response) => Promise<string> }[] = [
    {
      url: 'https://api.ipify.org?format=json',
      parse: async (res) => {
        const data = (await res.json()) as { ip?: unknown };
        return typeof data?.ip === 'string' ? data.ip : '';
      },
    },
    {
      url: 'https://ifconfig.me/ip',
      parse: async (res) => (await res.text()).trim(),
    },
  ];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const ip = (await ep.parse(res)).trim();
      if (isIpLike(ip)) return ip;
    } catch {
      // 这个接口失败就换下一个，出口 IP 只是附加信息
    }
  }
  return null;
}

export interface WecomProbeOutcome {
  check: CheckResult;
  egressIp?: string;
}

/** 企业微信探针：GET /cgi-bin/gettoken（只换 token，不发消息；60020 时附带出口 IP） */
export async function probeWecomToken(input: WecomProbeInput, timeoutMs = PROBE_TIMEOUT_MS): Promise<WecomProbeOutcome> {
  const id = 'wecom:token';
  const title = '企业微信 access_token（应用凭据校验）';
  if (!input.corpId || !input.secret) {
    return {
      check: {
        group: Platform.WECOM,
        id,
        title,
        status: 'FAIL',
        detail: '缺少 WECOM_CORP_ID / WECOM_SECRET，无法获取 access_token',
        hint: '企业微信管理后台：我的企业 → 企业信息 取企业ID；应用管理 → 自建应用 → 应用详情 取 Secret，分别填入 .env 的 WECOM_CORP_ID / WECOM_SECRET。',
      },
    };
  }
  const baseUrl = trimBaseUrl(input.baseUrl, DEFAULT_WECOM_BASE_URL);
  const qs = new URLSearchParams({ corpid: input.corpId, corpsecret: input.secret }).toString();
  const url = `${baseUrl}/cgi-bin/gettoken?${qs}`;
  try {
    const r = await requestJson('GET', url, undefined, timeoutMs);
    const errcode = r.data?.errcode;
    if (Number(errcode) === 0 && r.data?.access_token) {
      const expire = Number(r.data?.expires_in ?? 0) || '未知';
      return {
        check: {
          group: Platform.WECOM,
          id,
          title,
          status: 'PASS',
          detail: `access_token 获取成功（有效期 ${expire}s；只换取 token，未发送任何消息）。`,
        },
      };
    }

    let egressIp: string | undefined;
    if (Number(errcode) === 60020) {
      const ip = await fetchEgressIp(Math.min(timeoutMs, EGRESS_TIMEOUT_MS));
      if (ip) egressIp = ip;
    }

    if (Number.isFinite(Number(errcode))) {
      const advice = explainWecomError(Number(errcode), r.data?.errmsg, { egressIp });
      return { check: { group: Platform.WECOM, id, title, status: 'FAIL', ...advice }, ...(egressIp ? { egressIp } : {}) };
    }
    return {
      check: {
        group: Platform.WECOM,
        id,
        title,
        status: 'FAIL',
        detail: `企业微信接口返回 HTTP ${r.status}：${previewBody(r.text)}`,
        hint: httpHint('企业微信', baseUrl),
      },
    };
  } catch (e) {
    const advice = explainProbeError(e, `企业微信接口 ${hostOf(baseUrl)}`, timeoutMs);
    return { check: { group: Platform.WECOM, id, title, status: 'FAIL', ...advice } };
  }
}

// ---------------------------------------------------------------------------
// 邮箱（IMAP 只 SEARCH 立基线 / SMTP 只登录 QUIT）
// ---------------------------------------------------------------------------

/** 邮箱探针注入点（单测传假实现；生产不传） */
export interface MailProbeDeps {
  fetchNewMails?: typeof fetchNewMails;
  verifySmtpAuth?: typeof verifySmtpAuth;
}

type ImapTarget = Pick<MailAccount, 'key' | 'address' | 'imapHost' | 'imapPort'>;
type SmtpTarget = Pick<MailAccount, 'key' | 'address' | 'smtpHost' | 'smtpPort'>;

function mailEnvPrefix(key: string): string {
  return `MAIL_${key.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
}

/** IMAP 错误 → 中文原因 + 修复建议（Unsafe Login / 登录失败 / 网络） */
export function explainImapError(err: unknown, account: ImapTarget): ErrorAdvice {
  const raw = errorMessage(err);
  const target = `${account.imapHost}:${account.imapPort}`;
  const masked = maskAddress(account.address);
  const prefix = mailEnvPrefix(account.key);

  const network = explainNetworkError(err, target);
  if (network) return network;

  if (/unsafe\s*login/i.test(raw)) {
    return {
      detail: `IMAP 登录被服务端风控拒绝（Unsafe Login）：${shortError(err)}`,
      hint: `网易/QQ 会把不报客户端身份的连接判为 Unsafe Login：① 确认 ${prefix}_AUTH_CODE 是网页端生成的「授权码」而不是登录密码；② 到邮箱网页版「设置 → POP3/SMTP/IMAP」重新开启 IMAP 服务并生成授权码；③ 163/126 如有「第三方客户端登录限制 / 安全登录」需按提示关闭或改用授权码；④ 本项目的 IMAP 客户端已自动补齐 ID 命令，若仍报错通常是服务商风控，换网络重试或联系邮箱服务商。`,
    };
  }
  if (/登录失败|authenticationfailed|login failed|invalid credentials|auth/i.test(raw)) {
    return {
      detail: `IMAP 登录失败（${masked} @ ${target}）：${shortError(err)}`,
      hint: `99% 是授权码问题：① 检查 .env 的 ${prefix}_AUTH_CODE 是否为邮箱网页端生成的授权码（通常 16 位，不是登录密码，别带空格）；② QQ 邮箱：设置 → 账号与安全 → 安全设置 → POP3/IMAP/SMTP 服务 → 开启并生成授权码；③ 163/126：设置 → POP3/SMTP/IMAP → 开启服务并新增授权密码（只显示一次）；④ 刚改过密码/授权码时以最新授权码为准。`,
    };
  }
  if (/选择目录|select/i.test(raw)) {
    return {
      detail: `IMAP 登录成功但选择目录失败（${masked} @ ${target}）：${shortError(err)}`,
      hint: `检查 .env 的 ${prefix}_FOLDERS 目录名：QQ/163 收件箱用 INBOX、垃圾箱用 Junk（区分大小写、不要带引号）；多个目录用逗号分隔。`,
    };
  }
  if (/检索|search/i.test(raw)) {
    return {
      detail: `IMAP 检索失败（${masked} @ ${target}）：${shortError(err)}`,
      hint: '服务端不支持 UID SEARCH 或连接被中断：换网络重试；如果邮箱服务商有安全限制，先在网页端确认 IMAP 服务正常。',
    };
  }
  if (/STARTTLS/i.test(raw)) {
    return {
      detail: `IMAP STARTTLS 升级失败（${masked} @ ${target}）：${shortError(err)}`,
      hint: `该端口不支持 STARTTLS：优先改用 993 隐式 TLS（设置 ${prefix}_IMAP_PORT=993、${prefix}_IMAP_SECURE=true）；143 端口才走 STARTTLS（${prefix}_IMAP_SECURE=false）；公司代理可能拦截 STARTTLS，可换网络重试。`,
    };
  }
  return {
    detail: `IMAP 探针失败（${masked} @ ${target}）：${shortError(err)}`,
    hint: `核对 .env 的 ${prefix}_IMAP_HOST / ${prefix}_IMAP_PORT / ${prefix}_IMAP_SECURE 与邮箱服务商一致（QQ/163：imap.xxx.com:993 + 隐式 TLS）；必要时换网络重试。`,
  };
}

/** SMTP 错误 → 中文原因 + 修复建议（535 授权码 / STARTTLS / 网络） */
export function explainSmtpError(err: unknown, account: SmtpTarget): ErrorAdvice {
  const raw = errorMessage(err);
  const target = `${account.smtpHost}:${account.smtpPort}`;
  const masked = maskAddress(account.address);
  const prefix = mailEnvPrefix(account.key);

  const network = explainNetworkError(err, target);
  if (network) return network;

  const smtpCode = raw.match(/SMTP\s+(\d{3})\b/i)?.[1];
  switch (smtpCode) {
    case '535':
    case '534':
    case '530':
      return {
        detail: `SMTP ${smtpCode} 认证失败（${masked} @ ${target}）：${shortError(err)}`,
        hint: `535 基本就是授权码错误或服务商未开启 SMTP：① 确认 .env 的 ${prefix}_AUTH_CODE 是网页端生成的授权码（不是网页登录密码，别带空格）；② QQ：设置 → 账号与安全 → 安全设置 → POP3/IMAP/SMTP 服务 → 开启并生成授权码；③ 163/126：设置 → POP3/SMTP/IMAP → 开启服务并新增授权密码；④ QQ/网易要求发信地址与登录账号一致，项目已按此实现；⑤ 若授权码刚重置，用最新授权码重跑 doctor。`,
      };
    case '550':
    case '553':
      return {
        detail: `SMTP ${smtpCode} 请求被拒（${masked} @ ${target}）：${shortError(err)}`,
        hint: '发信请求被服务端拒绝：确认发信地址与登录账号一致；检查收件人地址是否被服务商限制；企业邮箱可能要求先在管理后台开通外发权限。',
      };
    case '421':
    case '450':
    case '451':
    case '452':
      return {
        detail: `SMTP ${smtpCode} 临时限制（${masked} @ ${target}）：${shortError(err)}`,
        hint: '服务商临时限流/反垃圾拦截：降低发送频率，稍后重试；频繁自测同一账号可能被临时限制，可换账号验证。',
      };
    case '554':
      return {
        detail: `SMTP ${smtpCode} 被判定为垃圾邮件/未开通发信（${masked} @ ${target}）：${shortError(err)}`,
        hint: '检查邮箱是否已开通 SMTP 发信服务、是否触发反垃圾策略；新账号可能需要先用网页端正常收发几封邮件，或联系服务商解封。',
      };
    default:
      break;
  }
  if (/STARTTLS|未声明 STARTTLS/i.test(raw)) {
    return {
      detail: `SMTP STARTTLS 不可用（${masked} @ ${target}）：${shortError(err)}`,
      hint: `该端口不支持 STARTTLS：优先改用 465 隐式 TLS（设置 ${prefix}_SMTP_PORT=465、${prefix}_SMTP_SECURE=true）；587 端口走 STARTTLS（${prefix}_SMTP_SECURE=false）；25 端口常被云厂商封禁，不建议使用。`,
    };
  }
  return {
    detail: `SMTP 探针失败（${masked} @ ${target}）：${shortError(err)}`,
    hint: `核对 .env 的 ${prefix}_SMTP_HOST / ${prefix}_SMTP_PORT / ${prefix}_SMTP_SECURE：465=隐式TLS，587=STARTTLS；企业网络可能封 25/465/587，换网络重试。`,
  };
}

/** 给 Promise 加超时（超时后原 Promise 的迟到结果会被吞掉，不会造成未处理拒绝） */
function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 单个邮箱账号的探测：IMAP 登录基线 + SMTP 登录自检（各 8s 超时）。
 * 只读：IMAP 只 SEARCH、SMTP 只登录 + QUIT，都不投递。
 */
export async function probeMailAccount(
  account: MailAccount,
  opts: { deps?: MailProbeDeps; timeoutMs?: number } = {},
): Promise<CheckResult[]> {
  const deps = opts.deps ?? {};
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const imapFn = deps.fetchNewMails ?? fetchNewMails;
  const smtpFn = deps.verifySmtpAuth ?? verifySmtpAuth;
  const masked = maskAddress(account.address);
  const folder = account.folders[0] ?? 'INBOX';
  const checks: CheckResult[] = [];

  // IMAP：登录 + SELECT + UID SEARCH 立基线（不取正文，不改已读状态）
  const imapId = `mail:${account.key}:imap`;
  const imapTitle = `邮箱 IMAP 登录基线（${masked}）`;
  try {
    const result = await withTimeout(imapFn(account, null, 0, folder), timeoutMs, 'IMAP 探针');
    checks.push({
      group: Platform.MAIL,
      id: imapId,
      title: imapTitle,
      status: 'PASS',
      detail: `登录 ${account.imapHost}:${account.imapPort} 成功并 SELECT ${folder}，当前 UID 基线 ${result.maxUid}（只做 UID SEARCH，未读取正文、未标记已读）。`,
    });
  } catch (e) {
    checks.push({
      group: Platform.MAIL,
      id: imapId,
      title: imapTitle,
      status: 'FAIL',
      ...explainImapError(e, account),
    });
  }

  // SMTP：只做登录认证自检 + QUIT（不发送邮件）
  const smtpId = `mail:${account.key}:smtp`;
  const smtpTitle = `邮箱 SMTP 登录自检（${masked}）`;
  try {
    const result = await withTimeout(smtpFn(account), timeoutMs, 'SMTP 探针');
    checks.push({
      group: Platform.MAIL,
      id: smtpId,
      title: smtpTitle,
      status: 'PASS',
      detail: `登录 ${account.smtpHost}:${account.smtpPort} 认证成功（${result.auth.toUpperCase()} 机制，${result.secure ? '链路已加密' : '链路未加密'}）；只登录 + QUIT，未发送任何邮件。`,
    });
  } catch (e) {
    checks.push({
      group: Platform.MAIL,
      id: smtpId,
      title: smtpTitle,
      status: 'FAIL',
      ...explainSmtpError(e, account),
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// 编排：按平台模式决定探测 or SKIP
// ---------------------------------------------------------------------------

/** 平台当前是否该跑真实探针：实际走 real，或用户显式强制 real */
function shouldProbe(runtime: PlatformProbeRuntime): boolean {
  return runtime.mode === 'real' || runtime.policy === 'real';
}

/** 未启用真实通道时的 SKIP 结果（说明原因 + 如何切换到真实接入） */
export function skipProbe(platform: Platform, runtime: PlatformProbeRuntime): CheckResult {
  const label = PLATFORM_LABELS[platform];
  const modeKey = MODE_ENV_KEYS[platform];
  const missingText = runtime.missing.length > 0 ? `缺失环境变量：${runtime.missing.join(' / ')}。` : '';
  return {
    group: platform,
    id: `${platform}:skipped`,
    title: `${label} 真实通道探针`,
    status: 'SKIP',
    detail: `未启用真实通道（策略 ${runtime.policy} → 实际 ${runtime.mode}），按约定跳过真实探针。`,
    hint: `${missingText}补齐后 auto 会自动切到真实接口；也可临时设置 ${modeKey}=real 强制自检（凭据不全时会显式 FAIL，不会静默假成功）。`,
  };
}

/**
 * 执行全部探针（只读）。
 * 仅对 mode=real 或 policy=real 的平台执行；其余输出 SKIP 并说明原因。
 */
export async function runProbes(input: ProbeInput, options: RunProbesOptions = {}): Promise<RunProbesResult> {
  const checks: CheckResult[] = [];
  let egressIp: string | undefined;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const filter = options.platformFilter && options.platformFilter.length > 0 ? new Set(options.platformFilter) : undefined;
  const want = (platform: Platform): boolean => !filter || filter.has(platform);
  const runtimeOf = (platform: Platform): PlatformProbeRuntime => input.runtime[platform];

  if (want(Platform.FEISHU)) {
    const runtime = runtimeOf(Platform.FEISHU);
    if (shouldProbe(runtime)) checks.push(await probeFeishuToken(input.feishu, timeoutMs));
    else checks.push(skipProbe(Platform.FEISHU, runtime));
  }

  if (want(Platform.DINGTALK)) {
    const runtime = runtimeOf(Platform.DINGTALK);
    if (shouldProbe(runtime)) {
      checks.push(await probeDingtalkToken(input.dingtalk, timeoutMs));
      checks.push(...dingtalkConfigChecks(input.dingtalk));
    } else {
      checks.push(skipProbe(Platform.DINGTALK, runtime));
    }
  }

  if (want(Platform.WECOM)) {
    const runtime = runtimeOf(Platform.WECOM);
    if (shouldProbe(runtime)) {
      const outcome = await probeWecomToken(input.wecom, timeoutMs);
      checks.push(outcome.check);
      if (outcome.egressIp) egressIp = outcome.egressIp;
    } else {
      checks.push(skipProbe(Platform.WECOM, runtime));
    }
  }

  if (want(Platform.MAIL)) {
    const runtime = runtimeOf(Platform.MAIL);
    if (!shouldProbe(runtime)) {
      checks.push(skipProbe(Platform.MAIL, runtime));
    } else if (input.mail.accounts.length === 0) {
      checks.push({
        group: Platform.MAIL,
        id: 'mail:accounts',
        title: '邮箱账号配置',
        status: 'FAIL',
        detail: '真实通道没有可探测的邮箱账号：当前策略是 real，但 .env 未解析出任何账号。',
        hint: '在 .env 填写 MAIL_QQ_ADDRESS / MAIL_QQ_AUTH_CODE（或 MAIL_ACCOUNTS + MAIL_<KEY>_ADDRESS / MAIL_<KEY>_AUTH_CODE）；授权码需要先在邮箱网页端开启 IMAP/SMTP 后生成。',
      });
    } else {
      for (const account of input.mail.accounts) {
        checks.push(
          ...(await probeMailAccount(account, {
            deps: options.deps,
            timeoutMs: options.mailTimeoutMs ?? MAIL_PROBE_TIMEOUT_MS,
          })),
        );
      }
    }
  }

  if (options.alwaysFetchEgressIp && !egressIp) {
    try {
      const ip = await fetchEgressIp();
      if (ip) egressIp = ip;
    } catch {
      // 出口 IP 只是附加信息，采集失败不影响主结论
    }
  }

  return { checks, ...(egressIp ? { egressIp } : {}) };
}
