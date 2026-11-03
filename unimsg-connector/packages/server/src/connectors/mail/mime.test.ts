/**
 * MIME 递归解析单测（全程纯字符串 + Buffer，不联网）：
 *  - P0 回归：multipart/mixed 里嵌 multipart/alternative 时正文绝不能丢、附件不能被当正文；
 *  - 附件摘要：[附件] a, b 只在确认无正文时出现；
 *  - 编码兼容：base64 / quoted-printable / GBK 在 part 级生效，嵌套后仍然正确；
 *  - boundary 引号、边界前缀撞车、preamble/epilogue 等易踩坑位。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMessage, extractText, extractMail, parseMail } from './mime';

const CRLF = '\r\n';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
/** 头部里的中文走 encoded-word（真实邮件都这样，避免裸 UTF-8 头部的歧义） */
const encodedWord = (s: string) => `=?UTF-8?B?${b64(s)}?=`;
/** 报文里有裸中文时必须按 UTF-8 Buffer 传入（parseMail 对 string 按 latin1/binary 解释） */
const read = (raw: string) => readMessage(Buffer.from(raw, 'utf8'));
const parse = (raw: string) => parseMail(Buffer.from(raw, 'utf8'));

/** 一段 MIME part：头部 + 空行 + 体 */
function part(headers: string[], body: string): string {
  return [...headers, '', body].join(CRLF);
}

/** multipart 体：--boundary 分隔各 part，末尾 --boundary--；preamble/epilogue 默认为空 */
function multipart(boundary: string, parts: string[], opts: { preamble?: string; epilogue?: string } = {}): string {
  const preamble = opts.preamble ? `${opts.preamble}${CRLF}` : '';
  const epilogue = opts.epilogue ? `${CRLF}${opts.epilogue}` : '';
  const body = parts.map((p) => `--${boundary}${CRLF}${p}`).join(CRLF);
  return `${preamble}${body}${CRLF}--${boundary}--${epilogue}`;
}

/** 完整邮件：顶层头部 + 空行 + 体 */
function mail(headers: string[], body: string): string {
  return [...headers, '', body].join(CRLF);
}

/** 典型「multipart/mixed 内含 multipart/alternative 正文 + 附件」结构 */
function mixedWithAlternative(): { raw: string; plain: string } {
  const plain = '这是嵌套在 alternative 里的纯文本正文';
  const inner = multipart('alt-1', [
    part(['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'], b64(plain)),
    part(['Content-Type: text/html; charset=UTF-8'], '<p>这是 HTML 版本，不该被选中</p>'),
  ]);
  const raw = mail(
    ['From: a@example.com', `Subject: ${encodedWord('嵌套正文')}`, 'Content-Type: multipart/mixed; boundary="mixed-1"'],
    multipart('mixed-1', [
      part(['Content-Type: multipart/alternative; boundary="alt-1"'], inner),
      part(['Content-Type: application/pdf; name="report.pdf"', 'Content-Disposition: attachment; filename="report.pdf"'], b64('%PDF-1.4 fake')),
    ]),
  );
  return { raw, plain };
}

test('MIME：multipart/mixed 内嵌 multipart/alternative 时取纯文本正文（P0 回归）', () => {
  const { raw, plain } = mixedWithAlternative();
  const m = read(raw);
  assert.equal(m.subject, '嵌套正文');
  assert.equal(m.text, plain);
  assert.deepEqual(m.attachments, ['report.pdf'], '附件名要单独收敛到 attachments，不能挤掉正文');
  assert.equal(extractText(parse(raw)), plain);
});

test('MIME：嵌套 alternative 只有 HTML 时，仍去标签兜底', () => {
  const inner = multipart('alt-html', [
    part(['Content-Type: text/html; charset=UTF-8'], '<div><script>var x=1;</script><p>第一段</p><p>第二段</p></div>'),
  ]);
  const raw = mail(
    ['From: a@example.com', 'Content-Type: multipart/mixed; boundary="mixed-html"'],
    multipart('mixed-html', [
      part(['Content-Type: multipart/alternative; boundary="alt-html"'], inner),
      part(['Content-Type: application/pdf', 'Content-Disposition: attachment; filename="x.pdf"'], '%PDF'),
    ]),
  );
  assert.equal(read(raw).text, '第一段\n第二段');
});

test('MIME：Content-Disposition: attachment 的 text/plain part 不能被当正文', () => {
  const raw = mail(
    ['From: a@example.com', 'Content-Type: multipart/mixed; boundary="m"'],
    multipart('m', [
      part(['Content-Type: text/plain; charset=UTF-8', 'Content-Disposition: attachment; filename="notes.txt"'], '附件里的文本，不该当正文'),
      part(['Content-Type: text/plain; charset=UTF-8'], '这才是真正的正文'),
    ]),
  );
  const m = read(raw);
  assert.equal(m.text, '这才是真正的正文');
  assert.deepEqual(m.attachments, ['notes.txt']);
});

test('MIME：正文为空且只有附件时返回 [附件] a, b 摘要', () => {
  const raw = mail(
    ['From: a@example.com', 'Content-Type: multipart/mixed; boundary="m"'],
    multipart('m', [
      part(['Content-Type: application/pdf; name="a.pdf"', 'Content-Disposition: attachment; filename="a.pdf"'], '%PDF-A'),
      part(['Content-Type: image/png; name="b.png"'], 'PNG-BYTES'),
    ]),
  );
  const m = read(raw);
  assert.equal(m.text, '[附件] a.pdf, b.png');
  assert.deepEqual(m.attachments, ['a.pdf', 'b.png']);
});

test('MIME：引号 boundary、正则特殊字符、内外 boundary 前缀撞车、preamble/epilogue', () => {
  // 外层 boundary 带 . + 等正则元字符，且是内层 boundary 的前缀：旧实现用字符串 split 会切坏内层
  const inner = multipart('abc.def+1-nested', [
    part(['Content-Type: text/plain; charset=UTF-8'], '前缀 boundary 下的正文'),
  ]);
  const raw = mail(
    ['Content-Type: multipart/mixed; boundary="abc.def+1"'],
    multipart('abc.def+1', [
      part(['Content-Type: multipart/alternative; boundary="abc.def+1-nested"'], inner),
    ], { preamble: '这段 preamble 不是正文', epilogue: '这段 epilogue 也不是正文' }),
  );
  assert.equal(read(raw).text, '前缀 boundary 下的正文');
});

test('MIME：嵌套 part 的 GBK 正文按 part 级 charset 解码', () => {
  const gbk = Buffer.from([0xb2, 0xe2, 0xca, 0xd4]); // 「测试」的 GBK 字节
  const inner = multipart('alt-gbk', [
    part(['Content-Type: text/plain; charset=GBK', 'Content-Transfer-Encoding: base64'], gbk.toString('base64')),
    part(['Content-Type: text/html; charset=GBK'], '<p>HTML 兜底</p>'),
  ]);
  const raw = mail(
    ['From: a@example.com', 'Content-Type: multipart/mixed; boundary="mixed-gbk"'],
    multipart('mixed-gbk', [part(['Content-Type: multipart/alternative; boundary="alt-gbk"'], inner)]),
  );
  assert.equal(read(raw).text, '测试');
});

test('MIME：嵌套 part 的 quoted-printable 软换行 / =XX 还原', () => {
  const inner = multipart('alt-qp', [
    part(['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable'], 'Hello=20world=0Asecond=20line'),
  ]);
  const raw = mail(
    ['From: a@example.com', 'Content-Type: multipart/mixed; boundary="mixed-qp"'],
    multipart('mixed-qp', [part(['Content-Type: multipart/alternative; boundary="alt-qp"'], inner)]),
  );
  assert.equal(read(raw).text, 'Hello world\nsecond line');
});

test('MIME：嵌套里 text/plain 为空时回退 text/html', () => {
  const inner = multipart('alt-empty', [
    part(['Content-Type: text/plain; charset=UTF-8'], ''),
    part(['Content-Type: text/html; charset=UTF-8'], '<p>只有 HTML 的内容</p>'),
  ]);
  const raw = mail(
    ['From: a@example.com', 'Content-Type: multipart/mixed; boundary="mixed-empty"'],
    multipart('mixed-empty', [part(['Content-Type: multipart/alternative; boundary="alt-empty"'], inner)]),
  );
  assert.equal(read(raw).text, '只有 HTML 的内容');
});

test('MIME：inline 的 part 即使文件名含 attachment 也不能被跳过', () => {
  const raw = mail(
    ['From: a@example.com', 'Content-Type: multipart/mixed; boundary="m"'],
    multipart('m', [
      part(['Content-Type: text/plain; charset=UTF-8', 'Content-Disposition: inline; filename="attachment-notes.txt"'], '内联正文'),
      part(['Content-Type: application/pdf', 'Content-Disposition: attachment; filename="file.pdf"'], '%PDF'),
    ]),
  );
  const m = read(raw);
  assert.equal(m.text, '内联正文');
  assert.deepEqual(m.attachments, ['file.pdf']);
});

test('MIME：无 Content-Type 的 part 按 RFC 2045 默认 text/plain', () => {
  const raw = mail(
    ['From: a@example.com', 'Content-Type: multipart/mixed; boundary="m"'],
    multipart('m', [part(['Content-Transfer-Encoding: 8bit'], '没有 Content-Type 也算正文')]),
  );
  assert.equal(read(raw).text, '没有 Content-Type 也算正文');
});

test('MIME：附件名支持 encoded-word 与 RFC 2231 两种真实客户端写法', () => {
  const encodedWordName = part(
    ['Content-Type: application/pdf', 'Content-Disposition: attachment; filename="=?UTF-8?B?5oql6KGoLnBkZg==?="'],
    '%PDF',
  );
  const rfc2231Name = part(
    ['Content-Type: application/pdf', `Content-Disposition: attachment; filename*=UTF-8''%E6%8A%A5%E8%A1%A8.pdf`],
    '%PDF',
  );
  const raw = mail(
    ['From: a@example.com', 'Content-Type: multipart/mixed; boundary="m"'],
    multipart('m', [encodedWordName, rfc2231Name]),
  );
  const extracted = extractMail(parse(raw));
  assert.deepEqual(extracted.attachments, ['报表.pdf', '报表.pdf']);
  assert.equal(extracted.text, '[附件] 报表.pdf, 报表.pdf');
});
