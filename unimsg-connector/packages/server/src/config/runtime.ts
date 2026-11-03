/**
 * 运行时可替换性核心：把「环境变量 → 实际走哪条通道」变成可单测的纯函数。
 *
 * 设计目标（用户核心诉求）：把项目交给评审/同学时，他们换上自己的账号即可运行，
 * 不需要改代码、也不需要"猜"哪个平台现在是真接口、哪个是 Mock。
 *
 * 三条约定：
 *  1. 每个平台独立解析 `*_MODE` = auto | real | mock，默认 auto；
 *     auto = 凭据足够（能真实收或能真实发）就走真实接口，否则走本地 Mock。
 *  2. 解析结果带 `configured / canSend / canReceive / missing / warnings`，
 *     `/api/accounts`、启动日志、doctor 都直接消费它，绝不静默假装成功。
 *  3. 旧的全局 `MOCK` 降级为「未显式配置 *_MODE 时的默认策略」，并给出废弃警告。
 */
import { Platform, type DeliveryMode } from '@unimsg/shared';

export type ModePolicy = 'auto' | 'real' | 'mock';

/** 一次运行里某个平台解析后的完整画像 */
export interface PlatformRuntime {
  platform: Platform;
  label: string;
  /** 用户请求的策略（auto / 强制 real / 强制 mock） */
  policy: ModePolicy;
  /** 实际生效的通道（真实接口 / 本地模拟） */
  mode: DeliveryMode;
  /** 凭据是否足以真实工作 */
  configured: boolean;
  /** 是否具备真实收消息能力（webhook / 长连接 / IMAP 轮询） */
  canReceive: boolean;
  /** 是否具备真实发消息能力 */
  canSend: boolean;
  /** 缺哪些环境变量（用于 doctor 与前端提示，绝不含密钥值） */
  missing: string[];
  /** 已配置但存在能力缺口时的警告（例如"只能发不能收"） */
  warnings: string[];
  /** 人类可读的解析理由（前端账号页直接展示） */
  reason: string;
}

// ---------------------------------------------------------------------------
// 平台凭据读取
// ---------------------------------------------------------------------------

export interface FeishuCreds {
  appId: string;
  appSecret: string;
  verifyToken: string;
  encryptKey: string;
  /** 开放平台基址，默认 https://open.feishu.cn（Lark 国际版/代理可覆盖） */
  baseUrl: string;
}

export interface DingtalkCreds {
  appKey: string;
  appSecret: string;
  robotCode: string;
  aesToken: string;
  aesKey: string;
  stream: boolean;
  baseUrl: string;
}

export interface WecomCreds {
  corpId: string;
  agentId: string;
  secret: string;
  token: string;
  aesKey: string;
  baseUrl: string;
}

export interface PlatformCredentials {
  feishu: FeishuCreds;
  dingtalk: DingtalkCreds;
  wecom: WecomCreds;
}

export const DEFAULT_FEISHU_BASE_URL = 'https://open.feishu.cn';
export const DEFAULT_DINGTALK_BASE_URL = 'https://api.dingtalk.com';
export const DEFAULT_WECOM_BASE_URL = 'https://qyapi.weixin.qq.com';

function trimBase(v: string | undefined, fallback: string): string {
  const raw = (v ?? '').trim();
  return (raw || fallback).replace(/\/+$/, '');
}

/** 从环境变量读出三平台凭据（config.ts 与 doctor 共用同一套规则） */
export function readPlatformCredentials(env: NodeJS.ProcessEnv): PlatformCredentials {
  const dingAppKey = env.DINGTALK_CLIENT_ID ?? env.DINGTALK_APP_KEY ?? '';
  return {
    feishu: {
      appId: env.FEISHU_APP_ID ?? '',
      appSecret: env.FEISHU_APP_SECRET ?? '',
      verifyToken: env.FEISHU_VERIFY_TOKEN ?? '',
      encryptKey: env.FEISHU_ENCRYPT_KEY ?? '',
      baseUrl: trimBase(env.FEISHU_BASE_URL, DEFAULT_FEISHU_BASE_URL),
    },
    dingtalk: {
      // 新版后台叫 Client ID / Client Secret，旧版叫 AppKey / AppSecret
      appKey: dingAppKey,
      appSecret: env.DINGTALK_CLIENT_SECRET ?? env.DINGTALK_APP_SECRET ?? '',
      // 机器人编码：企业内部应用通常与 Client ID 相同
      robotCode: env.DINGTALK_ROBOT_CODE ?? dingAppKey,
      aesToken: env.DINGTALK_AES_TOKEN ?? '',
      aesKey: env.DINGTALK_AES_KEY ?? '',
      stream: truthy(env.DINGTALK_STREAM),
      baseUrl: trimBase(env.DINGTALK_BASE_URL, DEFAULT_DINGTALK_BASE_URL),
    },
    wecom: {
      corpId: env.WECOM_CORP_ID ?? '',
      agentId: env.WECOM_AGENT_ID ?? '',
      secret: env.WECOM_SECRET ?? '',
      token: env.WECOM_TOKEN ?? '',
      aesKey: env.WECOM_AES_KEY ?? '',
      baseUrl: trimBase(env.WECOM_BASE_URL, DEFAULT_WECOM_BASE_URL),
    },
  };
}

// ---------------------------------------------------------------------------
// 邮箱多账号：任意服务商、任意数量
// ---------------------------------------------------------------------------

/** 一个邮箱账号 = 一个可收可发的数据源（IMAP 收 + SMTP 发） */
export interface MailAccount {
  /** 环境变量段名，如 qq / 163 / work（externalId 前缀也用它） */
  key: string;
  label: string;
  address: string;
  /** 授权码（不是网页登录密码） */
  authCode: string;
  /** 服务商标识：qq / 163 / 126 / yeah / gmail / outlook / icloud / custom */
  provider: string;
  imapHost: string;
  imapPort: number;
  /** true=993 隐式 TLS；false=143 明文 + STARTTLS */
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  /** true=465 隐式 TLS；false=587/25 明文 + STARTTLS */
  smtpSecure: boolean;
  /** 监听的邮箱目录，默认只有 INBOX（反垃圾回收站可加 Junk） */
  folders: string[];
}

export interface MailAccountIssue {
  /** 对应的环境变量段（如果能判断出来） */
  key?: string;
  env?: string;
  level: 'error' | 'warn';
  message: string;
}

interface ProviderPreset {
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

/**
 * 常见服务商预设。换成列表里没有的邮箱也不用改代码：
 * 显式填 `MAIL_<KEY>_IMAP_HOST` / `_SMTP_HOST` 即可（provider=custom）。
 */
export const MAIL_PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  qq: { label: 'QQ邮箱', imapHost: 'imap.qq.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.qq.com', smtpPort: 465, smtpSecure: true },
  foxmail: { label: 'Foxmail', imapHost: 'imap.qq.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.qq.com', smtpPort: 465, smtpSecure: true },
  '163': { label: '网易163邮箱', imapHost: 'imap.163.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.163.com', smtpPort: 465, smtpSecure: true },
  '126': { label: '网易126邮箱', imapHost: 'imap.126.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.126.com', smtpPort: 465, smtpSecure: true },
  yeah: { label: '网易Yeah邮箱', imapHost: 'imap.yeah.net', imapPort: 993, imapSecure: true, smtpHost: 'smtp.yeah.net', smtpPort: 465, smtpSecure: true },
  gmail: { label: 'Gmail', imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true },
  outlook: { label: 'Outlook / Microsoft 365', imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false },
  icloud: { label: 'iCloud 邮箱', imapHost: 'imap.mail.me.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.mail.me.com', smtpPort: 587, smtpSecure: false },
  custom: { label: '自定义邮箱', imapHost: '', imapPort: 993, imapSecure: true, smtpHost: '', smtpPort: 465, smtpSecure: true },
};

const PROVIDER_ALIASES: Record<string, string> = {
  'qq.com': 'qq',
  'foxmail.com': 'qq',
  '163.com': '163',
  '126.com': '126',
  'yeah.net': 'yeah',
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'outlook.com': 'outlook',
  'hotmail.com': 'outlook',
  'live.com': 'outlook',
  'msn.com': 'outlook',
  'office365.com': 'outlook',
  'icloud.com': 'icloud',
  'me.com': 'icloud',
  'mac.com': 'icloud',
};

function normalizeProvider(raw: string): string {
  return raw.trim().toLowerCase().replace(/^mail\./, '').replace(/^(imap|smtp)\./, '');
}

/** 显式 provider 优先；否则按邮箱域名推断；未知域名 → custom（需显式 host） */
export function inferMailProvider(address: string, explicit?: string): string {
  const raw = (explicit ?? '').trim();
  if (raw) {
    const p = normalizeProvider(raw);
    return p in MAIL_PROVIDER_PRESETS ? p : p; // 未知名字保留，用于提示"未识别"
  }
  const domain = address.includes('@') ? address.split('@').pop()!.trim().toLowerCase() : '';
  return PROVIDER_ALIASES[domain] ?? 'custom';
}

function envSegFor(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function num(v: string | undefined, fallback: number): number {
  const n = Number((v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function csv(v: string | undefined, fallback: string[]): string[] {
  const items = (v ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

export interface MailAccountsParseResult {
  accounts: MailAccount[];
  issues: MailAccountIssue[];
}

/**
 * 解析邮箱账号（可单测，不依赖模块级 process.env）：
 *  - `MAIL_ACCOUNTS=qq,163,work` 显式列出账号与环境变量段；
 *  - 不写则自动发现所有 `MAIL_<KEY>_ADDRESS`，所以老配置（MAIL_QQ_* / MAIL_163_*）零改动可用；
 *  - provider 可显式指定，也可按邮箱域名推断；端口/加密方式可单独覆盖。
 */
export function parseMailAccounts(env: NodeJS.ProcessEnv): MailAccountsParseResult {
  const issues: MailAccountIssue[] = [];
  const explicit = (env.MAIL_ACCOUNTS ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.toLowerCase() !== 'auto');

  let keys: string[];
  if (explicit.length > 0) {
    keys = [...new Set(explicit.map((k) => k.toLowerCase()))];
  } else {
    const found = new Set<string>();
    for (const name of Object.keys(env)) {
      const m = name.match(/^MAIL_([A-Z0-9]+)_(ADDRESS|AUTH_CODE)$/);
      if (m) found.add(m[1].toLowerCase());
    }
    // 稳定顺序：按 key 字母序，避免不同 shell 环境变量顺序导致日志抖动
    keys = [...found].sort();
  }

  const accounts: MailAccount[] = [];
  for (const key of keys) {
    const seg = envSegFor(key);
    const prefix = `MAIL_${seg}`;
    const address = (env[`${prefix}_ADDRESS`] ?? '').trim();
    const authCode = (env[`${prefix}_AUTH_CODE`] ?? '').trim();

    if (!address && !authCode) {
      // 显式列在 MAIL_ACCOUNTS 里却什么都没填：值得报出来
      if (explicit.length > 0) {
        issues.push({
          key,
          env: `${prefix}_ADDRESS`,
          level: 'warn',
          message: `MAIL_ACCOUNTS 列出了 ${key}，但 ${prefix}_ADDRESS / ${prefix}_AUTH_CODE 都没有填写，已跳过`,
        });
      }
      continue;
    }
    if (!address) {
      issues.push({ key, env: `${prefix}_ADDRESS`, level: 'error', message: `${prefix}_AUTH_CODE 已填写，但缺少 ${prefix}_ADDRESS` });
      continue;
    }
    if (!authCode) {
      issues.push({
        key,
        env: `${prefix}_AUTH_CODE`,
        level: 'error',
        message: `邮箱 ${address} 缺少 ${prefix}_AUTH_CODE（需要网页端开启 IMAP/SMTP 后生成的授权码，不是登录密码）`,
      });
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      issues.push({ key, env: `${prefix}_ADDRESS`, level: 'error', message: `${prefix}_ADDRESS 不是合法邮箱地址：${address}` });
      continue;
    }

    const provider = inferMailProvider(address, env[`${prefix}_PROVIDER`]);
    const preset = MAIL_PROVIDER_PRESETS[provider];
    if (!preset) {
      issues.push({
        key,
        env: `${prefix}_PROVIDER`,
        level: 'warn',
        message: `未识别的邮箱服务商 "${provider}"，请改用 ${Object.keys(MAIL_PROVIDER_PRESETS).join(' / ')}，或直接填写 ${prefix}_IMAP_HOST / ${prefix}_SMTP_HOST`,
      });
    }
    const fallback = preset ?? MAIL_PROVIDER_PRESETS.custom;

    const imapHost = (env[`${prefix}_IMAP_HOST`] ?? fallback.imapHost).trim();
    const smtpHost = (env[`${prefix}_SMTP_HOST`] ?? fallback.smtpHost).trim();
    if (!imapHost || !smtpHost) {
      issues.push({
        key,
        env: `${prefix}_IMAP_HOST`,
        level: 'error',
        message: `邮箱 ${address} 的服务商 ${provider} 没有内置预设，必须填写 ${prefix}_IMAP_HOST 与 ${prefix}_SMTP_HOST`,
      });
      continue;
    }

    const imapPort = num(env[`${prefix}_IMAP_PORT`], fallback.imapPort);
    const smtpPort = num(env[`${prefix}_SMTP_PORT`], fallback.smtpPort);
    const imapSecureRaw = env[`${prefix}_IMAP_SECURE`];
    const smtpSecureRaw = env[`${prefix}_SMTP_SECURE`];
    // 端口能表达意图时就按端口推断（993→TLS，143→STARTTLS；465→TLS，587/25→STARTTLS）
    const imapSecure = imapSecureRaw !== undefined ? truthy(imapSecureRaw) : imapPort === 993 ? true : fallback.imapSecure && imapPort !== 143;
    const smtpSecure = smtpSecureRaw !== undefined ? truthy(smtpSecureRaw) : smtpPort === 465 ? true : smtpPort === 587 || smtpPort === 25 ? false : fallback.smtpSecure;

    accounts.push({
      key,
      label: (env[`${prefix}_LABEL`] ?? '').trim() || fallback.label,
      address,
      authCode,
      provider,
      imapHost,
      imapPort,
      imapSecure,
      smtpHost,
      smtpPort,
      smtpSecure,
      folders: csv(env[`${prefix}_FOLDERS`], ['INBOX']),
    });
  }

  return { accounts, issues };
}

/** 给前端/医生看的邮箱账号摘要（不含授权码） */
export function mailAccountSummary(a: MailAccount): {
  key: string;
  label: string;
  address: string;
  provider: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  folders: string[];
} {
  return {
    key: a.key,
    label: a.label,
    address: a.address,
    provider: a.provider,
    imapHost: a.imapHost,
    imapPort: a.imapPort,
    imapSecure: a.imapSecure,
    smtpHost: a.smtpHost,
    smtpPort: a.smtpPort,
    smtpSecure: a.smtpSecure,
    folders: a.folders,
  };
}

// ---------------------------------------------------------------------------
// 平台模式解析
// ---------------------------------------------------------------------------

export const MODE_ENV_KEYS: Record<Platform, string> = {
  [Platform.FEISHU]: 'FEISHU_MODE',
  [Platform.DINGTALK]: 'DINGTALK_MODE',
  [Platform.WECOM]: 'WECOM_MODE',
  [Platform.MAIL]: 'MAIL_MODE',
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  [Platform.FEISHU]: '飞书',
  [Platform.DINGTALK]: '钉钉',
  [Platform.WECOM]: '企业微信',
  [Platform.MAIL]: '邮箱',
};

export interface ModePolicyResult {
  policies: Record<Platform, ModePolicy>;
  warnings: string[];
}

export interface ModePolicyOptions {
  /** 单元测试环境：默认全部 mock，需要真实的用例自行 forceMode */
  underTest?: boolean;
}

function parsePolicy(raw: string | undefined): ModePolicy | undefined {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'auto' || v === 'real' || v === 'mock') return v;
  return undefined;
}

/**
 * 解析每个平台请求的策略。
 * 优先级：`<PLATFORM>_MODE` > 旧全局 `MOCK` > auto（未配置 = auto）。
 */
export function resolveModePolicies(env: NodeJS.ProcessEnv, opts: ModePolicyOptions = {}): ModePolicyResult {
  const warnings: string[] = [];
  const underTest = opts.underTest ?? false;

  let legacy: ModePolicy | undefined;
  const mockRaw = (env.MOCK ?? '').trim();
  if (mockRaw) {
    if (truthy(mockRaw)) legacy = 'mock';
    else if (['false', '0', 'no', 'off'].includes(mockRaw.toLowerCase())) legacy = 'real';
    else warnings.push(`MOCK=${mockRaw} 不是合法值（true/false），已忽略`);
    warnings.push('MOCK 已废弃：建议删除该变量，改用 FEISHU_MODE / DINGTALK_MODE / WECOM_MODE / MAIL_MODE=auto|real|mock');
  }

  const policies = {} as Record<Platform, ModePolicy>;
  for (const platform of Object.values(Platform)) {
    const envKey = MODE_ENV_KEYS[platform];
    const raw = env[envKey];
    const parsed = parsePolicy(raw);
    if (raw && raw.trim() && !parsed) {
      warnings.push(`${envKey}=${raw} 不是合法值（auto/real/mock），已回退默认策略`);
    }
    let policy: ModePolicy = parsed ?? legacy ?? 'auto';
    if (underTest) policy = 'mock'; // 单测默认不外呼，需要真实的用例显式 forceMode
    policies[platform] = policy;
  }
  return { policies, warnings };
}

export interface RuntimeBuildInput {
  env: NodeJS.ProcessEnv;
  platforms: PlatformCredentials;
  mailAccounts: MailAccount[];
  mailIssues: MailAccountIssue[];
  mailEnabled: boolean;
  underTest?: boolean;
}

interface CapabilityResult {
  configured: boolean;
  canReceive: boolean;
  canSend: boolean;
  missing: string[];
  warnings: string[];
}

function capability(platform: Platform, input: RuntimeBuildInput): CapabilityResult {
  const { platforms: p } = input;
  const missing: string[] = [];
  const warnings: string[] = [];

  if (platform === Platform.FEISHU) {
    if (!p.feishu.appId) missing.push('FEISHU_APP_ID');
    if (!p.feishu.appSecret) missing.push('FEISHU_APP_SECRET');
    if (!p.feishu.verifyToken) missing.push('FEISHU_VERIFY_TOKEN');
    const canSend = Boolean(p.feishu.appId && p.feishu.appSecret);
    // 收：webhook 验签必须有 Verification Token；Encrypt Key 只决定报文是否加密
    const canReceive = Boolean(p.feishu.verifyToken);
    if (canSend && !canReceive) warnings.push('只能发不能收：缺少 FEISHU_VERIFY_TOKEN（回调验签）');
    if (canSend && !p.feishu.encryptKey) warnings.push('未配置 FEISHU_ENCRYPT_KEY：仅支持未加密回调（若后台开了加密策略会解密失败）');
    return { configured: canSend, canSend, canReceive, missing, warnings };
  }

  if (platform === Platform.DINGTALK) {
    if (!p.dingtalk.appKey) missing.push('DINGTALK_CLIENT_ID');
    if (!p.dingtalk.appSecret) missing.push('DINGTALK_CLIENT_SECRET');
    // AES Token/Key 仅在 HTTP 回调模式需要；开了 Stream 长连接就不算缺失（否则启动日志会误报）
    if (!p.dingtalk.stream) {
      if (!p.dingtalk.aesToken) missing.push('DINGTALK_AES_TOKEN');
      if (!p.dingtalk.aesKey) missing.push('DINGTALK_AES_KEY');
    }
    const canSend = Boolean(p.dingtalk.appKey && p.dingtalk.appSecret && p.dingtalk.robotCode);
    // 收：Stream 长连接只需 Client ID/Secret；HTTP 回调需要 AES Token/Key
    const canReceive = Boolean(p.dingtalk.appKey && p.dingtalk.appSecret && (p.dingtalk.stream || (p.dingtalk.aesToken && p.dingtalk.aesKey)));
    if (canSend && !p.dingtalk.robotCode) warnings.push('缺少 DINGTALK_ROBOT_CODE，无法真实发送');
    if (!p.dingtalk.stream && !(p.dingtalk.aesToken && p.dingtalk.aesKey)) {
      warnings.push('未开启 DINGTALK_STREAM，且没有配 HTTP 回调的 Token/AES Key：暂时收不到消息');
    }
    if (p.dingtalk.stream) warnings.push('已开启 Stream 长连接（本机无需公网回调）');
    return { configured: Boolean(p.dingtalk.appKey && p.dingtalk.appSecret), canSend, canReceive, missing, warnings };
  }

  if (platform === Platform.WECOM) {
    if (!p.wecom.corpId) missing.push('WECOM_CORP_ID');
    if (!p.wecom.secret) missing.push('WECOM_SECRET');
    if (!p.wecom.agentId) missing.push('WECOM_AGENT_ID');
    if (!p.wecom.token) missing.push('WECOM_TOKEN');
    if (!p.wecom.aesKey) missing.push('WECOM_AES_KEY');
    const canSend = Boolean(p.wecom.corpId && p.wecom.secret && p.wecom.agentId);
    const canReceive = Boolean(p.wecom.corpId && p.wecom.token && p.wecom.aesKey);
    if (canSend && !canReceive) warnings.push('只能发不能收：缺少 WECOM_TOKEN / WECOM_AES_KEY（回调验签与解密）');
    if (!canSend && canReceive) warnings.push('只能收不能发：缺少 WECOM_SECRET / WECOM_AGENT_ID');
    if (canSend) warnings.push('企业微信要求发信出口 IP 在企业可信 IP 内，否则报 60020（用 pnpm run doctor 查看出口 IP）');
    return { configured: canSend, canSend, canReceive, missing, warnings };
  }

  // 邮箱：每个账号独立，但模式按整体解析
  const accounts = input.mailAccounts;
  const canSend = accounts.length > 0;
  const canReceive = input.mailEnabled && accounts.length > 0;
  for (const issue of input.mailIssues) {
    if (issue.level === 'error') missing.push(issue.env ?? `${issue.key ?? 'MAIL'}_...`);
    warnings.push(issue.message);
  }
  if (!accounts.length) {
    missing.push('MAIL_ACCOUNTS（或 MAIL_<KEY>_ADDRESS / MAIL_<KEY>_AUTH_CODE）');
    warnings.push('未配置任何邮箱账号');
  }
  if (accounts.length > 0 && !input.mailEnabled) warnings.push('MAIL_ENABLED=false：邮箱轮询已关闭，仅能发送');
  return { configured: canSend, canSend, canReceive, missing, warnings };
}

function reasonFor(
  platform: Platform,
  policy: ModePolicy,
  mode: DeliveryMode,
  cap: CapabilityResult,
  mailEnabled: boolean,
): string {
  const label = PLATFORM_LABELS[platform];
  if (platform === Platform.MAIL && policy === 'auto' && !mailEnabled) {
    return 'MAIL_ENABLED=false：邮箱轮询已关闭 → 回退本地模拟（回写会标注"模拟发送"）';
  }
  if (mode === 'real') {
    if (policy === 'real') return `已显式指定 ${MODE_ENV_KEYS[platform]}=real，强制走真实接口`;
    return `${label}凭据可用 → auto 解析为真实接口`;
  }
  if (policy === 'mock') return `已显式指定 ${MODE_ENV_KEYS[platform]}=mock，使用本地模拟`;
  if (!cap.configured) return `${label}未配置有效凭据 → auto 回退本地模拟（回写会标注"模拟发送"）`;
  return `${label}未完全就绪 → auto 回退本地模拟（回写会标注"模拟发送"）`;
}

/** 由凭据 + 策略解析出每平台运行时画像（纯函数，供 config / 测试 / doctor 使用） */
export function buildPlatformRuntime(input: RuntimeBuildInput): Record<Platform, PlatformRuntime> {
  const { policies } = resolveModePolicies(input.env, { underTest: input.underTest });
  const out = {} as Record<Platform, PlatformRuntime>;
  for (const platform of Object.values(Platform)) {
    const cap = capability(platform, input);
    const policy = policies[platform];
    let mode: DeliveryMode = policy === 'mock'
      ? 'mock'
      : policy === 'real'
        ? 'real'
        : cap.canSend || cap.canReceive
          ? 'real'
          : 'mock';
    // 邮箱轮询被显式关闭时，auto 下不可能"真实收到邮件"，回写也应如实标为模拟
    if (platform === Platform.MAIL && policy === 'auto' && !input.mailEnabled) mode = 'mock';
    out[platform] = {
      platform,
      label: PLATFORM_LABELS[platform],
      policy,
      mode,
      configured: cap.configured,
      canReceive: cap.canReceive,
      canSend: cap.canSend,
      missing: cap.missing,
      warnings: cap.warnings,
      reason: reasonFor(platform, policy, mode, cap, input.mailEnabled),
    };
  }
  return out;
}

/** 模式是否显式强制（诊断输出用） */
export function isForcedPolicy(policy: ModePolicy): boolean {
  return policy !== 'auto';
}
