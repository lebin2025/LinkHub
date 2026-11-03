/**
 * SMTP 传输层单测：EHLO 能力解析、认证机制选择、STARTTLS 前置校验/升级流程、
 * 发信命令序列与登录自检。全部用假 socket + 注入 upgrade，不联网。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import type { MailAccount } from '../../config';
import {
  buildPlainAuthPayload,
  chooseAuthMechanism,
  openSmtpSession,
  parseEhloCapabilities,
  sendMail,
  verifySmtpAuth,
  type SmtpTransportDeps,
} from './smtpClient';

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const guard = new Promise<never>((_res, rej) => {
    timer = setTimeout(() => rej(new Error(`${label}：SMTP 客户端疑似空转卡死`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer!);
  }
}

interface FakeSocket extends EventEmitter {
  destroyed: boolean;
  writes: string[];
  write(data: string): boolean;
  end(): void;
  destroy(err?: Error): void;
}

/** 假 socket：write 时按 replier 返回的文本同步投递 data（模拟服务端即时应答） */
function fakeSocket(replier?: (cmd: string) => string | undefined): FakeSocket {
  const ee = new EventEmitter() as any;
  ee.destroyed = false;
  ee.writes = [];
  ee.write = (data: string) => {
    ee.writes.push(data);
    const reply = replier?.(data);
    // 真实服务端的应答都以 CRLF 结尾（多行应答的最后一行也不例外）
    if (reply) ee.emit('data', Buffer.from(reply.endsWith('\r\n') ? reply : `${reply}\r\n`, 'utf8'));
    return true;
  };
  ee.end = () => undefined;
  ee.destroy = () => {
    ee.destroyed = true;
  };
  return ee;
}

/** greeting 必须在会话挂上监听之后才投递，否则会被丢掉 */
function greetingLater(sock: FakeSocket, line: string): void {
  setImmediate(() => sock.emit('data', Buffer.from(`${line}\r\n`, 'utf8')));
}

function account(over: Partial<MailAccount> = {}): MailAccount {
  return {
    key: 'test', label: '测试邮箱', address: 'me@example.com', authCode: 'auth-code', provider: 'custom',
    imapHost: 'imap.example.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.example.com', smtpPort: 465, smtpSecure: true,
    folders: ['INBOX'],
    ...over,
  };
}

const GREETING = '220 smtp.example.com ESMTP ready';
const EHLO_PLAIN = '250-smtp.example.com\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10485760';
const EHLO_TLS = '250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 10485760';
const firstLine = (s: string) => s.split('\r\n')[0];

// ---------------------------------------------------------------------------
// 纯函数：EHLO 能力解析与认证机制选择
// ---------------------------------------------------------------------------

test('parseEhloCapabilities：多行 250 应答提取服务端标识、AUTH 机制与 STARTTLS', () => {
  const caps = parseEhloCapabilities(EHLO_PLAIN);
  assert.equal(caps.server, 'smtp.example.com');
  assert.deepEqual(caps.auth, ['PLAIN', 'LOGIN']);
  assert.equal(caps.starttls, true);
  assert.equal(caps.lines.length, 4);
});

test('parseEhloCapabilities：兼容 AUTH= 旧写法、无 STARTTLS 与重复机制', () => {
  assert.deepEqual(parseEhloCapabilities('250 AUTH=LOGIN PLAIN'), {
    server: 'AUTH=LOGIN PLAIN',
    auth: ['LOGIN', 'PLAIN'],
    starttls: false,
    lines: ['AUTH=LOGIN PLAIN'],
  });
  // QQ 老服务器会重复给多行 AUTH=LOGIN / AUTH=LOGIN PLAIN
  const qq = parseEhloCapabilities('250-smtp.qq.com\r\n250-AUTH=LOGIN\r\n250-AUTH=LOGIN PLAIN\r\n250 8BITMIME');
  assert.deepEqual(qq.auth, ['LOGIN', 'PLAIN']);
  assert.equal(qq.starttls, false);
});

test('chooseAuthMechanism：声明 PLAIN 优先 PLAIN，否则回退原有 AUTH LOGIN', () => {
  assert.equal(chooseAuthMechanism(parseEhloCapabilities(EHLO_TLS)), 'plain');
  assert.equal(chooseAuthMechanism(parseEhloCapabilities('250-smtp.example.com\r\n250-AUTH LOGIN\r\n250 SIZE 1024')), 'login');
  assert.equal(chooseAuthMechanism([]), 'login');
  assert.equal(chooseAuthMechanism(['LOGIN', 'PLAIN']), 'plain');
});

test('buildPlainAuthPayload：base64(`\\0账号\\0授权码`)', () => {
  const token = buildPlainAuthPayload('me@example.com', 'secret');
  assert.equal(Buffer.from(token, 'base64').toString('utf8'), '\0me@example.com\0secret');
});

// ---------------------------------------------------------------------------
// 明文链路：EHLO → STARTTLS → 升级 → 重新 EHLO → AUTH
// ---------------------------------------------------------------------------

test('SMTP：明文链路 EHLO→STARTTLS→升级→重新 EHLO→AUTH PLAIN，认证命令只落在升级后的 socket', async () => {
  const plain = fakeSocket((cmd) => {
    if (/^EHLO /.test(cmd)) return EHLO_PLAIN;
    if (cmd.trim() === 'STARTTLS') return '220 2.0.0 Ready to start TLS';
    return undefined;
  });
  const secure = fakeSocket((cmd) => {
    if (/^EHLO /.test(cmd)) return EHLO_TLS;
    if (/^AUTH PLAIN /.test(cmd)) return '235 2.7.0 Authentication successful';
    return undefined;
  });
  let upgradedFrom: FakeSocket | undefined;
  const deps: SmtpTransportDeps = {
    connectPlain: async () => {
      greetingLater(plain, GREETING);
      return plain as unknown as Socket;
    },
    upgradeTls: async (from) => {
      upgradedFrom = from as unknown as FakeSocket;
      return secure as unknown as Socket;
    },
  };

  const opened = await withTimeout(openSmtpSession(account({ smtpSecure: false, smtpPort: 587 }), deps), 3000, 'STARTTLS 登录');
  try {
    assert.equal(upgradedFrom, plain, 'STARTTLS 必须升级同一根明文连接');
    // 升级前：只用明文 socket 发 EHLO 探测能力 + STARTTLS
    assert.equal(plain.writes.length, 2);
    assert.match(plain.writes[0], /^EHLO \S+\r\n$/);
    assert.equal(plain.writes[1], 'STARTTLS\r\n');
    // 升级后：重新 EHLO 再认证，绝不把 AUTH 写回明文 socket
    assert.equal(secure.writes.length, 2);
    assert.match(secure.writes[0], /^EHLO \S+\r\n$/);
    assert.match(secure.writes[1], /^AUTH PLAIN /);
    const token = firstLine(secure.writes[1]).split(' ')[2];
    assert.equal(Buffer.from(token, 'base64').toString('utf8'), '\0me@example.com\0auth-code');

    assert.equal(opened.auth, 'plain');
    assert.equal(opened.secure, true);
    assert.equal(opened.server, 'smtp.example.com ESMTP ready');
    assert.equal(opened.capabilities.starttls, false, '认证必须用升级后 EHLO 的新能力');
    assert.ok(opened.capabilities.auth.includes('PLAIN'));
    assert.ok(![...plain.writes, ...secure.writes].some((w) => /^(MAIL FROM|RCPT TO|DATA)/.test(w)));
  } finally {
    opened.session.close();
  }
});

test('SMTP：明文链路上服务端未声明 STARTTLS 时直接失败、不升级（拒绝明文认证）', async () => {
  const plain = fakeSocket((cmd) => (/^EHLO /.test(cmd) ? '250-smtp.example.com\r\n250-AUTH LOGIN\r\n250 SIZE 1024' : undefined));
  let upgradeCalls = 0;
  const deps: SmtpTransportDeps = {
    connectPlain: async () => {
      greetingLater(plain, GREETING);
      return plain as unknown as Socket;
    },
    upgradeTls: async () => {
      upgradeCalls += 1;
      throw new Error('不应触发 TLS 升级');
    },
  };

  await assert.rejects(
    () => withTimeout(openSmtpSession(account({ smtpSecure: false, smtpPort: 143 }), deps), 3000, 'STARTTLS 前置校验'),
    /未声明 STARTTLS/,
  );
  assert.equal(upgradeCalls, 0);
  assert.ok(!plain.writes.some((w) => w.startsWith('STARTTLS')), '能力不足时不得发送 STARTTLS');
  assert.equal(plain.destroyed, true, '失败后必须关闭连接');
});

test('SMTP：STARTTLS 应答非 220 时抛带 SMTP 码的错误且不升级', async () => {
  const plain = fakeSocket((cmd) => {
    if (/^EHLO /.test(cmd)) return EHLO_PLAIN;
    if (cmd.trim() === 'STARTTLS') return '454 4.7.0 TLS not available';
    return undefined;
  });
  let upgradeCalls = 0;
  const deps: SmtpTransportDeps = {
    connectPlain: async () => {
      greetingLater(plain, GREETING);
      return plain as unknown as Socket;
    },
    upgradeTls: async () => {
      upgradeCalls += 1;
      throw new Error('不应触发 TLS 升级');
    },
  };

  await assert.rejects(
    () => withTimeout(openSmtpSession(account({ smtpSecure: false, smtpPort: 587 }), deps), 3000, 'STARTTLS 失败'),
    /SMTP 454/,
  );
  assert.equal(upgradeCalls, 0);
});

// ---------------------------------------------------------------------------
// 隐式 TLS 发信：原有 sendMail 行为不破坏
// ---------------------------------------------------------------------------

test('sendMail：465 隐式 TLS 保持原命令序列（只 EHLO 一次、不走 STARTTLS）', async () => {
  const replies = [
    EHLO_TLS,
    '235 2.7.0 Authentication successful',
    '250 2.1.0 Ok',
    '250 2.1.5 Ok',
    '354 End data with <CR><LF>.<CR><LF>',
    '250 2.0.0 Ok: queued as ABC123',
    '221 2.0.0 Bye',
  ];
  let i = 0;
  const sock = fakeSocket(() => replies[i++]);
  const deps: SmtpTransportDeps = {
    connectTls: async () => {
      greetingLater(sock, GREETING);
      return sock as unknown as Socket;
    },
  };

  const receipt = await withTimeout(
    sendMail(account(), 'to@example.com', 'Subject: 测试\r\n\r\nhello', deps),
    3000,
    'sendMail',
  );
  assert.equal(receipt, '250 2.0.0 Ok: queued as ABC123');

  const cmds = sock.writes.map(firstLine);
  assert.equal(cmds.length, 7);
  assert.match(cmds[0], /^EHLO /);
  assert.match(cmds[1], /^AUTH PLAIN /);
  assert.equal(cmds[2], 'MAIL FROM:<me@example.com>');
  assert.equal(cmds[3], 'RCPT TO:<to@example.com>');
  assert.equal(cmds[4], 'DATA');
  assert.equal(cmds[6], 'QUIT');
  assert.ok(!sock.writes.some((w) => w.startsWith('STARTTLS')));
  assert.equal(sock.destroyed, true);
});

// ---------------------------------------------------------------------------
// 登录自检：只认证 + QUIT，绝不投递
// ---------------------------------------------------------------------------

test('verifySmtpAuth：走完 STARTTLS + AUTH PLAIN 后只 QUIT，绝不发 MAIL FROM/RCPT/DATA', async () => {
  const plain = fakeSocket((cmd) => {
    if (/^EHLO /.test(cmd)) return EHLO_PLAIN;
    if (cmd.trim() === 'STARTTLS') return '220 2.0.0 Ready to start TLS';
    return undefined;
  });
  const secure = fakeSocket((cmd) => {
    if (/^EHLO /.test(cmd)) return EHLO_TLS;
    if (/^AUTH PLAIN /.test(cmd)) return '235 2.7.0 Authentication successful';
    if (cmd.trim() === 'QUIT') return '221 2.0.0 Bye';
    return undefined;
  });
  const deps: SmtpTransportDeps = {
    connectPlain: async () => {
      greetingLater(plain, GREETING);
      return plain as unknown as Socket;
    },
    upgradeTls: async () => secure as unknown as Socket,
  };

  const r = await withTimeout(verifySmtpAuth(account({ smtpSecure: false, smtpPort: 587 }), deps), 3000, 'verifySmtpAuth');
  assert.deepEqual(r, { ok: true, server: 'smtp.example.com ESMTP ready', auth: 'plain', secure: true });

  const all = [...plain.writes, ...secure.writes].map(firstLine);
  assert.equal(all[all.length - 1], 'QUIT');
  assert.ok(!all.some((line) => /^(MAIL FROM|RCPT TO|DATA)/.test(line)), '自检不得投递任何邮件');
});

test('verifySmtpAuth：认证失败抛带 SMTP 码的错误（535）', async () => {
  const replies = ['250-smtp.example.com\r\n250-AUTH LOGIN\r\n250 SIZE 1024', '334 VXNlcm5hbWU6', '334 UGFzc3dvcmQ6', '535 5.7.8 Authentication failed'];
  let i = 0;
  const sock = fakeSocket(() => replies[i++]);
  const deps: SmtpTransportDeps = {
    connectTls: async () => {
      greetingLater(sock, GREETING);
      return sock as unknown as Socket;
    },
  };

  await assert.rejects(
    () => withTimeout(verifySmtpAuth(account(), deps), 3000, 'verifySmtpAuth 失败'),
    /SMTP 535/,
  );
  assert.ok(sock.writes.some((w) => w.startsWith('AUTH LOGIN')), '未声明 PLAIN 时应回退 AUTH LOGIN');
});

