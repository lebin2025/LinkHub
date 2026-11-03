/**
 * IMAP 读取器回归测试：TCP 把响应切成"半行"分片时必须照常前进。
 * 曾经的 bug：缓冲区只要非空就立刻 resolve，读半行时变成微任务死循环，
 * 把整个 Node 事件循环饿死（HTTP 都无响应），所以这里用假 socket 逐片投递。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { TLSSocket } from 'node:tls';
import { ImapSession } from './imapClient';

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
