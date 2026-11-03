/**
 * 邮箱连接器单测：MIME 解析、统一消息映射、回写报文构造、验签策略。
 * 全程不触网（IMAP/SMTP 客户端只被 import，不被调用）。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Platform, MsgStatus } from '@unimsg/shared';
import { config, type MailAccount } from '../../config';
import { readMessage, decodeWords, parseAddress, buildMail } from './mime';
import { mailConnector, receive, convert, send, verify } from './mail';
import { sentBox } from '../base';

const CRLF = '\r\n';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const wrap = (s: string) => b64(s).replace(/(.{76})/g, `$1${CRLF}`);

const qq: MailAccount = {
  key: 'qq', label: 'QQ邮箱', address: 'me@qq.com', authCode: 'authcode-qq',
  imapHost: 'imap.qq.com', imapPort: 993, smtpHost: 'smtp.qq.com', smtpPort: 465,
  folders: ['INBOX'],
};

function simpleMail(subject: string, text: string): string {
  return [
    `From: =?UTF-8?B?${b64('陈晨')}?= <chen@example.com>`,
    'To: me@qq.com',
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'Date: Mon, 3 Nov 2026 10:00:00 +0800',
    'Message-ID: <msg-001@example.com>',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(text),
  ].join(CRLF);
}

const orig = { mock: config.mock, accounts: config.mail.accounts };

before(() => {
  config.mail.accounts = [qq];
});
after(() => {
  config.mock = orig.mock;
  config.mail.accounts = orig.accounts;
});
beforeEach(() => {
  config.mock = orig.mock;
});

test('MIME：解码 encoded-word 中文主题与 base64 正文', () => {
  const m = readMessage(simpleMail('项目周报', '这周的联调已经跑通'));
  assert.equal(m.subject, '项目周报');
  assert.equal(m.text, '这周的联调已经跑通');
  assert.equal(m.from.address, 'chen@example.com');
  assert.equal(m.from.name, '陈晨');
  assert.equal(m.messageId, 'msg-001@example.com');
});

test('MIME：GBK 字符集主题按 GBK 解码而不是乱码', () => {
  const raw = ['From: a@b.com', 'Subject: =?GBK?B?suLK1A==?=', 'Content-Type: text/plain; charset=GBK', '', 'hello'].join(CRLF);
  assert.equal(readMessage(raw).subject, '测试');
});

test('MIME：multipart 优先取 text/plain，quoted-printable 与软换行还原', () => {
  const raw = [
    'From: a@b.com',
    'Subject: mixed',
    'Content-Type: multipart/alternative; boundary="BD"',
    '',
    '--BD',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Hello=20world=0Asecond=20line',
    '--BD',
    'Content-Type: text/html; charset=UTF-8',
    '',
    '<html><body><p>不该被选中的 HTML</p></body></html>',
    '--BD--',
  ].join(CRLF);
  assert.equal(readMessage(raw).text, 'Hello world\nsecond line');
});

test('MIME：只有 HTML 时去标签兜底', () => {
  const raw = [
    'From: a@b.com',
    'Subject: html only',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap('<div><script>var x=1;</script><p>第一段</p><p>第二段</p></div>'),
  ].join(CRLF);
  assert.equal(readMessage(raw).text, '第一段\n第二段');
});

test('MIME：折行的头部与多收件人 To', () => {
  const raw = [
    'From: <solo@x.com>',
    'Subject: =?UTF-8?B?' + b64('很长') + '?=',
    ' =?UTF-8?B?' + b64('主题') + '?=',
    'To: me@qq.com,',
    ' other@qq.com',
    '',
    'body',
  ].join(CRLF);
  const m = readMessage(raw);
  assert.equal(m.subject, '很长 主题');
  assert.equal(m.from.address, 'solo@x.com');
  assert.match(m.to, /other@qq\.com/);
});

test('parseAddress/decodeWords 边界', () => {
  assert.deepEqual(parseAddress('"张三" <z@y.com>'), { name: '张三', address: 'z@y.com' });
  assert.deepEqual(parseAddress('plain@x.com'), { name: '', address: 'plain@x.com' });
  assert.equal(decodeWords('no encoded words here'), 'no encoded words here');
});

test('receive：外部Id 带账号前缀，会话号即回信地址', () => {
  const parsed = readMessage(simpleMail('周报确认', '记得交周报'));
  const m = receive({ source: 'imap', account: 'qq', folder: 'INBOX', uid: 42, ...parsed });
  assert.equal(m.platform, Platform.MAIL);
  assert.equal(m.externalId, 'qq:INBOX:42');
  assert.equal(m.conversation?.id, 'chen@example.com');
  assert.equal(m.conversation?.type, 'p2p');
  assert.equal(m.sender.name, '陈晨');
  assert.equal(m.status, MsgStatus.RECEIVED);
  assert.equal(m.mailMeta?.account, 'qq');
  assert.equal(m.mailMeta?.inReplyTo, 'msg-001@example.com');
  assert.equal(m.body, '周报确认\n\n记得交周报');
  // 正文含"周报" → 待办类，与其他平台同一套推断
  assert.equal(m.type, 'todo');
});

test('receive：同一 UID 落在不同目录不会互相幂等吞掉', () => {
  const parsed = readMessage(simpleMail('项目周报', '内容'));
  const inbox = receive({ source: 'imap', account: 'qq', folder: 'INBOX', uid: 1, ...parsed });
  const junk = receive({ source: 'imap', account: 'qq', folder: 'Junk', uid: 1, ...parsed });
  assert.notEqual(inbox.externalId, junk.externalId);
  // 回信仍要认得账号
  assert.equal(convert(junk).accountKey, 'qq');
});

test('receive：非 IMAP 事件直接拒绝，避免伪造入库', () => {
  assert.throws(() => receive({ account: 'qq', uid: 1 }), /source=imap/);
});

test('receive：超长正文截断到入库上限', () => {
  const parsed = readMessage(simpleMail('长信', 'x'.repeat(5000)));
  const m = receive({ source: 'imap', account: 'qq', folder: 'INBOX', uid: 7, ...parsed });
  assert.ok(m.body.length <= 2000 + 10);
});

test('convert：回写信封带账号地址与原 Message-ID', () => {
  const parsed = readMessage(simpleMail('项目周报', '内容'));
  const inbound = receive({ source: 'imap', account: 'qq', folder: 'INBOX', uid: 42, ...parsed });
  const env = convert({ ...inbound, reply: '收到，今晚给结论' });
  assert.equal(env.accountKey, 'qq');
  assert.equal(env.from, 'me@qq.com');
  assert.equal(env.to, 'chen@example.com');
  assert.equal(env.text, '收到，今晚给结论');
  assert.equal(env.inReplyTo, 'msg-001@example.com');
});

test('buildMail：主题加 Re:、中文主题 encoded-word、正文 base64 可还原', () => {
  const raw = buildMail('me@qq.com', 'chen@example.com', '项目周报', '第一行\n第二行', {
    inReplyTo: 'msg-001@example.com',
    messageId: 'reply-1@linkhub.local',
  });
  assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(raw, /In-Reply-To: <msg-001@example\.com>/);
  assert.match(raw, /Message-ID: <reply-1@linkhub\.local>/);
  assert.ok(raw.endsWith(`${CRLF}.${CRLF}`));

  const back = readMessage(raw);
  assert.equal(back.subject, 'Re: 项目周报');
  assert.equal(back.text, '第一行\n第二行');
  assert.equal(back.inReplyTo, 'msg-001@example.com');
});

test('buildMail：已有 Re: 不重复叠加', () => {
  const raw = buildMail('me@qq.com', 'a@b.com', 'Re: 讨论', 'ok', { messageId: 'x@l' });
  assert.equal(readMessage(raw).subject, 'Re: 讨论');
});

test('send：Mock 模式进已发送箱，真实模式缺账号才报错', async () => {
  config.mock = true;
  const parsed = readMessage(simpleMail('项目周报', '内容'));
  const inbound = receive({ source: 'imap', account: 'qq', folder: 'INBOX', uid: 43, ...parsed });
  const before = sentBox[Platform.MAIL].length;
  const r = await send({ ...inbound, reply: '好的' });
  assert.equal(r.ok, true);
  assert.equal(sentBox[Platform.MAIL].length, before + 1);

  config.mock = false;
  config.mail.accounts = [];
  await assert.rejects(() => send({ ...inbound, reply: '好的' }), /邮箱账号未配置/);
  config.mail.accounts = [qq];
  await assert.rejects(() => send({ ...inbound, reply: '好的', conversation: undefined }), /缺少收件人/);
});

test('verify：真实模式拒绝 /webhook/mail（邮箱没有回调），Mock 模式放行演示签名', () => {
  config.mock = false;
  assert.equal(verify({ any: 'payload' }, 'anything'), false);
  config.mock = true;
  assert.equal(verify({ any: 'payload' }, 'mock'), true);
});

test('连接器已注册进注册表且实现四件套', () => {
  assert.equal(typeof mailConnector.send, 'function');
  assert.equal(typeof mailConnector.verify, 'function');
  assert.equal(typeof mailConnector.receive, 'function');
  assert.equal(typeof mailConnector.convert, 'function');
});
