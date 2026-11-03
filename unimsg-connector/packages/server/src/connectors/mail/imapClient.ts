/**
 * 极简 IMAP4rev1 客户端（node:tls 直连，不引第三方库）。
 *
 * 只做 LinkHub 需要的一步：登录后按 UID 拉取新邮件原文。
 * 两个坑位写死在这里：
 *  1) 网易/QQ 会拒绝没发 ID 命令的客户端（Unsafe Login），所以登录后补一次 ID；
 *  2) 用 BODY.PEEK[] 取正文，避免把用户邮箱里的信标记成已读。
 */
import tls from 'node:tls';
import type { MailAccount } from '../../config';

const TIMEOUT_MS = 20_000;

export interface ImapMail {
  uid: number;
  raw: Buffer;
}

/** 构造也开放给单测：可用假 socket 投递分片响应，验证读取器不空转 */
export class ImapSession {
  private buf = Buffer.alloc(0);
  private waiters: { res: () => void; rej: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  private tagNo = 0;

  constructor(private sock: tls.TLSSocket) {
    sock.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.flush();
    });
    sock.on('error', (e) => this.failAll(e instanceof Error ? e : new Error(String(e))));
    sock.on('close', () => this.failAll(new Error('IMAP 连接已关闭')));
  }

  static connect(account: MailAccount): Promise<ImapSession> {
    return new Promise((resolve, reject) => {
      const sock = tls.connect(
        { host: account.imapHost, port: account.imapPort, servername: account.imapHost, ALPNProtocols: ['imap'] },
        () => {
          clearTimeout(timer);
          const s = new ImapSession(sock);
          resolve(s);
        },
      );
      const timer = setTimeout(() => {
        sock.destroy(new Error(`IMAP 连接超时 ${account.imapHost}:${account.imapPort}`));
      }, TIMEOUT_MS);
      sock.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
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

  close() {
    this.sock.removeAllListeners('data');
    this.failAll(new Error('IMAP 会话结束'));
    this.sock.end();
    this.sock.destroy();
  }
}

function quote(s: string): string {
  return `"${s.replace(/([\\"])/g, '\\$1')}"`;
}

/** 目录名要拼进 IMAP 命令，先挡掉引号/换行，避免把命令结构写坏 */
function mailboxArg(folder: string): string {
  const f = folder.trim();
  if (!f) return 'INBOX';
  if (/["'\r\n]/.test(f)) throw new Error(`非法邮箱目录名：${f}`);
  return f.toUpperCase() === 'INBOX' ? 'INBOX' : quote(f);
}

/**
 * 拉取指定目录里 UID 大于 sinceUid 的邮件（升序，最多 limit 封）。
 * sinceUid 传 null = 只问最大 UID 立基线，不取任何正文。
 */
export async function fetchNewMails(
  account: MailAccount,
  sinceUid: number | null,
  limit = 20,
  folder = 'INBOX',
): Promise<{ mails: ImapMail[]; maxUid: number; greeting: string }> {
  const s = await ImapSession.connect(account);
  try {
    const greeting = await s.greeting();

    // 网易/QQ 风控：客户端不报身份会被判定为 Unsafe Login。
    // 登录前后各报一次（RFC 2971 允许任意状态发 ID，服务端不支持时返回 BAD，忽略即可）。
    const identify = `ID ("name" "LinkHub" "version" "1.0" "vendor" "unimsg-connector")`;
    await s.command(identify);

    const login = await s.command(`LOGIN ${quote(account.address)} ${quote(account.authCode)}`);
    if (!login.ok) throw new Error(`IMAP 登录失败：${login.text.trim()}`);
    await s.command(identify);

    const select = await s.command(`SELECT ${mailboxArg(folder)}`);
    if (!select.ok) throw new Error(`IMAP 选择目录 ${folder} 失败：${select.text.trim()}`);

    const search = await s.command('UID SEARCH ALL');
    if (!search.ok) throw new Error(`IMAP 检索失败：${search.text.trim()}`);
    const searchLine = search.lines.find((l) => /^\* SEARCH/i.test(l)) ?? '';
    const uids = (searchLine.replace(/^\* SEARCH/i, '').match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);

    const fresh = sinceUid === null ? [] : uids.filter((u) => u > sinceUid).slice(0, limit);
    const mails: ImapMail[] = [];
    for (const uid of fresh) {
      const r = await s.command(`UID FETCH ${uid} BODY.PEEK[]`);
      const raw = r.literals[r.literals.length - 1];
      if (r.ok && raw) mails.push({ uid, raw });
    }

    const maxUid = uids.length > 0 ? uids[uids.length - 1] : (sinceUid ?? 0);
    await s.command('LOGOUT');
    return { mails, maxUid: Math.max(maxUid, sinceUid ?? 0), greeting };
  } finally {
    s.close();
  }
}
