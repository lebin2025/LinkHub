/**
 * IMAP 读取器回归测试：TCP 把响应切成"半行"分片时必须照常前进。
 * 曾经的 bug：缓冲区只要非空就立刻 resolve，读半行时变成微任务死循环，
 * 把整个 Node 事件循环饿死（HTTP 都无响应），所以这里用假 socket 逐片投递。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { TLSSocket } from 'node:tls';
import { ImapSession, fetchNewMails, encodeMailboxName, mailboxArg } from './imapClient';
import type { MailAccount } from '../../config';

function fakeSocket(): EventEmitter & { destroyed: boolean; writes: string[]; write: (data: string) => boolean } {
  const ee = new EventEmitter() as any;
  ee.destroyed = false;
  ee.writes = [];
  ee.write = (data: string) => { ee.writes.push(data); return true; };
  ee.end = () => undefined;
  ee.destroy = () => { ee.destroyed = true; };
  return ee;
}

const tick = () => new Promise((r) => setImmediate(r));

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const guard = new Promise<never>((_res, rej) => {
    timer = setTimeout(() => rej(new Error(`${label}：读取器疑似空转卡死`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    clearTimeout(timer!);
  }
}

test('IMAP：响应被切成半行时分片投递仍能完成命令', async () => {
  const sock = fakeSocket();
  const s = new ImapSession(sock as unknown as TLSSocket);
  const done = s.command('LOGIN user pass');

  for (const part of ['a1 OK ', 'LOGIN compl', 'eted\r\n']) {
    sock.emit('data', Buffer.from(part, 'utf8'));
    await tick();
  }

  const r = await withTimeout(done, 3000, 'LOGIN');
  assert.equal(r.ok, true);
  s.close();
});

test('IMAP：literal 正文跨分片到达也能完整取出', async () => {
  const sock = fakeSocket();
  const s = new ImapSession(sock as unknown as TLSSocket);
  const done = s.command('UID FETCH 9 BODY.PEEK[]');

  const body = Buffer.from('From: a@b.com\r\nSubject: 中文主题\r\n\r\n正文内容', 'utf8');
  const head = Buffer.from(`* 5 FETCH (UID 9 BODY[] {${body.length}}\r\n`, 'utf8');
  const tail = Buffer.from(`)\r\na1 OK FETCH completed\r\n`, 'utf8');

  sock.emit('data', head);
  await tick();
  for (let i = 0; i < body.length; i += 7) {
    sock.emit('data', body.subarray(i, i + 7));
    await tick();
  }
  sock.emit('data', tail);
  await tick();

  const r = await withTimeout(done, 3000, 'FETCH');
  assert.equal(r.ok, true);
  assert.equal(r.literals.length, 1);
  assert.equal(r.literals[0].toString('utf8'), body.toString('utf8'));
  s.close();
});

test('IMAP：连接被对端关闭时读取报错而不是空转', async () => {
  const sock = fakeSocket();
  const s = new ImapSession(sock as unknown as TLSSocket);
  const done = s.command('NOOP');
  sock.emit('close');
  await assert.rejects(() => withTimeout(done, 3000, 'NOOP'));
});

// ---------------------------------------------------------------------------
// 明文 143 + STARTTLS：用假 socket / 假 upgrade 覆盖，不联网
// ---------------------------------------------------------------------------

test('IMAP：greeting 后 STARTTLS 升级，ID/LOGIN 等后续命令写在升级后的 socket 上', async () => {
  const plain = fakeSocket();
  const secure = fakeSocket();
  let upgradedFrom: unknown;
  const s = new ImapSession(plain as unknown as TLSSocket, {
    upgrade: async (from) => {
      upgradedFrom = from;
      return secure as unknown as TLSSocket;
    },
  });

  // 1) 先投递 greeting
  plain.emit('data', Buffer.from('* OK IMAP4rev1 ready\r\n', 'utf8'));
  assert.equal(await s.greeting(), '* OK IMAP4rev1 ready');

  // 2) greeting 后 STARTTLS：命令写在明文 socket 上
  const upgrading = s.startTls();
  plain.emit('data', Buffer.from('a1 OK Begin TLS negotiation now\r\n', 'utf8'));
  await withTimeout(upgrading, 3000, 'STARTTLS');
  assert.equal(upgradedFrom, plain, '必须升级同一根明文连接');
  assert.deepEqual(plain.writes, ['a1 STARTTLS\r\n']);

  // 3) 升级后的 LOGIN 只能写在 TLS socket 上，绝不能回落到明文连接
  const login = s.command('LOGIN "me@example.com" "auth-code"');
  assert.deepEqual(secure.writes, ['a2 LOGIN "me@example.com" "auth-code"\r\n']);
  secure.emit('data', Buffer.from('a2 OK LOGIN completed\r\n', 'utf8'));
  const r = await withTimeout(login, 3000, 'LOGIN');
  assert.equal(r.ok, true);
  assert.deepEqual(plain.writes, ['a1 STARTTLS\r\n'], '升级后明文 socket 不应再收到任何命令');
  s.close();
});

test('IMAP：STARTTLS 被服务端拒绝时抛错且不触发 TLS 升级', async () => {
  const plain = fakeSocket();
  let upgradeCalls = 0;
  const s = new ImapSession(plain as unknown as TLSSocket, {
    upgrade: async () => {
      upgradeCalls += 1;
      return plain as unknown as TLSSocket;
    },
  });

  const upgrading = s.startTls();
  plain.emit('data', Buffer.from('a1 NO STARTTLS disabled\r\n', 'utf8'));
  await assert.rejects(() => withTimeout(upgrading, 3000, 'STARTTLS 拒绝'), /IMAP STARTTLS 失败/);
  assert.equal(upgradeCalls, 0);
});

test('IMAP：STARTTLS 升级保留升级前已缓冲的字节，不重置读取器', async () => {
  const plain = fakeSocket();
  const secure = fakeSocket();
  const s = new ImapSession(plain as unknown as TLSSocket, {
    upgrade: async () => secure as unknown as TLSSocket,
  });

  const upgrading = s.startTls();
  // 一次投递：STARTTLS 的 OK 行 + 紧随其后的残余字节（模拟粘包，升级时绝不能丢）
  plain.emit('data', Buffer.from('a1 OK Begin TLS negotiation now\r\n* PRE-TLS-RESIDUE\r\n', 'utf8'));
  await withTimeout(upgrading, 3000, 'STARTTLS');

  const noop = s.command('NOOP');
  secure.emit('data', Buffer.from('a2 OK NOOP completed\r\n', 'utf8'));
  const r = await withTimeout(noop, 3000, 'NOOP');
  assert.equal(r.ok, true);
  assert.deepEqual(r.lines, ['* PRE-TLS-RESIDUE'], '升级前缓冲的应答行必须还在');
  s.close();
});

// ---------------------------------------------------------------------------
// 非 ASCII 目录名：RFC 3501 modified UTF-7（只编码后拼 SELECT，不做 LIST 回读）
// ---------------------------------------------------------------------------

test('IMAP：modified UTF-7 编码命中 RFC 3501 示例向量', () => {
  assert.equal(encodeMailboxName('~peter/mail/台北/日本語'), '~peter/mail/&U,BTFw-/&ZeVnLIqe-');
});

test('IMAP：modified UTF-7 只编码非 ASCII，ASCII 原样且 & 转义成 &-', () => {
  assert.equal(encodeMailboxName('INBOX'), 'INBOX');
  assert.equal(encodeMailboxName('Archive/2026'), 'Archive/2026');
  assert.equal(encodeMailboxName('Sales & Marketing'), 'Sales &- Marketing');
  assert.equal(encodeMailboxName('a&b'), 'a&-b');
  assert.equal(encodeMailboxName('~peter/mail/台北'), '~peter/mail/&U,BTFw-');
});

test('IMAP：中文/日文目录编码结果（&...- + modified BASE64 的 , 分隔）', () => {
  assert.equal(encodeMailboxName('已发送'), '&XfJT0ZAB-');
  assert.equal(encodeMailboxName('收件箱'), '&ZTZO9nux-');
  assert.equal(encodeMailboxName('写邮件'), '&UZmQrk72-');
});

test('IMAP：mailboxArg 保持 INBOX 不引号 / ASCII 加引号 / 非 ASCII 先编码再加引号', () => {
  assert.equal(mailboxArg(''), 'INBOX');
  assert.equal(mailboxArg('inbox'), 'INBOX');
  assert.equal(mailboxArg(' INBOX '), 'INBOX');
  assert.equal(mailboxArg('Archive'), '"Archive"');
  assert.equal(mailboxArg('已发送'), '"&XfJT0ZAB-"');
  assert.equal(mailboxArg('Sales & Marketing'), '"Sales &- Marketing"');
  assert.equal(mailboxArg('~peter/mail/台北/日本語'), '"~peter/mail/&U,BTFw-/&ZeVnLIqe-"');
});

test('IMAP：mailboxArg 仍然拦掉会写坏命令结构的非法字符', () => {
  assert.throws(() => mailboxArg('bad"name'), /非法邮箱目录名/);
  assert.throws(() => mailboxArg("bad'name"), /非法邮箱目录名/);
  assert.throws(() => mailboxArg('bad\nname'), /非法邮箱目录名/);
  assert.throws(() => mailboxArg('bad\rname'), /非法邮箱目录名/);
});

// ---------------------------------------------------------------------------
// fetchNewMails：用命令脚本假会话覆盖「SELECT 里带编码目录名」，绝不联网
// ---------------------------------------------------------------------------

interface FakeReply {
  ok?: boolean;
  lines?: string[];
  literals?: Buffer[];
  text?: string;
}

const ACCOUNT: MailAccount = {
  key: 'qq', label: 'QQ邮箱', address: 'me@qq.com', authCode: 'auth-code', provider: 'qq',
  imapHost: 'imap.qq.com', imapPort: 993, imapSecure: true,
  smtpHost: 'smtp.qq.com', smtpPort: 465, smtpSecure: true,
  folders: ['INBOX'],
};

/** 假 ImapSession：按命令前缀返回预设应答，同时记录发出去的命令（可用于断言 SELECT 参数） */
function scriptedSession(handler: (args: string) => FakeReply): { session: ImapSession; commands: string[] } {
  const commands: string[] = [];
  const session = {
    greeting: async () => '* OK IMAP4rev1 ready',
    startTls: async () => undefined,
    close: () => undefined,
    command: async (args: string) => {
      commands.push(args);
      const r = handler(args) ?? {};
      return { ok: r.ok ?? true, lines: r.lines ?? [], literals: r.literals ?? [], text: r.text ?? 'OK completed' };
    },
  };
  return { session: session as unknown as ImapSession, commands };
}

test('IMAP：fetchNewMails 对中文目录发 SELECT 时带 modified UTF-7 编码并取回正文', async () => {
  const raw = Buffer.from('From: a@b.com\r\nSubject: 一手资讯\r\n\r\n正文内容', 'utf8');
  const { session, commands } = scriptedSession((args) => {
    if (args.startsWith('SELECT ')) return { lines: ['* 1 EXISTS'] };
    if (args === 'UID SEARCH ALL') return { lines: ['* SEARCH 3 7'] };
    if (args.startsWith('UID FETCH 7 ')) return { literals: [raw] };
    return {};
  });

  const r = await fetchNewMails(ACCOUNT, 5, 20, '已发送', { connect: async () => session });

  assert.ok(commands.includes('SELECT "&XfJT0ZAB-"'), `SELECT 命令应带编码后的目录名，实际：${commands.join(' | ')}`);
  assert.equal(r.mails.length, 1);
  assert.equal(r.mails[0].uid, 7);
  assert.equal(r.mails[0].raw.toString('utf8'), raw.toString('utf8'));
  assert.equal(r.maxUid, 7);
  assert.equal(r.greeting, '* OK IMAP4rev1 ready');
  assert.ok(commands.includes('LOGOUT'));
});

test('IMAP：fetchNewMails 的 INBOX 仍不带引号；sinceUid=null 只立基线不取正文', async () => {
  const { session, commands } = scriptedSession((args) => {
    if (args === 'UID SEARCH ALL') return { lines: ['* SEARCH 2 5 9'] };
    return {};
  });

  const r = await fetchNewMails(ACCOUNT, null, 20, 'INBOX', { connect: async () => session });

  assert.ok(commands.includes('SELECT INBOX'), `INBOX 不应被引号包住，实际：${commands.join(' | ')}`);
  assert.ok(!commands.some((c) => c.startsWith('UID FETCH')), '首轮立基线绝不能 FETCH 正文');
  assert.deepEqual(r.mails, []);
  assert.equal(r.maxUid, 9);
});

test('IMAP：个别取信失败以 failedUids 返回，不拖垮整批成功取到的信', async () => {
  const raw = Buffer.from('From: a@b.com\r\n\r\nok', 'utf8');
  const { session } = scriptedSession((args) => {
    if (args === 'UID SEARCH ALL') return { lines: ['* SEARCH 3 7'] };
    if (args.startsWith('UID FETCH 3 ')) return { ok: false, text: 'NO fetch failed' };
    if (args.startsWith('UID FETCH 7 ')) return { literals: [raw] };
    return {};
  });

  const r = await fetchNewMails(ACCOUNT, 1, 20, 'INBOX', { connect: async () => session });

  assert.equal(r.mails.length, 1);
  assert.equal(r.mails[0].uid, 7);
  assert.deepEqual(r.failedUids, [3], '失败的 UID 要上报，轮询器据此把水位停在缺口前');
});

test('IMAP：解析 SELECT 应答里的 UIDVALIDITY（目录重建检测的唯一依据）', async () => {
  const { session } = scriptedSession((args) => {
    if (args.startsWith('SELECT ')) {
      return { lines: ['* OK [UIDVALIDITY 456] UIDs valid', '* OK [UIDNEXT 9] Predicted next UID', '* 2 EXISTS'] };
    }
    if (args === 'UID SEARCH ALL') return { lines: ['* SEARCH 3 7'] };
    return {};
  });

  const r = await fetchNewMails(ACCOUNT, null, 20, '已发送', { connect: async () => session });

  assert.equal(r.uidValidity, 456);
  assert.equal(r.maxUid, 7, '立基线仍然只取最大 UID');
});

test('IMAP：SELECT 未上报 UIDVALIDITY 时保持 undefined（老服务端/假实现兼容）', async () => {
  const { session } = scriptedSession((args) => {
    if (args.startsWith('SELECT ')) return { lines: ['* 0 EXISTS'] };
    if (args === 'UID SEARCH ALL') return { lines: ['* SEARCH'] };
    return {};
  });

  const r = await fetchNewMails(ACCOUNT, null, 20, 'INBOX', { connect: async () => session });

  assert.equal(r.uidValidity, undefined);
  assert.equal(r.maxUid, 0);
});
