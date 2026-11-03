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

function fakeSocket(): EventEmitter & { destroyed: boolean; write: () => boolean } {
  const ee = new EventEmitter() as any;
  ee.destroyed = false;
  ee.write = () => true;
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
