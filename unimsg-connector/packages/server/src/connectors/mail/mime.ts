/**
 * 极简 MIME 解析（RFC 822 / 2045）。
 *
 * 邮箱没有 Webhook，只能自己把原始报文取回来解析，所以这里不引第三方库：
 * 头部折叠、encoded-word 中文主题、multipart 分段、base64/quoted-printable
 * 与 GBK 字符集都在这一层收敛成 { from, subject, text }。
 */

const CRLF = '\r\n';

/** 解码 =?UTF-8?B?...?= / =?GBK?Q?...?= 形式的头部字段 */
export function decodeWords(input: string): string {
  return input.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=([ \t]*\r?\n?[ \t]*)?/g,
    (_m, charset: string, enc: string, data: string, gap: string) => {
      const text = decodeOne(charset, enc.toUpperCase(), data);
      // encoded-word 之间的空白是分隔符，不该丢
      return text + (gap && gap.trim() === '' ? ' ' : '');
    },
  );
}

function decodeOne(charset: string, enc: string, data: string): string {
  let bytes: Buffer;
  if (enc === 'B') {
    bytes = Buffer.from(data.replace(/[\r\n\s]/g, ''), 'base64');
  } else {
    bytes = Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'binary');
  }
  return decodeBytes(bytes, charset);
}

function decodeBytes(bytes: Buffer, charset: string): string {
  const cs = (charset || 'utf-8').toLowerCase().replace(/_/g, '-');
  if (cs === 'utf-8' || cs === 'us-ascii' || cs === 'ascii') return bytes.toString('utf8');
  try {
    return new TextDecoder(cs).decode(bytes);
  } catch {
    try {
      return new TextDecoder(cs === 'gb2312' ? 'gbk' : 'utf-8').decode(bytes);
    } catch {
      return bytes.toString('utf8');
    }
  }
}

export interface MailHeaders {
  [name: string]: string; // 同名多行以 ", " 连接
}

export interface RawMail {
  headers: MailHeaders;
  body: Buffer;
}

/** 原始报文 → 头部 + 体（头部按 latin1 读，避免中文 encoded-word 被破坏） */
export function parseMail(raw: Buffer | string): RawMail {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'binary');
  const nl = buf.indexOf('\r\n\r\n');
  const lfOnly = buf.indexOf('\n\n');
  let split = nl;
  if (nl === -1) split = lfOnly;
  else if (lfOnly !== -1 && lfOnly < nl) split = lfOnly;
  if (split === -1) return { headers: {}, body: buf };

  const head = buf.subarray(0, split).toString('latin1');
  const body = buf.subarray(split + (nl !== -1 && split === nl ? 4 : 2));

  const headers: MailHeaders = {};
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return { headers, body };
}

function parseParam(header: string | undefined, key: string): string {
  if (!header) return '';
  const m = header.match(new RegExp(`${key}=("[^"]*"|[^;\\s]*)`, 'i'));
  if (!m) return '';
  return m[1].replace(/^"|"$/g, '');
}

/** base64 / quoted-printable / 7bit-8bit → 文本 */
function transferDecode(body: Buffer, encoding: string, charset: string): string {
  const enc = (encoding || '7bit').toLowerCase().replace(/[\s_-]/g, '');
  if (enc === 'base64') {
    // 先按 ASCII 取出报文里的 base64 文本，去掉换行空白，再解一次
    const cleaned = body.toString('ascii').replace(/[^A-Za-z0-9+/=]/g, '');
    return decodeBytes(Buffer.from(cleaned, 'base64'), charset);
  }
  if (enc === 'quotedprintable') {
    const soft = body.toString('binary').replace(/=\r?\n/g, '');
    return decodeBytes(Buffer.from(soft.replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'binary'), charset);
  }
  return decodeBytes(body, charset);
}

/** 邮件正文：优先 text/plain，退化到 text/html 去标签 */
export function extractText(mail: RawMail): string {
  const ct = mail.headers['content-type'] ?? '';
  const charset = parseParam(ct, 'charset') || 'utf-8';

  if (/multipart\//i.test(ct)) {
    const boundary = parseParam(ct, 'boundary');
    if (boundary) {
      const chunks = mail.body.toString('binary').split(`--${boundary}`);
      const parts = chunks
        .filter((c) => c.length > 0 && !c.startsWith('--'))
        .map((c) => parseMail(Buffer.from(c.replace(/^\r?\n/, '').replace(/\r?\n$/, ''), 'binary')));
      const plain = parts.find((p) => /text\/plain/i.test(p.headers['content-type'] ?? ''));
      const html = parts.find((p) => /text\/html/i.test(p.headers['content-type'] ?? ''));
      const target = plain ?? html;
      if (target) {
        const inner = extractText({ headers: target.headers, body: target.body });
        if (inner.trim()) return /text\/html/i.test(target.headers['content-type'] ?? '') ? htmlToText(inner) : inner;
      }
      // 多段附件邮件：正文为空也照实返回
      const attached = parts.find((p) => /attachment/i.test(p.headers['content-disposition'] ?? ''));
      return attached ? `[附件] ${parseParam(attached.headers['content-disposition'] ?? '', 'filename') || '未命名'}` : '';
    }
  }
  const text = transferDecode(mail.body, mail.headers['content-transfer-encoding'] ?? '', charset);
  return /text\/html/i.test(ct) ? htmlToText(text) : text;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, CRLF + CRLF)
    .trim();
}

/** 解析 "名字 <a@b.com>"，并解码 encoded-word */
export function parseAddress(header: string | undefined): { name: string; address: string } {
  const raw = decodeWords(header ?? '').trim();
  const m = raw.match(/^(.*?)<([^>]+)>/);
  if (m) {
    return { name: m[1].trim().replace(/^"|"$/g, '').trim(), address: m[2].trim().toLowerCase() };
  }
  return { name: '', address: raw.replace(/^"|"$/g, '').trim().toLowerCase() };
}

export interface ParsedMessage {
  messageId: string;
  inReplyTo: string;
  subject: string;
  date: string;
  from: { name: string; address: string };
  to: string;
  text: string;
}

/** 原始报文 → 结构化邮件（连接器 receive 的输入） */
export function readMessage(raw: Buffer | string): ParsedMessage {
  const mail = parseMail(raw);
  return {
    messageId: (mail.headers['message-id'] ?? '').replace(/^<|>$/g, ''),
    inReplyTo: (mail.headers['in-reply-to'] ?? '').replace(/^<|>$/g, ''),
    subject: decodeWords(mail.headers['subject'] ?? '').trim(),
    date: mail.headers['date'] ?? '',
    from: parseAddress(mail.headers['from']),
    to: mail.headers['to'] ?? '',
    text: extractText(mail).replace(/\r\n/g, '\n').trim(),
  };
}

/** 回写报文：主题自动加 Re:，头部带 In-Reply-To 以便原会话串联 */
export function buildMail(from: string, to: string, subject: string, text: string, opts: { inReplyTo?: string; messageId: string }): string {
  const subj = subject.startsWith('Re:') ? subject : `Re: ${subject || '(无主题)'}`;
  const head = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subj)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${opts.messageId}>`,
  ];
  if (opts.inReplyTo) head.push(`In-Reply-To: <${opts.inReplyTo}>`);
  head.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');

  const encoded = Buffer.from(text.replace(/\r?\n/g, CRLF), 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, `$1${CRLF}`)
    .replace(/\r\n$/, '');
  // 头部与正文之间必须留一个空行，结尾单独一行的 . 表示 DATA 结束
  return `${head.join(CRLF)}${CRLF}${CRLF}${encoded}${CRLF}.${CRLF}`;
}

/** 主题里的中文用 encoded-word，纯 ASCII 原样 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}
