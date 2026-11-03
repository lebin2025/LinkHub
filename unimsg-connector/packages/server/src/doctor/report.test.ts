/**
 * doctor 报告渲染单测：全部是纯函数断言，不联网、不读真实 .env。
 *
 * 覆盖：PASS/FAIL/SKIP 渲染、四个报告段落、邮箱脱敏（文本 + JSON）、
 *      21001 / 60020 修复建议进入报告、退出码规则、JSON 结构合法性。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from '@unimsg/shared';
import { explainFeishuError, explainWecomError } from './probes';
import {
  computeExitCode,
  displayWidth,
  padDisplay,
  redactEmails,
  renderJsonReport,
  renderTextReport,
  summarizeChecks,
  type CheckResult,
  type DoctorReportInput,
  type EnvInfo,
  type PlatformReport,
} from './report';

// ---------------------------------------------------------------------------
// synthetic 数据构造器（输入全部来自测试，不依赖真实环境）
// ---------------------------------------------------------------------------

function env(over: Partial<EnvInfo> = {}): EnvInfo {
  return {
    nodeVersion: 'v24.14.0',
    nodeSatisfies: true,
    pnpmVersion: '9.15.9',
    envFiles: [{ path: 'C:\\proj\\unimsg-connector\\.env', exists: true }],
    notes: [],
    modeWarnings: [],
    mailAccountCount: 2,
    mailEnabled: true,
    underTest: false,
    ...over,
  };
}

function platformReport(over: Partial<PlatformReport> = {}): PlatformReport {
  return {
    platform: Platform.FEISHU,
    label: '飞书',
    policy: 'auto',
    mode: 'real',
    configured: true,
    canSend: true,
    canReceive: true,
    missing: [],
    warnings: [],
    reason: '飞书凭据可用 → auto 解析为真实接口',
    ...over,
  };
}

function check(over: Partial<CheckResult> = {}): CheckResult {
  return {
    group: Platform.FEISHU,
    id: 'feishu:token',
    title: '飞书 tenant_access_token（应用凭据校验）',
    status: 'PASS',
    detail: 'tenant_access_token 获取成功（有效期 7200s）',
    ...over,
  };
}

function report(over: Partial<DoctorReportInput> = {}): DoctorReportInput {
  return {
    generatedAt: '2026-11-03T16:00:00.000Z',
    cwd: 'C:\\proj\\unimsg-connector\\packages\\server',
    env: env(),
    platforms: [platformReport()],
    checks: [check()],
    ...over,
  };
}

/** 一个带原始邮箱地址的邮箱平台段（渲染时必须脱敏） */
function mailPlatform(): PlatformReport {
  return platformReport({
    platform: Platform.MAIL,
    label: '邮箱',
    canSend: true,
    canReceive: true,
    reason: '邮箱凭据可用 → auto 解析为真实接口',
    mailAccounts: [
      {
        key: 'qq',
        label: 'QQ邮箱',
        address: 'zhangsan@qq.com',
        provider: 'qq',
        imapHost: 'imap.qq.com',
        imapPort: 993,
        imapSecure: true,
        smtpHost: 'smtp.qq.com',
        smtpPort: 465,
        smtpSecure: true,
        folders: ['INBOX'],
      },
    ],
    mailIssues: [{ level: 'error', message: '邮箱 zhangsan@qq.com 缺少 MAIL_QQ_AUTH_CODE' }],
  });
}

// ---------------------------------------------------------------------------
// 汇总与退出码
// ---------------------------------------------------------------------------

test('退出码：全 PASS/SKIP → 0；出现 FAIL → 1；Node 版本过低 → 1', () => {
  assert.equal(computeExitCode(report()), 0);
  assert.equal(
    computeExitCode(report({ checks: [check(), check({ id: 'mail:skipped', status: 'SKIP' })] })),
    0,
  );
  assert.equal(computeExitCode(report({ checks: [check({ status: 'FAIL' })] })), 1);
  assert.equal(computeExitCode(report({ env: env({ nodeSatisfies: false }) })), 1);
});

test('汇总：PASS / FAIL / SKIP 分别计数', () => {
  const summary = summarizeChecks([
    check(),
    check({ status: 'FAIL' }),
    check({ status: 'SKIP' }),
    check({ status: 'SKIP' }),
  ]);
  assert.deepEqual(summary, { pass: 1, fail: 1, skip: 2 });
});

// ---------------------------------------------------------------------------
// 人类可读报告
// ---------------------------------------------------------------------------

test('渲染：包含环境 / 平台模式 / 探针结果 / 结论四个段落', () => {
  const text = renderTextReport(report());
  for (const section of ['【一、环境】', '【二、平台模式】', '【三、探针结果】', '【四、结论】']) {
    assert.ok(text.includes(section), `缺少段落：${section}`);
  }
  assert.ok(text.includes('Node 版本：v24.14.0'));
  assert.ok(text.includes('pnpm 9.15.9'));
  assert.ok(text.includes('C:\\proj\\unimsg-connector\\.env'));
  assert.ok(text.includes('飞书'));
  assert.ok(text.includes('auto'));
  assert.ok(text.includes('real'));
});

test('渲染：PASS / FAIL / SKIP 三种状态都可见，FAIL 带原因与建议', () => {
  const text = renderTextReport(
    report({
      checks: [
        check(),
        check({
          id: 'wecom:token',
          group: Platform.WECOM,
          title: '企业微信 access_token（应用凭据校验）',
          status: 'FAIL',
          detail: '企业微信返回 60020：调用来源 IP 不在企业可信IP内',
          hint: '把出口 IP 加入企业可信 IP 后重跑 doctor',
        }),
        check({ id: 'mail:skipped', group: Platform.MAIL, status: 'SKIP', detail: '未启用真实通道' }),
      ],
    }),
  );
  assert.ok(text.includes('[PASS]'));
  assert.ok(text.includes('[FAIL]'));
  assert.ok(text.includes('[SKIP]'));
  assert.ok(text.includes('企业微信返回 60020'));
  assert.ok(text.includes('建议：把出口 IP 加入企业可信 IP 后重跑 doctor'));
  assert.ok(text.includes('PASS 1 / FAIL 1 / SKIP 1'));
  assert.ok(text.includes('退出码：1'));
});

test('渲染：环境段的 .env 缺失与 MOCK 遗留警告会显示', () => {
  const text = renderTextReport(
    report({
      env: env({
        envFiles: [{ path: 'C:\\proj\\unimsg-connector\\.env', exists: false }],
        notes: ['未找到 .env：所有平台会按 auto 回退 Mock。'],
        modeWarnings: ['MOCK 已废弃：建议删除该变量，改用 FEISHU_MODE / DINGTALK_MODE / WECOM_MODE / MAIL_MODE'],
      }),
    }),
  );
  assert.ok(text.includes('✖ 未找到'));
  assert.ok(text.includes('未找到 .env：所有平台会按 auto 回退 Mock。'));
  assert.ok(text.includes('MOCK 已废弃'));
});

test('渲染：疑似写错的环境变量会显示建议（避免静默回退 Mock）', () => {
  const text = renderTextReport(
    report({
      env: env({
        suspicious: [
          {
            name: 'FEISHU_APPID',
            suggestion: 'FEISHU_APP_ID',
            reason: '未在文档中定义，疑似拼写错误——它不会被读取，对应平台会静默回退 Mock',
          },
        ],
      }),
    }),
  );
  assert.ok(text.includes('疑似写错/未生效的环境变量'));
  assert.ok(text.includes('FEISHU_APPID → 是否想写 FEISHU_APP_ID？'));
  assert.ok(text.includes('静默回退 Mock'));

  const parsed = JSON.parse(renderJsonReport(report({ env: env({ suspicious: [{ name: 'X', reason: 'r' }] }) }))) as any;
  assert.equal(parsed.environment.suspicious[0].name, 'X');
});

test('渲染：全部 SKIP 时结论为通过（Mock 演示是合法状态）', () => {
  const text = renderTextReport(
    report({
      checks: [check({ status: 'SKIP', detail: '未启用真实通道（策略 auto → 实际 mock）' })],
      env: env({ mailAccountCount: 0, mailEnabled: false }),
    }),
  );
  assert.ok(text.includes('✔ 自检通过'));
  assert.ok(text.includes('PASS 0 / FAIL 0 / SKIP 1'));
  assert.ok(text.includes('退出码：0'));
});

// ---------------------------------------------------------------------------
// 脱敏（文本与 JSON 两条输出路径都必须脱敏）
// ---------------------------------------------------------------------------

test('脱敏：报告的文本输出不出现完整邮箱地址（账号行与配置问题都脱敏）', () => {
  const text = renderTextReport(
    report({
      platforms: [mailPlatform()],
      checks: [
        check({
          group: Platform.MAIL,
          id: 'mail:qq:imap',
          title: '邮箱 IMAP 登录基线',
          status: 'FAIL',
          detail: 'IMAP 登录失败（zhangsan@qq.com @ imap.qq.com:993）',
          hint: '检查 zhangsan@qq.com 的授权码',
        }),
      ],
    }),
  );
  assert.ok(!text.includes('zhangsan@qq.com'), '文本报告泄露了完整邮箱地址');
  assert.ok(text.includes('z******@qq.com'));
});

test('脱敏：redactEmails 把文本里的邮箱替换成脱敏形式，且对已脱敏文本幂等', () => {
  assert.equal(redactEmails('联系 zhangsan@qq.com 处理'), '联系 z******@qq.com 处理');
  assert.equal(redactEmails('多个 a@b.com、c@d.cn'), '多个 a**@b.com、c**@d.cn');
  assert.equal(redactEmails('已脱敏 z******@qq.com'), '已脱敏 z******@qq.com');
  assert.equal(redactEmails('没有邮箱'), '没有邮箱');
});

// ---------------------------------------------------------------------------
// 21001 / 60020 建议进入报告
// ---------------------------------------------------------------------------

test('建议渲染：飞书 21001 的「租户策略/企业认证」提示出现在报告里', () => {
  const advice = explainFeishuError(21001, 'tenant policy denied');
  const text = renderTextReport(
    report({
      checks: [check({ status: 'FAIL', detail: advice.detail, hint: advice.hint })],
    }),
  );
  assert.ok(text.includes('21001'));
  assert.ok(text.includes('企业认证'));
  assert.ok(text.includes('租户策略'));
});

test('建议渲染：企微 60020 的出口 IP 与「加入企业可信IP」步骤出现在报告里', () => {
  const advice = explainWecomError(60020, 'not allow to access from your ip', { egressIp: '203.0.113.9' });
  const text = renderTextReport(
    report({
      egressIp: '203.0.113.9',
      checks: [
        check({
          group: Platform.WECOM,
          id: 'wecom:token',
          title: '企业微信 access_token（应用凭据校验）',
          status: 'FAIL',
          detail: advice.detail,
          hint: advice.hint,
        }),
      ],
    }),
  );
  assert.ok(text.includes('60020'));
  assert.ok(text.includes('203.0.113.9'));
  assert.ok(text.includes('企业可信IP'));
  assert.ok(text.includes('应用管理'));
});

// ---------------------------------------------------------------------------
// JSON 输出
// ---------------------------------------------------------------------------

test('JSON：结构合法、字段齐全、FAIL 时 ok=false 且 exitCode=1', () => {
  const raw = renderJsonReport(
    report({
      checks: [check(), check({ id: 'mail:skipped', status: 'SKIP' }), check({ status: 'FAIL' })],
      egressIp: '203.0.113.9',
    }),
  );
  const parsed = JSON.parse(raw);
  assert.equal(parsed.tool, 'linkhub-doctor');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.exitCode, 1);
  assert.equal(parsed.egressIp, '203.0.113.9');
  assert.deepEqual(parsed.summary, { pass: 1, fail: 1, skip: 1 });
  assert.ok(Array.isArray(parsed.platforms));
  assert.ok(Array.isArray(parsed.checks));
  assert.equal(parsed.environment.nodeVersion, 'v24.14.0');
  assert.ok(raw.trimStart().startsWith('{'));
  assert.ok(raw.trimEnd().endsWith('}'));
});

test('JSON：邮箱地址同样脱敏（平台账号与检查详情都不出现明文）', () => {
  const raw = renderJsonReport(
    report({
      platforms: [mailPlatform()],
      checks: [
        check({
          group: Platform.MAIL,
          id: 'mail:qq:imap',
          title: '邮箱 IMAP 登录基线',
          status: 'FAIL',
          detail: 'IMAP 登录失败（zhangsan@qq.com）',
        }),
      ],
    }),
  );
  assert.ok(!raw.includes('zhangsan@qq.com'), 'JSON 输出泄露了完整邮箱地址');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.platforms[0].mailAccounts[0].address, 'z******@qq.com');
  assert.ok(parsed.platforms[0].mailIssues[0].message.includes('z******@qq.com'));
  assert.ok(parsed.checks[0].detail.includes('z******@qq.com'));
});

test('JSON：全部通过时 ok=true 且 exitCode=0', () => {
  const parsed = JSON.parse(renderJsonReport(report()));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.exitCode, 0);
  assert.equal(parsed.platformFilter, null);
  assert.equal(parsed.egressIp, null);
});

// ---------------------------------------------------------------------------
// 表格宽度工具
// ---------------------------------------------------------------------------

test('显示宽度：CJK 按 2 列、ASCII 按 1 列，padDisplay 能对齐中文表格', () => {
  assert.equal(displayWidth('飞书'), 4);
  assert.equal(displayWidth('企业微信'), 8);
  assert.equal(displayWidth('feishu'), 6);
  assert.equal(padDisplay('飞书', 8), '飞书    ');
  assert.equal(padDisplay('feishu', 8), 'feishu  ');
});
