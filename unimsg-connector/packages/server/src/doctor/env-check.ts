/**
 * 环境变量拼写检查（doctor 用）。
 *
 * 新用户最常见的"静默失败"之一：把 `FEISHU_APP_ID` 写成 `FEISHU_APPID`、
 * 把 `MAIL_QQ_ADDRESS` 写成 `MAIL_QQ_ADRESS` —— dotenv 照收不误，程序读不到，
 * 平台就静默回退 Mock，用户完全不知道错在哪。这里在 doctor 里主动提示。
 *
 * 纯函数、不读 process.env（由调用方传入），可单测。
 */

/** 文档中定义的全部精确变量名（与 .env.example / config 保持一致） */
export const KNOWN_ENV_KEYS: readonly string[] = [
  // 服务 / 存储 / 鉴权
  'SERVER_PORT',
  'SERVER_HOST',
  'CORS_ORIGINS',
  'API_TOKEN',
  'DATABASE_URL',
  'REDIS_URL',
  'MOCK',
  // 运行模式
  'FEISHU_MODE',
  'DINGTALK_MODE',
  'WECOM_MODE',
  'MAIL_MODE',
  // 边界 / 智能（预留）
  'OCR_CONFIDENCE_THRESHOLD',
  'SEND_MAX_RETRY',
  'RETRY_BASE_MS',
  'LLM_TIMEOUT_MS',
  'LLM_PROVIDER',
  'LLM_API_KEY',
  'LLM_ENDPOINT',
  'OCR_PROVIDER',
  'OCR_API_KEY',
  'OCR_SECRET_ID',
  // 飞书
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_VERIFY_TOKEN',
  'FEISHU_ENCRYPT_KEY',
  'FEISHU_BASE_URL',
  // 钉钉（含旧版兼容名）
  'DINGTALK_CLIENT_ID',
  'DINGTALK_CLIENT_SECRET',
  'DINGTALK_ROBOT_CODE',
  'DINGTALK_AES_TOKEN',
  'DINGTALK_AES_KEY',
  'DINGTALK_STREAM',
  'DINGTALK_BASE_URL',
  'DINGTALK_APP_KEY',
  'DINGTALK_APP_SECRET',
  // 企业微信
  'WECOM_CORP_ID',
  'WECOM_AGENT_ID',
  'WECOM_SECRET',
  'WECOM_TOKEN',
  'WECOM_AES_KEY',
  'WECOM_BASE_URL',
  // 邮箱
  'MAIL_POLL_SECONDS',
  'MAIL_ENABLED',
  'MAIL_ACCOUNTS',
  'MAIL_STATE_FILE',
];

/** 邮箱账号的动态变量：MAIL_<KEY>_<字段>，KEY 可由用户自取 */
const MAIL_DYNAMIC_RE = /^MAIL_[A-Z0-9]+_(ADDRESS|AUTH_CODE|PROVIDER|LABEL|IMAP_HOST|IMAP_PORT|IMAP_SECURE|SMTP_HOST|SMTP_PORT|SMTP_SECURE|FOLDERS)$/;
const MAIL_SUFFIXES = ['ADDRESS', 'AUTH_CODE', 'PROVIDER', 'LABEL', 'IMAP_HOST', 'IMAP_PORT', 'IMAP_SECURE', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'FOLDERS'] as const;

/** 只有这些前缀的变量才参与拼写检查，避免把系统变量（PATH 等）算进来 */
const CHECK_PREFIXES = ['FEISHU_', 'DINGTALK_', 'WECOM_', 'MAIL_', 'LLM_', 'OCR_', 'SERVER_'];

export interface SuspiciousEnvVar {
  name: string;
  /** 最接近的合法变量名（如果足够接近） */
  suggestion?: string;
  /** 可能的解释 */
  reason: string;
}

export function isKnownEnvKey(name: string): boolean {
  return KNOWN_ENV_KEYS.includes(name) || MAIL_DYNAMIC_RE.test(name);
}

/** 经典 Levenshtein 距离（变量名都很短，O(n*m) 足够） */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** 在已知变量名里找最接近的一个（距离 ≤ 3 且长度差 ≤ 3 才给建议，避免瞎猜） */
export function suggestEnvKey(name: string): string | undefined {
  let best: { key: string; dist: number } | undefined;
  for (const key of KNOWN_ENV_KEYS) {
    const dist = levenshtein(name, key);
    if (dist <= 3 && Math.abs(name.length - key.length) <= 3 && (!best || dist < best.dist)) {
      best = { key, dist };
    }
  }
  // 邮箱动态变量：把前缀保留，只纠正后缀（如 MAIL_QQ_ADRESS → MAIL_QQ_ADDRESS）
  const mailDynamic = name.match(/^(MAIL_[A-Z0-9]+_)([A-Z0-9]+)$/);
  if (mailDynamic) {
    for (const suffix of MAIL_SUFFIXES) {
      const dist = levenshtein(mailDynamic[2]!, suffix);
      if (dist <= 2 && (!best || dist < best.dist)) best = { key: `${mailDynamic[1]}${suffix}`, dist };
    }
  }
  return best?.key;
}

/**
 * 扫描环境变量里"看起来像本项目的、但文档里没有"的变量名。
 * 只报告非空值（空变量不影响运行，避免刷屏）。
 */
export function findSuspiciousEnvVars(env: NodeJS.ProcessEnv): SuspiciousEnvVar[] {
  const found: SuspiciousEnvVar[] = [];
  for (const [rawName, rawValue] of Object.entries(env)) {
    const name = rawName.trim();
    if (!name || isKnownEnvKey(name)) continue;
    if (!CHECK_PREFIXES.some((p) => name.startsWith(p))) continue;
    if (!String(rawValue ?? '').trim()) continue; // 空值多半只是模板残留，不提示

    const suggestion = suggestEnvKey(name);
    found.push({
      name,
      ...(suggestion ? { suggestion } : {}),
      reason: suggestion
        ? '未在文档中定义，疑似拼写错误——它不会被读取，对应平台会静默回退 Mock'
        : '未在文档中定义，可能拼错或已废弃；确认后删除或改用文档中的变量名',
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
