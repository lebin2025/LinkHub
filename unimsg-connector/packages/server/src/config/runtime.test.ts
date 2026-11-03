/**
 * 可替换性核心单测：环境变量 → 邮箱账号 / 平台运行模式。
 * 全部是纯函数测试，不触网、不改全局 process.env。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from '@unimsg/shared';
import {
  buildPlatformRuntime,
  inferMailProvider,
  parseMailAccounts,
  readPlatformCredentials,
  resolveModePolicies,
  type MailAccount,
  type PlatformCredentials,
} from './runtime';

function creds(): PlatformCredentials {
  return {
    feishu: { appId: '', appSecret: '', verifyToken: '', encryptKey: '', baseUrl: 'https://open.feishu.cn' },
    dingtalk: { appKey: '', appSecret: '', robotCode: '', aesToken: '', aesKey: '', stream: false, baseUrl: 'https://api.dingtalk.com' },
    wecom: { corpId: '', agentId: '', secret: '', token: '', aesKey: '', baseUrl: 'https://qyapi.weixin.qq.com' },
  };
}

function mailAccount(over: Partial<MailAccount> = {}): MailAccount {
  return {
    key: 'qq',
    label: 'QQ邮箱',
    address: 'me@qq.com',
    authCode: 'auth',
    provider: 'qq',
    imapHost: 'imap.qq.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
    smtpSecure: true,
    folders: ['INBOX'],
    ...over,
  };
}

function runtimeOf(env: NodeJS.ProcessEnv, over: { platforms?: PlatformCredentials; mailAccounts?: MailAccount[]; mailEnabled?: boolean } = {}) {
  return buildPlatformRuntime({
    env,
    platforms: over.platforms ?? readPlatformCredentials(env),
    mailAccounts: over.mailAccounts ?? [],
    mailIssues: [],
    mailEnabled: over.mailEnabled ?? (over.mailAccounts ?? []).length > 0,
    underTest: false,
  });
}

// ---------------------------------------------------------------------------
// 邮箱账号解析：任意服务商 / 任意数量
// ---------------------------------------------------------------------------

test('mail：不写 MAIL_ACCOUNTS 时自动发现 MAIL_<KEY>_ADDRESS，老配置零改动', () => {
  const r = parseMailAccounts({
    MAIL_QQ_ADDRESS: 'me@qq.com',
    MAIL_QQ_AUTH_CODE: 'code-qq',
    MAIL_163_ADDRESS: 'me@163.com',
    MAIL_163_AUTH_CODE: 'code-163',
  });
  assert.equal(r.accounts.length, 2);
  assert.deepEqual(r.accounts.map((a) => a.key), ['163', 'qq']); // 稳定字母序
  assert.equal(r.accounts.find((a) => a.key === 'qq')?.provider, 'qq');
  assert.equal(r.accounts.find((a) => a.key === '163')?.imapHost, 'imap.163.com');
  assert.equal(r.issues.length, 0);
});

test('mail：MAIL_ACCOUNTS 显式列账号 + 顺序保留 + 同名服务商多账号', () => {
  const r = parseMailAccounts({
    MAIL_ACCOUNTS: 'work,personal',
    MAIL_WORK_ADDRESS: 'a@corp.example.com',
    MAIL_WORK_AUTH_CODE: 'code-a',
    MAIL_WORK_IMAP_HOST: 'imap.corp.example.com',
    MAIL_WORK_SMTP_HOST: 'smtp.corp.example.com',
    MAIL_PERSONAL_ADDRESS: 'b@gmail.com',
    MAIL_PERSONAL_AUTH_CODE: 'code-b',
  });
  assert.deepEqual(r.accounts.map((a) => a.key), ['work', 'personal']);
  const work = r.accounts[0];
  assert.equal(work.provider, 'custom');
  assert.equal(work.imapHost, 'imap.corp.example.com');
  assert.equal(work.imapPort, 993);
  assert.equal(work.smtpPort, 465);
  assert.equal(work.smtpSecure, true);
  // Gmail 走内置预设；Gmail 需要应用专用密码，本质上也是"授权码"
  assert.equal(r.accounts[1].provider, 'gmail');
  assert.equal(r.accounts[1].imapHost, 'imap.gmail.com');
});

test('mail：按域名推断服务商（126 / yeah / outlook / icloud / 公司域名）', () => {
  assert.equal(inferMailProvider('a@126.com'), '126');
  assert.equal(inferMailProvider('a@yeah.net'), 'yeah');
  assert.equal(inferMailProvider('a@outlook.com'), 'outlook');
  assert.equal(inferMailProvider('a@hotmail.com'), 'outlook');
  assert.equal(inferMailProvider('a@icloud.com'), 'icloud');
  assert.equal(inferMailProvider('a@company.cn'), 'custom');
  assert.equal(inferMailProvider('a@qq.com', 'gmail'), 'gmail', '显式 provider 优先于域名');
});

test('mail：587 端口自动推断 STARTTLS，显式 _SMTP_SECURE 可覆盖', () => {
  const r = parseMailAccounts({
    MAIL_OUT_ADDRESS: 'a@outlook.com',
    MAIL_OUT_AUTH_CODE: 'x',
  });
  assert.equal(r.accounts[0].smtpPort, 587);
  assert.equal(r.accounts[0].smtpSecure, false, '587 走 STARTTLS 而不是隐式 TLS');
  assert.equal(r.accounts[0].imapSecure, true);

  const explicit = parseMailAccounts({
    MAIL_A_ADDRESS: 'a@outlook.com',
    MAIL_A_AUTH_CODE: 'x',
    MAIL_A_SMTP_SECURE: 'true',
  });
  assert.equal(explicit.accounts[0].smtpSecure, true);
});

test('mail：自定义服务商必须给 host，缺授权码/地址会进 issues 而不是静默跳过', () => {
  const r = parseMailAccounts({
    MAIL_ACCOUNTS: 'corp,broken,half',
    MAIL_CORP_ADDRESS: 'me@corp.cn',
    MAIL_CORP_AUTH_CODE: 'x',
    MAIL_BROKEN_ADDRESS: 'x@qq.com',
    MAIL_HALF_AUTH_CODE: 'only-auth-code',
  });
  assert.equal(r.accounts.length, 0, 'corp 缺 host、broken/half 缺地址或授权码，都不应算作可用账号');
  const msgs = r.issues.map((i) => i.message).join('\n');
  assert.match(msgs, /IMAP_HOST/);
  assert.match(msgs, /AUTH_CODE/);
  assert.match(msgs, /MAIL_HALF_ADDRESS/);
});

test('mail：单个账号的 host/port/label/folders 可逐项覆盖', () => {
  const r = parseMailAccounts({
    MAIL_QQ_ADDRESS: 'me@qq.com',
    MAIL_QQ_AUTH_CODE: 'x',
    MAIL_QQ_LABEL: '主邮箱',
    MAIL_QQ_IMAP_HOST: 'imap.example-proxy.com',
    MAIL_QQ_IMAP_PORT: '143',
    MAIL_QQ_SMTP_PORT: '25',
    MAIL_QQ_FOLDERS: 'INBOX, Junk',
  });
  const a = r.accounts[0];
  assert.equal(a.label, '主邮箱');
  assert.equal(a.imapHost, 'imap.example-proxy.com');
  assert.equal(a.imapPort, 143);
  assert.equal(a.imapSecure, false, '143 → STARTTLS');
  assert.equal(a.smtpPort, 25);
  assert.equal(a.smtpSecure, false, '25 → STARTTLS');
  assert.deepEqual(a.folders, ['INBOX', 'Junk']);
});

// ---------------------------------------------------------------------------
// 模式解析：auto / real / mock 与旧 MOCK 兼容
// ---------------------------------------------------------------------------

test('mode：没配凭据时 auto → 全部 mock，且不出现"假装真实"', () => {
  const rt = runtimeOf({}, { mailAccounts: [], mailEnabled: false });
  for (const p of Object.values(Platform)) {
    assert.equal(rt[p].mode, 'mock', `${p} 应为 mock`);
    assert.equal(rt[p].policy, 'auto');
    assert.equal(rt[p].configured, false);
  }
});

test('mode：只配钉钉 → 钉钉 real，其余 mock（可替换性的关键场景）', () => {
  const rt = runtimeOf({
    DINGTALK_CLIENT_ID: 'ding1',
    DINGTALK_CLIENT_SECRET: 'secret1',
    DINGTALK_STREAM: 'true',
  });
  assert.equal(rt[Platform.DINGTALK].mode, 'real');
  assert.equal(rt[Platform.DINGTALK].canReceive, true, 'Stream 长连接可收');
  assert.equal(rt[Platform.DINGTALK].canSend, true, 'ROBOT_CODE 缺省等于 Client ID');
  assert.deepEqual(rt[Platform.DINGTALK].missing, [], 'Stream 模式不需要 HTTP 回调用 AES Token/Key');
  assert.equal(rt[Platform.FEISHU].mode, 'mock');
  assert.equal(rt[Platform.WECOM].mode, 'mock');
  assert.equal(rt[Platform.MAIL].mode, 'mock');
  assert.match(rt[Platform.DINGTALK].reason, /真实接口/);
});

test('mode：显式 mock 即使有凭据也走本地模拟（绝不偷偷打真实接口）', () => {
  const rt = runtimeOf({
    FEISHU_MODE: 'mock',
    FEISHU_APP_ID: 'a',
    FEISHU_APP_SECRET: 'b',
    FEISHU_VERIFY_TOKEN: 'c',
  });
  assert.equal(rt[Platform.FEISHU].mode, 'mock');
  assert.equal(rt[Platform.FEISHU].policy, 'mock');
  assert.match(rt[Platform.FEISHU].reason, /显式指定/);
});

test('mode：显式 real 但缺凭据 → real + missing 清单，由发送守卫显式报错', () => {
  const rt = runtimeOf({ WECOM_MODE: 'real' });
  const wecom = rt[Platform.WECOM];
  assert.equal(wecom.mode, 'real');
  assert.equal(wecom.configured, false);
  assert.ok(wecom.missing.includes('WECOM_CORP_ID'));
  assert.ok(wecom.missing.includes('WECOM_SECRET'));
  assert.ok(wecom.missing.includes('WECOM_AGENT_ID'));
});

test('mode：旧 MOCK=true / false 仍可用但会提示废弃', () => {
  const on = resolveModePolicies({ MOCK: 'true' });
  assert.equal(on.policies[Platform.FEISHU], 'mock');
  assert.match(on.warnings.join('\n'), /MOCK 已废弃/);

  const off = resolveModePolicies({ MOCK: 'false' });
  assert.equal(off.policies[Platform.MAIL], 'real');

  // *_MODE 优先级高于 MOCK
  const mixed = resolveModePolicies({ MOCK: 'true', FEISHU_MODE: 'real' });
  assert.equal(mixed.policies[Platform.FEISHU], 'real');
  assert.equal(mixed.policies[Platform.DINGTALK], 'mock');
});

test('mode：非法 *_MODE 值回退 auto 并给出警告', () => {
  const r = resolveModePolicies({ FEISHU_MODE: 'yes-please' });
  assert.equal(r.policies[Platform.FEISHU], 'auto');
  assert.match(r.warnings.join('\n'), /FEISHU_MODE/);
});

test('mode：测试环境默认 mock（单测绝不外呼），unless 显式 force', () => {
  const rt = buildPlatformRuntime({
    env: { FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 'b', FEISHU_VERIFY_TOKEN: 'c' },
    platforms: readPlatformCredentials({ FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 'b', FEISHU_VERIFY_TOKEN: 'c' }),
    mailAccounts: [],
    mailIssues: [],
    mailEnabled: false,
    underTest: true,
  });
  assert.equal(rt[Platform.FEISHU].mode, 'mock');
});

// ---------------------------------------------------------------------------
// 能力画像：前端/doctor 使用的 missing / warnings
// ---------------------------------------------------------------------------

test('capability：飞书只配 AppID/Secret → 发✓收✗，警告缺 Verification Token', () => {
  const rt = runtimeOf({
    FEISHU_APP_ID: 'a',
    FEISHU_APP_SECRET: 'b',
  });
  const f = rt[Platform.FEISHU];
  assert.equal(f.mode, 'real');
  assert.equal(f.canSend, true);
  assert.equal(f.canReceive, false);
  assert.ok(f.warnings.some((w) => w.includes('只能发不能收')));
  assert.ok(f.missing.includes('FEISHU_VERIFY_TOKEN'));
});

test('capability：企微回调凭据齐全 → 收✓；缺少 AgentId 时不能发并进 missing', () => {
  const base = { WECOM_CORP_ID: 'ww1', WECOM_SECRET: 's', WECOM_TOKEN: 't', WECOM_AES_KEY: 'k' };
  const noAgent = runtimeOf(base);
  assert.equal(noAgent[Platform.WECOM].canReceive, true);
  assert.equal(noAgent[Platform.WECOM].canSend, false);
  assert.ok(noAgent[Platform.WECOM].missing.includes('WECOM_AGENT_ID'));

  const full = runtimeOf({ ...base, WECOM_AGENT_ID: '1000002' });
  assert.equal(full[Platform.WECOM].mode, 'real');
  assert.equal(full[Platform.WECOM].canSend, true);
});

test('capability：邮箱有账号 → 收发均 ✓；MAIL_ENABLED=false 时只发不收', () => {
  const accounts = [mailAccount()];
  const on = runtimeOf({}, { mailAccounts: accounts, mailEnabled: true });
  assert.equal(on[Platform.MAIL].mode, 'real');
  assert.equal(on[Platform.MAIL].canReceive, true);
  assert.equal(on[Platform.MAIL].canSend, true);

  const off = runtimeOf({}, { mailAccounts: accounts, mailEnabled: false });
  assert.equal(off[Platform.MAIL].canReceive, false);
  assert.ok(off[Platform.MAIL].warnings.some((w) => w.includes('MAIL_ENABLED=false')));
});

test('readPlatformCredentials：旧钉钉变量名兼容 + baseUrl 可覆盖并可去尾斜杠', () => {
  const c = readPlatformCredentials({
    DINGTALK_APP_KEY: 'old-key',
    DINGTALK_APP_SECRET: 'old-secret',
    FEISHU_BASE_URL: 'https://open.larksuite.com/',
  });
  assert.equal(c.dingtalk.appKey, 'old-key');
  assert.equal(c.dingtalk.robotCode, 'old-key', 'ROBOT_CODE 缺省 = Client ID');
  assert.equal(c.feishu.baseUrl, 'https://open.larksuite.com');
  assert.equal(c.dingtalk.baseUrl, 'https://api.dingtalk.com');
});
