/**
 * 配置中心（服务端私有）。
 *
 * 关键安全约定：下方所有 *Secret / *Key / *Token 都是【后端独占】凭据。
 * 它们只在这里被读取，永远不以 VITE_ 前缀注入前端构建产物，
 * 因此评审/部署时即使前端代码被反编译也拿不到真实密钥。
 *
 * 可替换性（本项目的核心诉求）：
 *  - 每个平台用 `<PLATFORM>_MODE = auto | real | mock` 独立决定走真实接口还是本地 Mock，
 *    默认 auto（凭据够就真实、不够就 Mock），换账号只改 .env，不改代码；
 *  - 旧全局 `MOCK` 已废弃，仅作为"未显式配置 *_MODE 时的默认策略"，并会打印迁移警告；
 *  - 邮箱账号数量/服务商不限（`MAIL_ACCOUNTS` 或自动发现 `MAIL_<KEY>_ADDRESS`）；
 *  - 解析结果在 `config.runtime` 里，`/api/accounts`、启动日志、doctor 全部复用。
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Platform, type DeliveryMode } from '@unimsg/shared';
import {
  buildPlatformRuntime,
  MODE_ENV_KEYS,
  parseMailAccounts,
  readPlatformCredentials,
  resolveModePolicies,
  type MailAccount,
  type MailAccountIssue,
  type ModePolicy,
  type PlatformCredentials,
  type PlatformRuntime,
} from './config/runtime';

// pnpm --filter 会把 cwd 切到 packages/server，这里显式补加载 monorepo 根目录的 .env
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

export type LlmProvider = 'mock' | 'wenxin' | 'qwen';
export type OcrProvider = 'mock' | 'tencent';
export type { MailAccount, MailAccountIssue, ModePolicy, PlatformRuntime };
export { MODE_ENV_KEYS };

function bool(v: string | undefined, def = false): boolean {
  return v ? v === 'true' || v === '1' : def;
}

/**
 * Node 测试运行器会给子进程注入 NODE_TEST_CONTEXT：
 * 单测里默认把所有平台锁成 mock（绝不外呼、不打真实接口），
 * 需要真实路径的用例显式 `forceMode(platform, 'real')`。
 */
const underTest = Boolean(process.env.NODE_TEST_CONTEXT);

const platforms: PlatformCredentials = readPlatformCredentials(process.env);
const mailParsed = parseMailAccounts(process.env);
// 老变量 MAIL_ENABLED 仍兼容：显式 false 关轮询；不写时"有账号就开"
const mailEnabled = process.env.MAIL_ENABLED !== undefined
  ? bool(process.env.MAIL_ENABLED, false)
  : mailParsed.accounts.length > 0;

const runtime = buildPlatformRuntime({
  env: process.env,
  platforms,
  mailAccounts: mailParsed.accounts,
  mailIssues: mailParsed.issues,
  mailEnabled,
  underTest,
});

// 模式相关的全局警告（旧 MOCK 变量、非法 *_MODE 值等），启动日志与 doctor 会打印
const modeWarnings = resolveModePolicies(process.env, { underTest }).warnings;

// 入口令牌：空串不能当"未配置"处理——那会让鉴权中间件拿到空 token，
// 历史上可能被误判成"跳过鉴权"。这里统一归一化：空 → dev-token + 启动警告。
const rawApiToken = (process.env.API_TOKEN ?? '').trim();
const apiToken = rawApiToken || 'dev-token';
if (process.env.API_TOKEN !== undefined && !rawApiToken) {
  modeWarnings.push('API_TOKEN 被显式设置为空，已回退 dev-token；默认令牌仅适合本地演示，对外暴露前务必设置强令牌');
}

export const config = {
  port: Number(process.env.SERVER_PORT ?? 3001),

  // 留空 → 后端自动使用内存存储（不依赖 Docker 即可本地验证）；
  // 填入真实连接串 → 自动切换 Postgres（部署评审环境时用）。
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',

  /** 是否运行在 node:test 子进程里（供 doctor/测试判断，业务代码不用关心） */
  underTest,

  // 入口鉴权令牌（服务端私有；前端登录后携带 Bearer）。未配置时用 dev-token 便于本地演示。
  apiToken,

  /** 钉钉 Stream 长连接（免公网回调），开启后额外订阅机器人消息 */
  dingtalkStream: platforms.dingtalk.stream,

  // 边界降级参数（全部走环境变量，评审现场可调）
  ocrThreshold: Number(process.env.OCR_CONFIDENCE_THRESHOLD ?? 0.7),
  sendMaxRetry: Number(process.env.SEND_MAX_RETRY ?? 3),
  retryBaseMs: Number(process.env.RETRY_BASE_MS ?? 1000),
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 8000),

  // 大模型（意图识别/摘要/回复草稿）。密钥仅服务端使用。
  llm: {
    provider: (process.env.LLM_PROVIDER ?? 'mock') as LlmProvider,
    apiKey: process.env.LLM_API_KEY ?? '',
    endpoint: process.env.LLM_ENDPOINT ?? '',
  },

  // OCR（图片/文件消息文字提取）。密钥仅服务端使用。
  ocr: {
    provider: (process.env.OCR_PROVIDER ?? 'mock') as OcrProvider,
    apiKey: process.env.OCR_API_KEY ?? '',
    secretId: process.env.OCR_SECRET_ID ?? '',
  },

  // 平台凭据（验签 / 真实发送用）。均为服务端私有。
  platforms: {
    feishu: {
      appId: platforms.feishu.appId,
      appSecret: platforms.feishu.appSecret,
      verifyToken: platforms.feishu.verifyToken,
      encryptKey: platforms.feishu.encryptKey,
      baseUrl: platforms.feishu.baseUrl,
    },
    dingtalk: {
      appKey: platforms.dingtalk.appKey,
      appSecret: platforms.dingtalk.appSecret,
      robotCode: platforms.dingtalk.robotCode,
      aesToken: platforms.dingtalk.aesToken,
      aesKey: platforms.dingtalk.aesKey,
      baseUrl: platforms.dingtalk.baseUrl,
    },
    wecom: {
      token: platforms.wecom.token,
      aesKey: platforms.wecom.aesKey,
      corpId: platforms.wecom.corpId,
      agentId: platforms.wecom.agentId,
      // 自建应用 Secret：换 access_token 用（后台"眼睛"图标查看，别点重置）
      secret: platforms.wecom.secret,
      baseUrl: platforms.wecom.baseUrl,
    },
  },

  // 邮箱数据源：IMAP 轮询收信 + SMTP 回写。授权码只存服务端。可配任意数量/任意服务商。
  mail: {
    enabled: mailEnabled,
    pollMs: Math.max(5, Number(process.env.MAIL_POLL_SECONDS ?? 45)) * 1000,
    accounts: mailParsed.accounts,
    issues: mailParsed.issues,
  },

  /** 每个平台解析后的真实运行画像（policy/mode/canSend/canReceive/missing/warnings/reason） */
  runtime,

  /** 全局模式配置警告（旧 MOCK、非法值等），启动时打印一次 */
  modeWarnings,
};

// ---------------------------------------------------------------------------
// 运行模式访问器
// ---------------------------------------------------------------------------

/** 该平台本次实际走哪条通道（real / mock） */
export function modeOf(platform: Platform): DeliveryMode {
  return config.runtime[platform].mode;
}

/** 该平台的完整运行画像（只读语义） */
export function runtimeOf(platform: Platform): PlatformRuntime {
  return config.runtime[platform];
}

/**
 * 显式强制某平台通道（单测 / doctor 模拟用）。
 * real 时同步补足能力标记，避免"能力守卫"把测试挡在门外。
 */
export function forceMode(platform: Platform, mode: DeliveryMode): void {
  const r = config.runtime[platform];
  r.mode = mode;
  r.policy = mode;
  if (mode === 'real') {
    r.canSend = true;
    r.canReceive = true;
  }
}

/** 全部平台强制同一通道（单测 before/after 用） */
export function forceAllModes(mode: DeliveryMode): void {
  for (const platform of Object.values(Platform)) forceMode(platform, mode);
}

/** 从当前凭据重新计算运行时画像（测试里改完 config.platforms 后可刷新） */
export function refreshRuntime(): void {
  const built = buildPlatformRuntime({
    env: process.env,
    platforms: {
      feishu: config.platforms.feishu,
      dingtalk: { ...config.platforms.dingtalk, stream: config.dingtalkStream },
      wecom: config.platforms.wecom,
    },
    mailAccounts: config.mail.accounts,
    mailIssues: config.mail.issues,
    mailEnabled: config.mail.enabled,
    underTest,
  });
  Object.assign(config.runtime, built);
}

/** 启动/doctor 用的一行式模式摘要 */
export function modeSummary(): string {
  return Object.values(Platform)
    .map((p) => `${config.runtime[p].label}=${config.runtime[p].mode}${config.runtime[p].policy !== 'auto' ? `(${config.runtime[p].policy})` : ''}`)
    .join(' ');
}
