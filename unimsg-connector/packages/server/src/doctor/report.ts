/**
 * doctor 报告渲染层（全部是纯函数，不读环境、不联网、不打印）。
 *
 * 数据流：
 *   doctor.ts 采集环境 + config.runtime 平台画像 + probes.ts 探针结果
 *     → 组装 DoctorReportInput
 *     → renderTextReport()（人类可读中文报告） 或 renderJsonReport()（机器可读）
 *
 * 约定：
 *  1. 退出码只由「Node 版本是否达标 + 是否存在 FAIL」决定；SKIP 不算失败
 *     （未启用真实通道是合法状态，例如纯 Mock 演示）。
 *  2. 所有自由文本输出前都会做邮箱脱敏（re**: 报告中绝不出现完整邮箱地址）；
 *     授权码 / App Secret 等密钥本就不会进入报告数据，这里也不收集它们。
 *  3. 纯函数便于 node:test 用 synthetic 探针结果断言渲染、脱敏、建议与退出码。
 */
import type { DeliveryMode, Platform } from '@unimsg/shared';
import type { ModePolicy } from '../config/runtime';
import { maskAddress } from '../services/account';

// ---------------------------------------------------------------------------
// 数据结构
// ---------------------------------------------------------------------------

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';

/** 一条自检结果（环境检查或某个探针） */
export interface CheckResult {
  /** 归属：env / 具体平台（飞书、邮箱…） */
  group: 'env' | Platform;
  /** 稳定标识，便于测试与机器消费，如 feishu:token / mail:qq:imap */
  id: string;
  /** 人类可读标题 */
  title: string;
  status: CheckStatus;
  /** 结果说明（中文，已脱敏） */
  detail: string;
  /** 修复建议（中文，可多行；已脱敏） */
  hint?: string;
}

/** 一个候选 .env 文件及其是否存在（config.ts 会按顺序加载它们） */
export interface EnvFileInfo {
  path: string;
  exists: boolean;
}

/** 环境段信息 */
export interface EnvInfo {
  nodeVersion: string;
  /** Node 主版本是否 >= 20 */
  nodeSatisfies: boolean;
  /** 通过 pnpm 脚本运行时才有值 */
  pnpmVersion?: string;
  /** config.ts 的两个候选 .env 路径（monorepo 根 / 当前工作目录） */
  envFiles: EnvFileInfo[];
  /** 环境级提示（例如"未找到 .env，建议复制 .env.example"） */
  notes: string[];
  /** 旧 MOCK 变量、非法 *_MODE 值等全局模式警告（config.modeWarnings） */
  modeWarnings: string[];
  mailAccountCount: number;
  mailEnabled: boolean;
  /** 是否运行在 node:test 子进程（此时所有平台强制 Mock） */
  underTest: boolean;
}

/** 报告里的邮箱账号摘要（地址会在渲染时脱敏） */
export interface MailAccountReport {
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
}

/** 单个平台的运行画像（来自 config.runtime，doctor 不再重复解析） */
export interface PlatformReport {
  platform: Platform;
  label: string;
  policy: ModePolicy;
  mode: DeliveryMode;
  configured: boolean;
  canSend: boolean;
  canReceive: boolean;
  missing: string[];
  warnings: string[];
  reason: string;
  /** 仅邮箱平台：账号明细 */
  mailAccounts?: MailAccountReport[];
  /** 仅邮箱平台：解析每账号时发现的问题 */
  mailIssues?: { level: 'error' | 'warn'; message: string }[];
}

/** renderTextReport / renderJsonReport / computeExitCode 的统一输入 */
export interface DoctorReportInput {
  /** ISO 时间戳 */
  generatedAt: string;
  /** 运行 doctor 时的工作目录 */
  cwd: string;
  env: EnvInfo;
  /** 按 Platform 枚举顺序排列（已按 --platform 过滤） */
  platforms: PlatformReport[];
  /** 环境检查 + 探针结果，顺序即展示顺序 */
  checks: CheckResult[];
  /** 探测到的出口公网 IP（企业微信 60020 时采集，其余场景可能没有） */
  egressIp?: string;
  /** 本次 --platform 过滤（空/未传 = 全部平台） */
  platformFilter?: Platform[];
}

export interface DoctorSummary {
  pass: number;
  fail: number;
  skip: number;
}

/** --json 输出的 JSON 结构（所有字段都已脱敏） */
export interface DoctorJsonReport {
  tool: 'linkhub-doctor';
  version: 1;
  generatedAt: string;
  cwd: string;
  ok: boolean;
  exitCode: number;
  platformFilter: Platform[] | null;
  environment: EnvInfo;
  platforms: PlatformReport[];
  checks: CheckResult[];
  summary: DoctorSummary;
  egressIp: string | null;
}

// ---------------------------------------------------------------------------
// 纯工具：脱敏 / 宽度对齐
// ---------------------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * 把文本里出现的完整邮箱地址替换成脱敏形式（m***@qq.com）。
 * 已脱敏（含 *）的地址不会被再次匹配，因此可安全重复调用。
 */
export function redactEmails(text: string): string {
  return text.replace(EMAIL_RE, (addr) => maskAddress(addr));
}

/** 终端显示宽度：CJK 全角字符按 2 列算，用于让平台表格对齐 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  }
  return width;
}

/** 按终端显示宽度右补空格 */
export function padDisplay(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

/** 把多行建议缩进成报告里的续行（保持各行对齐） */
function indentLines(text: string, prefix: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line, i) => (i === 0 ? line : `${prefix}${line}`));
}

function statusIcon(status: CheckStatus): string {
  if (status === 'PASS') return '✔';
  if (status === 'FAIL') return '✖';
  return '○';
}

function yesNo(ok: boolean): string {
  return ok ? '✔' : '✖';
}

// ---------------------------------------------------------------------------
// 汇总与退出码
// ---------------------------------------------------------------------------

/** 统计 PASS / FAIL / SKIP 条数 */
export function summarizeChecks(checks: CheckResult[]): DoctorSummary {
  const summary: DoctorSummary = { pass: 0, fail: 0, skip: 0 };
  for (const c of checks) {
    if (c.status === 'PASS') summary.pass += 1;
    else if (c.status === 'FAIL') summary.fail += 1;
    else summary.skip += 1;
  }
  return summary;
}

/**
 * 退出码约定（与任务验收一致）：
 *  - 有 FAIL → 1；全 PASS / SKIP → 0；
 *  - Node 版本低于 20 视为致命环境问题（即使探针都 SKIP 也返回 1）。
 */
export function computeExitCode(input: Pick<DoctorReportInput, 'checks' | 'env'>): number {
  if (!input.env.nodeSatisfies) return 1;
  return input.checks.some((c) => c.status === 'FAIL') ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 人类可读报告
// ---------------------------------------------------------------------------

function renderEnvironmentLines(env: EnvInfo): string[] {
  const lines: string[] = [];
  lines.push(`  Node 版本：${env.nodeVersion}（要求 >= 20）${yesNo(env.nodeSatisfies)}`);
  if (!env.nodeSatisfies) lines.push('    ✖ Node 版本过低：请升级到 Node 20 及以上再运行服务（package.json engines 要求 >=20）。');
  lines.push(
    `  运行方式：${env.pnpmVersion ? `pnpm ${env.pnpmVersion}（通过 pnpm 脚本运行）` : '直接 node/tsx 运行（未检测到 pnpm；不影响自检）'}`,
  );
  lines.push(
    `  测试环境：${env.underTest ? 'NODE_TEST_CONTEXT=true（所有平台被强制 Mock，真实探针不会执行）' : '正常（可执行真实探针）'}`,
  );

  const found = env.envFiles.filter((f) => f.exists);
  if (found.length === 0) {
    lines.push('  .env 文件：✖ 未找到（config.ts 会尝试以下路径）');
  } else {
    lines.push('  .env 文件：✔ 已加载（config.ts 会依次加载以下路径，后加载的不覆盖已有键）');
  }
  for (const f of env.envFiles) {
    lines.push(`    ${f.exists ? '✔' : '·'} ${f.path}${f.exists ? '' : '（不存在）'}`);
  }
  for (const note of env.notes) lines.push(`  ⚠ ${note}`);

  lines.push(
    `  邮箱账号：${env.mailAccountCount} 个${env.mailAccountCount > 0 ? (env.mailEnabled ? '（IMAP 轮询开启）' : '（MAIL_ENABLED=false，轮询关闭，仅能发送）') : ''}`,
  );
  if (env.modeWarnings.length > 0) {
    lines.push('  模式警告：');
    for (const w of env.modeWarnings) lines.push(`    ⚠ ${w}`);
  } else {
    lines.push('  模式警告：无（未发现旧 MOCK 变量或非法 *_MODE 值）');
  }
  return lines;
}

function renderPlatformTable(platforms: PlatformReport[]): string[] {
  const lines: string[] = [];
  lines.push('  【二、平台模式】（策略 → 实际通道 / 收发能力 / 缺失配置）');
  if (platforms.length === 0) {
    lines.push('  （没有平台：--platform 过滤后为空）');
    return lines;
  }
  lines.push(`  ${padDisplay('平台', 10)}${padDisplay('策略', 6)}${padDisplay('实际通道', 10)}${padDisplay('收信', 6)}发信`);
  lines.push(`  ${'-'.repeat(38)}`);
  for (const p of platforms) {
    lines.push(
      `  ${padDisplay(p.label, 10)}${padDisplay(p.policy, 6)}${padDisplay(p.mode, 10)}${padDisplay(yesNo(p.canReceive), 6)}${yesNo(p.canSend)}`,
    );
  }
  lines.push('');
  for (const p of platforms) {
    lines.push(`  ◆ ${p.label}（${p.platform}）`);
    lines.push(`    理由：${p.reason}`);
    if (p.missing.length > 0) lines.push(`    缺失：${p.missing.join(' / ')}`);
    if (p.warnings.length > 0) {
      for (const w of p.warnings) lines.push(`    提醒：${w}`);
    }
    if (p.mailAccounts && p.mailAccounts.length > 0) {
      lines.push('    邮箱账号：');
      for (const a of p.mailAccounts) {
        const imap = `${a.imapHost}:${a.imapPort}（${a.imapSecure ? 'TLS' : 'STARTTLS'}）`;
        const smtp = `${a.smtpHost}:${a.smtpPort}（${a.smtpSecure ? 'TLS' : 'STARTTLS'}）`;
        lines.push(`      · [${a.key}] ${a.label} ${maskAddress(a.address)}  IMAP ${imap}  SMTP ${smtp}  监听 ${a.folders.join(',')}`);
      }
    }
    if (p.mailIssues && p.mailIssues.length > 0) {
      lines.push('    配置问题：');
      for (const issue of p.mailIssues) lines.push(`      · [${issue.level}] ${issue.message}`);
    }
  }
  return lines;
}

function renderChecks(checks: CheckResult[]): string[] {
  const lines: string[] = [];
  lines.push('  【三、探针结果】（PASS/FAIL/SKIP；只读探测，绝不发送业务消息）');
  if (checks.length === 0) {
    lines.push('  （没有执行任何探针：所选平台均未启用真实通道，或没有可检查的账号）');
    return lines;
  }
  for (const c of checks) {
    lines.push(`  [${c.status}] ${c.title}`);
    if (c.detail) lines.push(...indentLines(`        结果：${c.detail}`, '              '));
    if (c.hint) lines.push(...indentLines(`        建议：${c.hint}`, '              '));
  }
  return lines;
}

function renderConclusion(input: DoctorReportInput, summary: DoctorSummary, exitCode: number): string[] {
  const lines: string[] = [];
  lines.push('  【四、结论】');
  if (typeof input.egressIp === 'string' && input.egressIp) {
    lines.push(`  当前出口公网 IP：${input.egressIp}（企业微信「可信IP」需加入该 IP；出现 60020 时尤其注意）`);
  }

  if (exitCode === 0) {
    lines.push(`  ✔ 自检通过：PASS ${summary.pass} / FAIL 0 / SKIP ${summary.skip}。`);
    lines.push('    所选平台已具备真实收发条件（或按策略处于合规的 Mock 状态），没有需要修复的项。');
    lines.push('  下一步：');
    lines.push('    1. 启动后端：pnpm --filter @unimsg/server dev');
    lines.push('    2. 查看接口：curl -H "Authorization: Bearer dev-token" http://localhost:3001/api/accounts');
  } else {
    lines.push(`  ✖ 自检未通过：PASS ${summary.pass} / FAIL ${summary.fail} / SKIP ${summary.skip}。`);
    if (!input.env.nodeSatisfies) lines.push('    · 先解决 Node 版本过低的问题（升级到 Node 20+）。');
    if (summary.fail > 0) lines.push('    · 按上面 [FAIL] 项的「建议」逐条修复（通常只需要改 .env）。');
    lines.push('  下一步：');
    lines.push('    1. 按 [FAIL] 建议修改 .env（注意：不要把真实凭据提交进 git）');
    lines.push('    2. 重跑自检：pnpm --filter @unimsg/server run doctor');
    lines.push('    3. 只看某个平台：pnpm --filter @unimsg/server run doctor -- --platform=wecom');
  }
  lines.push('  其他命令：pnpm --filter @unimsg/server run --silent doctor -- --json（机器可读；--silent 避免 pnpm 自身 banner 混入 stdout）');
  return lines;
}

/**
 * 渲染人类可读中文报告。
 * @param input 全部来自环境采集与探针结果，函数本身不做任何 I/O
 */
export function renderTextReport(input: DoctorReportInput): string {
  const env = redactEnv(input.env);
  const platforms = input.platforms.map(redactPlatform);
  const checks = input.checks.map(redactCheck);
  const summary = summarizeChecks(checks);
  const exitCode = computeExitCode(input);

  const lines: string[] = [];
  lines.push('LinkHub 自检报告（doctor）');
  lines.push(`生成时间：${input.generatedAt}`);
  lines.push(`工作目录：${input.cwd}`);
  if (input.platformFilter && input.platformFilter.length > 0) {
    lines.push(`平台过滤：${input.platformFilter.join(', ')}`);
  }
  lines.push('说明：全部探测均为只读操作（换 token / gettoken / IMAP SEARCH 基线 / SMTP 登录自检），不会发送任何业务消息。');
  lines.push('='.repeat(72));
  lines.push('');

  lines.push('【一、环境】');
  lines.push(...renderEnvironmentLines(env));
  lines.push('');
  lines.push(...renderPlatformTable(platforms));
  lines.push('');
  lines.push(...renderChecks(checks));
  lines.push('');
  lines.push(...renderConclusion({ ...input, env, platforms, checks }, summary, exitCode));
  lines.push('');
  lines.push(`退出码：${exitCode}`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// 机器可读 JSON
// ---------------------------------------------------------------------------

function redactEnv(env: EnvInfo): EnvInfo {
  return {
    ...env,
    notes: env.notes.map(redactEmails),
    modeWarnings: env.modeWarnings.map(redactEmails),
  };
}

function redactCheck(check: CheckResult): CheckResult {
  return {
    ...check,
    title: redactEmails(check.title),
    detail: redactEmails(check.detail),
    ...(check.hint !== undefined ? { hint: redactEmails(check.hint) } : {}),
  };
}

function redactPlatform(platform: PlatformReport): PlatformReport {
  return {
    ...platform,
    reason: redactEmails(platform.reason),
    missing: platform.missing.map(redactEmails),
    warnings: platform.warnings.map(redactEmails),
    ...(platform.mailAccounts
      ? {
          mailAccounts: platform.mailAccounts.map((a) => ({ ...a, address: redactEmails(a.address) })),
        }
      : {}),
    ...(platform.mailIssues
      ? { mailIssues: platform.mailIssues.map((i) => ({ ...i, message: redactEmails(i.message) })) }
      : {}),
  };
}

/** 组装 --json 输出对象（已脱敏；纯函数） */
export function buildJsonReport(input: DoctorReportInput): DoctorJsonReport {
  const env = redactEnv(input.env);
  const platforms = input.platforms.map(redactPlatform);
  const checks = input.checks.map(redactCheck);
  const summary = summarizeChecks(checks);
  const exitCode = computeExitCode(input);
  return {
    tool: 'linkhub-doctor',
    version: 1,
    generatedAt: input.generatedAt,
    cwd: input.cwd,
    ok: exitCode === 0,
    exitCode,
    platformFilter: input.platformFilter && input.platformFilter.length > 0 ? [...input.platformFilter] : null,
    environment: env,
    platforms,
    checks,
    summary,
    egressIp: input.egressIp ?? null,
  };
}

/** 渲染 --json 输出（stdout 只输出这个字符串，保证是合法 JSON） */
export function renderJsonReport(input: DoctorReportInput): string {
  return `${JSON.stringify(buildJsonReport(input), null, 2)}\n`;
}
