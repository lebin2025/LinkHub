/**
 * 极简 IMAP4rev1 客户端（零依赖，只用 node:tls / node:net，不引第三方库）。
 *
 * 只做 LinkHub 需要的一步：登录后按 UID 拉取新邮件原文。
 * 两个坑位写死在这里：
 *  1) 网易/QQ 会拒绝没发 ID 命令的客户端（Unsafe Login），所以登录后补一次 ID；
 *  2) 用 BODY.PEEK[] 取正文，避免把用户邮箱里的信标记成已读。
 *
 * 两条链路：
 *  - imapSecure=true：993 端口 tls.connect 隐式 TLS（原有行为）；
 *  - imapSecure=false：143 明文 net.connect → 读 greeting → STARTTLS → 用
 *    tls.connect({ socket }) 在现有连接上升级 TLS（保留已缓冲字节、重新挂监听）→
 *    之后照旧 ID / LOGIN / SELECT。
 */
import net from 'node:net';
import tls from 'node:tls';
import type { MailAccount } from '../../config';

const TIMEOUT_MS = 20_000;

export interface ImapMail {
  uid: number;
  raw: Buffer;
}

/**
 * 单测注入点（生产代码不传）：
 *  - upgrade：把明文 socket 升级成 TLS socket 的假实现，避免单测真的建 TLS 连接；
 *  - servername：SNI 主机名，connect() 会自动填 account.imapHost。
 */
export interface ImapSessionOptions {
  upgrade?: (plain: net.Socket) => Promise<net.Socket>;
  servername?: string;
}

/** 构造也开放给单测：可用假 socket 投递分片响应，验证读取器不空转 */
export class ImapSession {
  private buf = Buffer.alloc(0);
  private waiters: { res: () => void; rej: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  private tagNo = 0;
  private sock: net.Socket;
  private tlsActive = false;
  private readonly upgradeFn: (plain: net.Socket) => Promise<net.Socket>;

  constructor(sock: net.Socket, opts: ImapSessionOptions = {}) {
    this.sock = sock;
    const upgrade = opts.upgrade;
    this.upgradeFn = upgrade ?? ((plain) => upgradeStartTls(plain, opts.servername ?? ''));
    this.attach(sock);
  }

  static connect(account: MailAccount, opts: ImapSessionOptions = {}): Promise<ImapSession> {
    return new Promise((resolve, reject) => {
      const timeoutMsg = `IMAP 连接超时 ${account.imapHost}:${account.imapPort}`;
      if (account.imapSecure) {
        const sock = tls.connect(
          { host: account.imapHost, port: account.imapPort, servername: account.imapHost, ALPNProtocols: ['imap'] },
          () => {
            clearTimeout(timer);
            resolve(new ImapSession(sock, { ...opts, servername: account.imapHost }));
          },
        );
        const timer = setTimeout(() => sock.destroy(new Error(timeoutMsg)), TIMEOUT_MS);
        sock.once('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        return;
      }

      // 明文 143：先建 TCP，greeting 之后由 fetchNewMails 调 startTls() 升级
      const sock = net.connect({ host: account.imapHost, port: account.imapPort }, () => {
        clearTimeout(timer);
        resolve(new ImapSession(sock, { ...opts, servername: account.imapHost }));
      });
      const timer = setTimeout(() => sock.destroy(new Error(timeoutMsg)), TIMEOUT_MS);
      sock.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  /** 当前会话是否已经跑在 TLS 之上（隐式 TLS 或 STARTTLS 升级成功） */
  get isTls(): boolean {
    return this.tlsActive;
  }

  private attach(sock: net.Socket) {
    sock.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.flush();
    });
    sock.on('error', (e: Error) => this.failAll(e instanceof Error ? e : new Error(String(e))));
    sock.on('close', () => this.failAll(new Error('IMAP 连接已关闭')));
  }

  /** 摘掉监听但保留缓冲区：升级 TLS 前必须先让明文 socket 不再消费字节 */
  private detach(sock: net.Socket) {
    sock.removeAllListeners('data');
    sock.removeAllListeners('error');
    sock.removeAllListeners('close');
  }

  private flush() {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) {
      clearTimeout(w.timer);
      w.res();
    }
  }

  private failAll(e: Error) {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) {
      clearTimeout(w.timer);
      w.rej(e);
    }
  }

  /** 等下一次 data 事件；绝不能在"缓冲区已有字节"时短路，否则半行会空转饿死事件循环 */
  private waitForData(): Promise<void> {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('IMAP 读取超时')), TIMEOUT_MS);
      this.waiters.push({ res, rej, timer });
    });
  }

  /** 读取一行（不含 CRLF） */
  private async readLine(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf('\r\n');
      if (i !== -1) {
        const line = this.buf.subarray(0, i).toString('utf8');
        this.buf = this.buf.subarray(i + 2);
        return line;
      }
      const bare = this.buf.indexOf('\n');
      if (bare !== -1) {
        const line = this.buf.subarray(0, bare).toString('utf8');
        this.buf = this.buf.subarray(bare + 1);
        return line;
      }
      if (this.sock.destroyed) {
        if (this.buf.length === 0) throw new Error('IMAP 连接已关闭');
        const rest = this.buf.toString('utf8');
        this.buf = Buffer.alloc(0);
        return rest;
      }
      await this.waitForData();
    }
  }

  private async readBytes(n: number): Promise<Buffer> {
    while (this.buf.length < n) {
      if (this.sock.destroyed) throw new Error('IMAP 连接已关闭');
      await this.waitForData();
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  /** 发送一条命令，收集到带同 tag 的完成行为止；literal 单独收集 */
  async command(args: string): Promise<{ ok: boolean; lines: string[]; literals: Buffer[]; text: string }> {
    const tag = `a${(this.tagNo += 1)}`;
    const lines: string[] = [];
    const literals: Buffer[] = [];
    let text = '';
    this.sock.write(`${tag} ${args}\r\n`);
    for (;;) {
      const line = await this.readLine();
      if (!line) continue;
      const lit = line.match(/\{(\d+)\}$/);
      if (lit) {
        literals.push(await this.readBytes(Number(lit[1])));
        lines.push(line);
        continue;
      }
      if (line.startsWith(`${tag} `)) {
        const status = line.slice(tag.length + 1);
        text = status;
        return { ok: /^OK/i.test(status), lines, literals, text };
      }
      lines.push(line);
    }
  }

  async greeting(): Promise<string> {
    return this.readLine();
  }

  /**
   * 明文连接升级 TLS（STARTTLS）：
   *  1) 先发 `STARTTLS` 并校验 OK 应答；
   *  2) 摘掉明文 socket 监听后升级（保留缓冲区与 tag 计数，绝不再造一个新会话）；
   *  3) 在 TLS socket 上重新挂 data/error/close 监听，后续命令自然走加密链路。
   */
  async startTls(): Promise<void> {
    if (this.tlsActive) return;
    const r = await this.command('STARTTLS');
    if (!r.ok) throw new Error(`IMAP STARTTLS 失败：${r.text.trim()}`);

    const plain = this.sock;
    this.detach(plain);
    const secure = await this.upgradeFn(plain);
    this.sock = secure;
    this.tlsActive = true;
    this.attach(secure);
  }

  close() {
    this.detach(this.sock);
    this.failAll(new Error('IMAP 会话结束'));
    this.sock.end();
    this.sock.destroy();
  }
}

/** 在已连接的明文 socket 上升级 TLS（tls.connect({ socket })），握手成功才返回 */
function upgradeStartTls(plain: net.Socket, servername: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket: plain, servername, ALPNProtocols: ['imap'] });
    const timer = setTimeout(() => {
      secure.destroy();
      reject(new Error('IMAP STARTTLS 升级超时'));
    }, TIMEOUT_MS);
    const onError = (e: Error) => {
      clearTimeout(timer);
      reject(e);
    };
    secure.once('error', onError);
    secure.once('secureConnect', () => {
      clearTimeout(timer);
      secure.removeListener('error', onError);
      resolve(secure);
    });
  });
}

function quote(s: string): string {
  return `"${s.replace(/([\\"])/g, '\\$1')}"`;
}

/** modified BASE64 字母表（RFC 3501 用 ',' 替代标准 base64 的 '/'） */
const MODIFIED_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+,';

/** 把一段非 ASCII 字符按 UTF-16BE + modified BASE64 包进 &...- */
function encodeModifiedUtf7Run(run: string): string {
  if (!run) return '';
  const le = Buffer.from(run, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i + 1 < le.length; i += 2) {
    be[i] = le[i + 1];
    be[i + 1] = le[i];
  }
  let out = '';
  for (let i = 0; i < be.length; i += 3) {
    const b0 = be[i];
    const b1 = i + 1 < be.length ? be[i + 1] : 0;
    const b2 = i + 2 < be.length ? be[i + 2] : 0;
    out += MODIFIED_B64[b0 >> 2];
    out += MODIFIED_B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < be.length) out += MODIFIED_B64[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < be.length) out += MODIFIED_B64[b2 & 0x3f];
  }
  return `&${out}-`;
}

/**
 * RFC 3501 modified UTF-7 编码（IMAP 目录名 / mailbox name）。
 *
 * 只用于「把配置里的 UTF-8 目录名写进 SELECT 命令」；LIST 回读解码未实现。
 *  - 可打印 ASCII（0x20-0x7e，除 &）原样输出；
 *  - ASCII 的 & 编码成 &-（否则会被当成 &...- 序列的开头）；
 *  - 其余字符（中文/日文/emoji…）连续段按 UTF-16BE + modified BASE64 编码。
 *
 * 例：`~peter/mail/台北/日本語` → `~peter/mail/&U,BTFw-/&ZeVnLIqe-`
 */
export function encodeMailboxName(folder: string): string {
  let out = '';
  let pending = '';
  const flush = () => {
    if (pending) {
      out += encodeModifiedUtf7Run(pending);
      pending = '';
    }
  };
  for (const ch of folder) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '&') {
      flush();
      out += '&-';
    } else if (cp >= 0x20 && cp <= 0x7e) {
      flush();
      out += ch;
    } else {
      pending += ch;
    }
  }
  flush();
  return out;
}

/** 目录名要拼进 IMAP 命令：非 ASCII 先转 modified UTF-7，再挡掉引号/换行避免写坏命令结构 */
export function mailboxArg(folder: string): string {
  const f = folder.trim();
  if (!f) return 'INBOX';
  if (/["'\r\n]/.test(f)) throw new Error(`非法邮箱目录名：${f}`);
  return f.toUpperCase() === 'INBOX' ? 'INBOX' : quote(encodeMailboxName(f));
}

/** 单测注入点：默认走 ImapSession.connect，生产代码不传 */
export interface FetchNewMailsOptions {
  connect?: (account: MailAccount) => Promise<ImapSession>;
}

/**
 * 拉取指定目录里 UID 大于 sinceUid 的邮件（升序，最多 limit 封）。
 * sinceUid 传 null = 只问最大 UID 立基线，不取任何正文。
 * 个别邮件取信失败不会整轮失败，而是放进 failedUids，让调用方把水位停在缺口前重试。
 * uidValidity 来自 SELECT 的 `* OK [UIDVALIDITY xxx]`：目录被清空/重建时它会变，调用方据此重置水位。
 */
export async function fetchNewMails(
  account: MailAccount,
  sinceUid: number | null,
  limit = 20,
  folder = 'INBOX',
  opts: FetchNewMailsOptions = {},
): Promise<{ mails: ImapMail[]; maxUid: number; greeting: string; failedUids?: number[]; uidValidity?: number }> {
  const s = await (opts.connect ? opts.connect(account) : ImapSession.connect(account));
  try {
    const greeting = await s.greeting();

    // 明文 143：greeting 之后立刻 STARTTLS 升级，然后才允许 ID / LOGIN（993 隐式 TLS 已是加密链路）
    if (!account.imapSecure) await s.startTls();

    // 网易/QQ 风控：客户端不报身份会被判定为 Unsafe Login。
    // 登录前后各报一次（RFC 2971 允许任意状态发 ID，服务端不支持时返回 BAD，忽略即可）。
    const identify = `ID ("name" "LinkHub" "version" "1.0" "vendor" "unimsg-connector")`;
    await s.command(identify);

    const login = await s.command(`LOGIN ${quote(account.address)} ${quote(account.authCode)}`);
    if (!login.ok) throw new Error(`IMAP 登录失败：${login.text.trim()}`);
    await s.command(identify);

    const select = await s.command(`SELECT ${mailboxArg(folder)}`);
    if (!select.ok) throw new Error(`IMAP 选择目录 ${folder} 失败：${select.text.trim()}`);
    // SELECT 应答里的 UIDVALIDITY：目录被清空/重建后会变化，是 UID 水位能否继续沿用的唯一依据
    const uidValidityMatch = select.lines.join('\n').match(/\[UIDVALIDITY\s+(\d+)\]/i);
    const uidValidity = uidValidityMatch ? Number(uidValidityMatch[1]) : undefined;

    const search = await s.command('UID SEARCH ALL');
    if (!search.ok) throw new Error(`IMAP 检索失败：${search.text.trim()}`);
    const searchLine = search.lines.find((l) => /^\* SEARCH/i.test(l)) ?? '';
    const uids = (searchLine.replace(/^\* SEARCH/i, '').match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);

    const fresh = sinceUid === null ? [] : uids.filter((u) => u > sinceUid).slice(0, limit);
    const mails: ImapMail[] = [];
    const failedUids: number[] = [];
    for (const uid of fresh) {
      const r = await s.command(`UID FETCH ${uid} BODY.PEEK[]`);
      const raw = r.literals[r.literals.length - 1];
      if (r.ok && raw) mails.push({ uid, raw });
      else failedUids.push(uid);
    }

    const maxUid = uids.length > 0 ? uids[uids.length - 1] : (sinceUid ?? 0);
    await s.command('LOGOUT');
    const result: {
      mails: ImapMail[];
      maxUid: number;
      greeting: string;
      failedUids?: number[];
      uidValidity?: number;
    } = {
      mails,
      maxUid: Math.max(maxUid, sinceUid ?? 0),
      greeting,
    };
    if (failedUids.length > 0) result.failedUids = failedUids;
    if (uidValidity !== undefined) result.uidValidity = uidValidity;
    return result;
  } finally {
    s.close();
  }
}
