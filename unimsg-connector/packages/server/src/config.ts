/**
 * 配置中心（服务端私有）。
 *
 * 关键安全约定：下方所有 *Secret / *Key / *Token 都是【后端独占】凭据。
 * 它们只在这里被读取，永远不以 VITE_ 前缀注入前端构建产物，
 * 因此评审/部署时即使前端代码被反编译也拿不到真实密钥。
 *
 * MOCK=true（默认）时：三平台发送与验签、LLM、OCR 全部走本地 Mock，
 * 无需任何外部账号即可把闭环跑通。等你拿到真实 apiKey 后，
 * 把 MOCK 改为 false 并填写对应 *_API_KEY 即可无缝切换到真接口。
 */
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// pnpm --filter 会把 cwd 切到 packages/server，这里显式补加载 monorepo 根目录的 .env
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

export type LlmProvider = 'mock' | 'wenxin' | 'qwen';
export type OcrProvider = 'mock' | 'tencent';

function bool(v: string | undefined, def = false): boolean {
  return v ? v === 'true' || v === '1' : def;
}

export const config = {
  port: Number(process.env.SERVER_PORT ?? 3001),

  // 留空 → 后端自动使用内存存储（不依赖 Docker 即可本地验证）；
  // 填入真实连接串 → 自动切换 Postgres（部署评审环境时用）。
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',

  // 外部 API 总开关：默认 true = 全部 Mock；拿到真密钥后改 false。
  mock: bool(process.env.MOCK, true),

  // 入口鉴权令牌（服务端私有；前端登录后携带 Bearer）。未配置时用 dev-token 便于本地演示。
  apiToken: process.env.API_TOKEN ?? 'dev-token',

  /** 钉钉 Stream 长连接（免公网回调），开启后额外订阅机器人消息 */
  dingtalkStream: bool(process.env.DINGTALK_STREAM, false),

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

  // 三平台凭据（验签 / 真实发送用）。均为服务端私有。
  platforms: {
    feishu: {
      appId: process.env.FEISHU_APP_ID ?? '',
      appSecret: process.env.FEISHU_APP_SECRET ?? '',
      verifyToken: process.env.FEISHU_VERIFY_TOKEN ?? '',
      encryptKey: process.env.FEISHU_ENCRYPT_KEY ?? '',
    },
    dingtalk: {
      // 新版后台叫 Client ID / Client Secret，旧版叫 AppKey / AppSecret
      appKey: process.env.DINGTALK_CLIENT_ID ?? process.env.DINGTALK_APP_KEY ?? '',
      appSecret: process.env.DINGTALK_CLIENT_SECRET ?? process.env.DINGTALK_APP_SECRET ?? '',
      // 机器人编码：企业内部应用通常与 Client ID 相同
      robotCode: process.env.DINGTALK_ROBOT_CODE ?? process.env.DINGTALK_CLIENT_ID ?? process.env.DINGTALK_APP_KEY ?? '',
      aesToken: process.env.DINGTALK_AES_TOKEN ?? '',
      aesKey: process.env.DINGTALK_AES_KEY ?? '',
    },
    wecom: {
      token: process.env.WECOM_TOKEN ?? '',
      aesKey: process.env.WECOM_AES_KEY ?? '',
      corpId: process.env.WECOM_CORP_ID ?? '',
      agentId: process.env.WECOM_AGENT_ID ?? '',
    },
  },
};
