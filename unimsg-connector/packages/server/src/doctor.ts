/**
 * LinkHub 自检命令（doctor）入口。
 *
 *   pnpm --filter @unimsg/server run doctor                   人类可读报告
 *   pnpm --filter @unimsg/server run doctor -- --json         机器可读 JSON（stdout 只有 JSON）
 *   pnpm --filter @unimsg/server run doctor -- --platform=feishu,mail
 *   pnpm --filter @unimsg/server run doctor -- --help
 *
 * 只读约定：只做「换 token / gettoken / IMAP SEARCH 立基线 / SMTP 登录自检」，
 * 绝不发送任何业务消息；不修改 .env；输出中邮箱地址一律脱敏、绝不打印授权码。
 *
 * 退出码：0 = 全 PASS/SKIP；1 = 有 FAIL（或 Node 版本过低）；2 = 参数错误；3 = 自检异常。
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Platform } from '@unimsg/shared';
import { config } from './config';
import { mailAccountSummary } from './config/runtime';
import { runProbes, PROBE_TIMEOUT_MS, type ProbeInput } from './doctor/probes';
import { findSuspiciousEnvVars } from './doctor/env-check';
import {
  computeExitCode,
  renderJsonReport,
  renderTextReport,
  type DoctorReportInput,
  type EnvFileInfo,
  type EnvInfo,
  type PlatformReport,
} from './doctor/report';

// config.ts 与 doctor.ts 都在 src/ 下，../../../.env 指向 monorepo 根目录（unimsg-connector/.env）
const here = dirname(fileURLToPath(import.meta.url));
const USAGE = `用法：pnpm run doctor [选项]
       （等价全路径：pnpm --filter @unimsg/server run doctor）

注意：不要直接写 "pnpm doctor" —— pnpm 9 自带同名内置命令（诊断 pnpm 自身），
      会命中内置命令而不是本工具；请用 "pnpm run doctor"（在 unimsg-connector/ 下）或上面的全路径形式。

LinkHub 只读自检：检查 .env / 平台模式 / 凭据 / 网络连通 / 企业微信出口 IP，
输出 PASS / FAIL / SKIP 与中文修复建议。不会发送任何业务消息。

选项：
  -h, --help            显示本帮助
  --json                只向 stdout 输出合法 JSON（人类日志不写 stdout）
  --platform=<列表>     只检查指定平台，逗号分隔：feishu,dingtalk,wecom,mail
                        例：--platform=feishu,mail

退出码：
  0  全部 PASS / SKIP
  1  存在 FAIL（或致命环境问题，如 Node < 20）
  2  参数错误
  3  自检过程异常

示例：
  pnpm run doctor                              # 在 unimsg-connector/ 下
  pnpm run doctor -- --platform=wecom
  pnpm --filter @unimsg/server run doctor
  pnpm --filter @unimsg/server run --silent doctor -- --json

说明：加 --silent 是因为 pnpm 会把 "> @unimsg/server@1.0.0 doctor" 启动横幅
      写到 stdout，--json 场景下会破坏"stdout 只能是合法 JSON"的约定。
`;

interface CliOptions {
  json: boolean;
  help: boolean;
  platformFilter?: Platform[];
}

/** 解析命令行参数（参数少，手写即可；不引入依赖） */
export function parseCliArgs(argv: string[]): { options: CliOptions; error?: string } {
  const options: CliOptions = { json: false, help: false };
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--platform=')) {
      const raw = arg.slice('--platform='.length).trim();
      // 逗号为主；同时容忍空格（部分 shell 会把 a,b 拆成 "a b" 再传进来）
      const items = raw
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (items.length === 0) {
        return { options, error: '--platform 需要一个平台列表，例如 --platform=feishu,mail' };
      }
      const valid = Object.values(Platform) as string[];
      const unknown = items.filter((item) => !valid.includes(item));
      if (unknown.length > 0) {
        return { options, error: `未知平台：${unknown.join(', ')}（可选：${valid.join(', ')}）` };
      }
      options.platformFilter = [...new Set(items)] as Platform[];
    } else {
      return { options, error: `未知参数：${arg}` };
    }
  }
  return { options };
}

/** 通过 pnpm 脚本运行时，npm_config_user_agent 里带有 pnpm 版本 */
function detectPnpmVersion(): string | undefined {
  const ua = process.env.npm_config_user_agent ?? '';
  const match = ua.match(/\bpnpm\/(\d+\.\d+\.\d+)/);
  return match ? match[1] : undefined;
}

/** 采集环境段：Node / pnpm / .env 候选路径 / 模式警告 */
function collectEnvInfo(): EnvInfo {
  const candidates: EnvFileInfo[] = [];
  const addCandidate = (path: string): void => {
    if (!candidates.some((c) => c.path === path)) candidates.push({ path, exists: existsSync(path) });
  };
  addCandidate(resolve(here, '../../../.env')); // monorepo 根：unimsg-connector/.env（config.ts 优先加载）
  addCandidate(resolve(process.cwd(), '.env')); // 当前工作目录（pnpm --filter 时是 packages/server）

  const notes: string[] = [];
  if (!candidates.some((c) => c.exists)) {
    notes.push('未找到 .env：所有平台会按 auto 回退 Mock。把 unimsg-connector/.env.example 复制为 .env 并填好凭据后重跑 doctor。');
  }
  if (config.underTest) {
    notes.push('检测到 NODE_TEST_CONTEXT：config 会把平台强制 Mock，真实探针不会执行（请在普通命令行里运行 doctor）。');
  }
  const mailErrors = config.mail.issues.filter((i) => i.level === 'error').length;
  if (mailErrors > 0) {
    notes.push(`邮箱配置有 ${mailErrors} 个 error 级问题，详见下方「邮箱」平台段；未解析成功的账号不会被探测。`);
  }

  // 拼写错误的环境变量不会报错、只会静默回退 Mock——doctor 主动提示，降低新用户学习成本
  const suspicious = findSuspiciousEnvVars(process.env);
  if (suspicious.length > 0) {
    notes.push(`检测到 ${suspicious.length} 个疑似写错/未生效的环境变量（见下方列表）：它们不会被读取，对应平台会静默回退 Mock。`);
  }

  const major = Number(process.versions.node.split('.')[0]);
  return {
    nodeVersion: process.version,
    nodeSatisfies: Number.isFinite(major) && major >= 20,
    pnpmVersion: detectPnpmVersion(),
    envFiles: candidates,
    notes,
    modeWarnings: [...config.modeWarnings],
    mailAccountCount: config.mail.accounts.length,
    mailEnabled: config.mail.enabled,
    underTest: config.underTest,
    suspicious,
  };
}

/** 从 config.runtime 组装平台段（不重复解析凭据，保证与运行时/启动日志一致） */
function collectPlatformReports(filter?: Platform[]): PlatformReport[] {
  const reports: PlatformReport[] = [];
  for (const platform of Object.values(Platform)) {
    if (filter && filter.length > 0 && !filter.includes(platform)) continue;
    const runtime = config.runtime[platform];
    const report: PlatformReport = {
      platform,
      label: runtime.label,
      policy: runtime.policy,
      mode: runtime.mode,
      configured: runtime.configured,
      canSend: runtime.canSend,
      canReceive: runtime.canReceive,
      missing: [...runtime.missing],
      warnings: [...runtime.warnings],
      reason: runtime.reason,
    };
    if (platform === Platform.MAIL) {
      report.mailAccounts = config.mail.accounts.map((account) => mailAccountSummary(account));
      report.mailIssues = config.mail.issues.map((issue) => ({ level: issue.level, message: issue.message }));
    }
    reports.push(report);
  }
  return reports;
}

/** 组装探针输入（凭据只读使用；报告层不接收任何密钥值） */
function collectProbeInput(): ProbeInput {
  const robotCodeRaw = (process.env.DINGTALK_ROBOT_CODE ?? '').trim();
  return {
    feishu: {
      appId: config.platforms.feishu.appId,
      appSecret: config.platforms.feishu.appSecret,
      baseUrl: config.platforms.feishu.baseUrl,
    },
    dingtalk: {
      appKey: config.platforms.dingtalk.appKey,
      appSecret: config.platforms.dingtalk.appSecret,
      robotCode: config.platforms.dingtalk.robotCode,
      robotCodeExplicit: robotCodeRaw.length > 0,
      aesToken: config.platforms.dingtalk.aesToken,
      aesKey: config.platforms.dingtalk.aesKey,
      stream: config.dingtalkStream,
      baseUrl: config.platforms.dingtalk.baseUrl,
    },
    wecom: {
      corpId: config.platforms.wecom.corpId,
      secret: config.platforms.wecom.secret,
      agentId: config.platforms.wecom.agentId,
      baseUrl: config.platforms.wecom.baseUrl,
    },
    mail: {
      accounts: config.mail.accounts,
      enabled: config.mail.enabled,
    },
    // config.runtime 的条目天然满足 PlatformProbeRuntime（多出的字段不会进报告）
    runtime: config.runtime,
  };
}

/** 写 stdout 并等待刷完（--json 下避免 process.exit 截断管道输出） */
function writeStdout(text: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    process.stdout.write(text, (err) => (err ? reject(err) : resolvePromise()));
  });
}

async function main(): Promise<number> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.error) {
    process.stderr.write(`[doctor] 参数错误：${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  const { options } = parsed;
  if (options.help) {
    await writeStdout(USAGE);
    return 0;
  }

  const generatedAt = new Date().toISOString();
  const env = collectEnvInfo();
  const platforms = collectPlatformReports(options.platformFilter);
  const { checks, egressIp } = await runProbes(collectProbeInput(), {
    platformFilter: options.platformFilter,
    timeoutMs: PROBE_TIMEOUT_MS,
    // 企微可信 IP 绑的是出口公网 IP，每次自检都打印当前值，重启/换网后可直接对照
    alwaysFetchEgressIp: true,
  });

  const report: DoctorReportInput = {
    generatedAt,
    cwd: process.cwd(),
    env,
    platforms,
    checks,
    ...(egressIp ? { egressIp } : {}),
    ...(options.platformFilter && options.platformFilter.length > 0
      ? { platformFilter: options.platformFilter }
      : {}),
  };

  // --json 时 stdout 只写合法 JSON；人类提示一律走 stderr/省略
  const output = options.json ? renderJsonReport(report) : renderTextReport(report);
  await writeStdout(output);
  return computeExitCode(report);
}

/**
 * 退出方式：设置 process.exitCode 让事件循环自然收尾，**不要直接 process.exit()**。
 * 原因：探针用 Node 内置 fetch（undici），Windows + Node 24 下如果在 keep-alive socket
 * 关闭过程中强行 process.exit()，会触发 libuv 断言
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ... async.c`，
 * 进程被 0xC0000409 终止——报告明明 PASS，退出码却是 -1073740791，脚本/CI 会误判。
 * 自然退出通常只多 2–3 秒（等 undici 空闲连接到期）；再加一个 10 秒兜底 watchdog 防挂死。
 */
function finish(code: number): void {
  process.exitCode = code;
  const watchdog = setTimeout(() => process.exit(code), 10_000);
  watchdog.unref?.();
}

main()
  .then((code) => {
    finish(code);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`[doctor] 自检执行异常：${message}\n`);
    finish(3);
  });
