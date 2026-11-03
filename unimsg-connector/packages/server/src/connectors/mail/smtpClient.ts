/**
 * 极简 SMTP 客户端（零依赖，只用 node:tls / node:net）。
 *
 * 两条链路共用同一个会话类 SmtpSession：
 *  - smtpSecure=true：465 端口 tls.connect 隐式 TLS（原有行为，保持不变）；
 *  - smtpSecure=false：先 net.connect 明文连接，EHLO 探测能力 → STARTTLS →
 *    用 tls.connect({ socket }) 在现有连接上升级 TLS → 必须重新 EHLO
 *    （多数服务端在 STARTTLS 之前不允许 AUTH）→ 认证。
 *
 * 认证：EHLO 能力里声明 AUTH PLAIN 时优先 PLAIN（base64(`\0账号\0授权码`)），
 * 否则回退 AUTH LOGIN（QQ/163 老服务器的习惯）。
 *
 * QQ/网易都要求发信地址与登录账号一致，否则会被判为冒用（550/535），
 * 所以 MAIL FROM 固定用账号本身。
 */
import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';
import type { MailAccount } from '../../config';

const TIMEOUT_MS = 20_000;

/** 会话使用的 socket 类型：net.Socket 与 tls.TLSSocket 都满足（单测可传假 socket） */
export type SmtpSocket = net.Socket;

/**
 * 传输层依赖注入（单测用假 socket，绝不真的联网）。
 * 生产代码不传，全部走默认的 node:net / node:tls 实现。
 */
export interface SmtpTransportDeps {
  /** 建立明文 TCP 连接（smtpSecure=false 的第一段） */
  connectPlain?: (account: MailAccount) => Promise<SmtpSocket>;
  /** 建立隐式 TLS 连接（smtpSecure=true） */
  connectTls?: (account: MailAccount) => Promise<SmtpSocket>;
  /** STARTTLS 升级：在已连接的明文 socket 上升级 TLS */
  upgradeTls?: (plain: SmtpSocket, servername: string) => Promise<SmtpSocket>;
}

/** EHLO 应答里解析出的能力（纯函数结果，供认证机制选择与单测使用） */
export interface EhloCapabilities {
  /** 服务端自报的首行（通常是主机名/欢迎语） */
  server: string;
  /** 声明的认证机制（大写，如 ['PLAIN', 'LOGIN']） */
  auth: string[];
  /** 是否声明支持 STARTTLS */
  starttls: boolean;
  /** 去掉状态码后的能力行原文（调试/断言用） */
  lines: string[];
}

/**
 * 解析 EHLO 的多行应答（形如 `250-smtp.qq.com` / `250-AUTH PLAIN LOGIN` / `250 SIZE 1000`）。
 *
 * reply() 已经把多行应答拼成 `\n` 分隔的文本，这里只提取能力：
 *  - 首行是服务端标识；
 *  - `AUTH ...` / 旧式 `AUTH=...` 行里的机制名（大写、去重）；
 *  - 是否存在 `STARTTLS` 行。
 * 容错：传入已剥掉状态码的行也能解析。
 */
export function parseEhloCapabilities(text: string): EhloCapabilities {
  const lines: string[] = [];
  const auth: string[] = [];
  let starttls = false;

  for (const raw of text.split(/\r?\n/)) {
    const stripped = raw.trim().replace(/^\d{3}[ -]/, '').trim();
    if (!stripped) continue;
    lines.push(stripped);

    if (/^STARTTLS\b/i.test(stripped)) starttls = true;

    // 同时兼容 `AUTH PLAIN LOGIN` 与老式 `AUTH=LOGIN PLAIN`
    const m = stripped.match(/^AUTH[= ](.*)$/i);
    if (m) {
      for (const item of m[1].split(/\s+/)) {
        const mech = item.replace(/^AUTH=/i, '').trim().toUpperCase();
        if (mech && !auth.includes(mech)) auth.push(mech);
      }
    }
  }

  return { server: lines[0] ?? '', auth, starttls, lines };
}

/** 选择认证机制：服务端声明 PLAIN 就优先 PLAIN，否则回退原生的 AUTH LOGIN */
export function chooseAuthMechanism(caps: EhloCapabilities | string[]): 'plain' | 'login' {
  const auth = Array.isArray(caps) ? caps : caps.auth;
  return auth.some((m) => m.toUpperCase() === 'PLAIN') ? 'plain' : 'login';
}

/** AUTH PLAIN 的初始应答：base64(`\0账号\0授权码`)，比 AUTH LOGIN 少两个往返 */
export function buildPlainAuthPayload(username: string, password: string): string {
  return Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64');
}

/** EHLO 里报的客户端名：优先本机 hostname（部分服务端会按它做风控） */
function heloName(): string {
  return os.hostname() || 'localhost';
}

/** 取一条应答的首行并去掉状态码（如 `220 smtp.qq.com ESMTP` → `smtp.qq.com ESMTP`） */
function firstReplyLine(text: string): string {
  return (text.split(/\r?\n/)[0] ?? '').replace(/^\d{3}[ -]/, '').trim();
}

/**
 * 一个 SMTP 会话（明文或 TLS 之上）。
 *
 * 构造器对外开放给单测：可以注入假 socket 逐片投递应答；
 * STARTTLS 升级函数也在构造参数里可注入，单测不会真的建 TLS 连接。
 */
export class SmtpSession {
  private buf = Buffer.alloc(0);
  private waiters: { res: () => void; rej: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  private sock: SmtpSocket;
  private tlsActive: boolean;
  private readonly upgradeFn: (plain: SmtpSocket) => Promise<SmtpSocket>;

  constructor(sock: SmtpSocket, opts: { tls?: boolean; upgrade?: (plain: SmtpSocket) => Promise<SmtpSocket> } = {}) {
    this.sock = sock;
    this.tlsActive = opts.tls ?? false;
    this.upgradeFn = opts.upgrade ?? ((plain) => upgradeStartTls(plain, ''));
    this.attach(sock);
  }

  static async connect(account: MailAccount, deps: SmtpTransportDeps = {}): Promise<SmtpSession> {
    if (account.smtpSecure) {
      const sock = await (deps.connectTls ?? dialImplicitTls)(account);
      return new SmtpSession(sock, { tls: true });
    }
    const sock = await (deps.connectPlain ?? dialPlain)(account);
    const upgrade = deps.upgradeTls;
    return new SmtpSession(sock, {
      tls: false,
      upgrade: upgrade
        ? (plain) => upgrade(plain, account.smtpHost)
        : (plain) => upgradeStartTls(plain, account.smtpHost),
    });
  }

  /** 当前会话是否已经跑在 TLS 之上（隐式 TLS 或 STARTTLS 升级成功） */
  get isTls(): boolean {
    return this.tlsActive;
  }

  private attach(sock: SmtpSocket) {
    sock.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.flush();
    });
    sock.on('error', (e: Error) => this.failAll(e instanceof Error ? e : new Error(String(e))));
    sock.on('close', () => this.failAll(new Error('SMTP 连接已关闭')));
  }

  /** 摘掉监听但保留缓冲区：升级 TLS 前必须先让明文 socket 不再消费字节 */
  private detach(sock: SmtpSocket) {
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

  /** 等下一次 data 事件；不能在"缓冲区已有字节"时短路，否则半行会空转饿死事件循环 */
  private waitForData(): Promise<void> {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('SMTP 读取超时')), TIMEOUT_MS);
      this.waiters.push({ res, rej, timer });
    });
  }

  /** 读取完整应答（多行形如 250-xxx / 250 xxx），返回最后一行的状态码与全文 */
  async reply(): Promise<{ code: number; text: string }> {
    let text = '';
    let code = 0;
    for (;;) {
      const line = await this.readCrlfLine();
      text += line;
      const m = line.match(/^(\d{3})([ -])(.*)$/s);
      if (!m) throw new Error(`SMTP 应答格式异常：${line.slice(0, 120)}`);
      code = Number(m[1]);
      if (m[2] === ' ') return { code, text: text.trim() };
      text += '\n';
    }
  }

  private async readCrlfLine(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf('\r\n');
      if (i !== -1) {
        const line = this.buf.subarray(0, i).toString('utf8');
        this.buf = this.buf.subarray(i + 2);
        return line;
      }
      if (this.sock.destroyed) {
        if (this.buf.length === 0) throw new Error('SMTP 连接已关闭');
        const rest = this.buf.toString('utf8');
        this.buf = Buffer.alloc(0);
        return rest;
      }
      await this.waitForData();
    }
  }

  async send(cmd: string): Promise<{ code: number; text: string }> {
    this.sock.write(`${cmd}\r\n`);
    return this.reply();
  }

  /**
   * STARTTLS：先发命令并校验 220，再升级 TLS。
   * 升级时保留缓冲区（服务端可能在 220 之后紧跟着发送字节），只重新挂监听。
   */
  async startTls(): Promise<void> {
    if (this.tlsActive) return;
    const r = await this.send('STARTTLS');
    assert(r.code, r.text, [220]);

    const plain = this.sock;
    this.detach(plain);
    const secure = await this.upgradeFn(plain);
    this.sock = secure;
    this.tlsActive = true;
    this.attach(secure);
  }

  /** 直接写入报文体（结尾的 . 由调用方给出） */
  writeData(chunk: string) {
    this.sock.write(chunk);
  }

  close() {
    this.detach(this.sock);
    this.failAll(new Error('SMTP 会话结束'));
    this.sock.end();
    this.sock.destroy();
  }
}

function assert(code: number, text: string, expect: number[]) {
  if (!expect.includes(code)) throw new Error(`SMTP ${code}：${text}`);
}

// ---------------------------------------------------------------------------
// 默认网络实现（单测永远走注入的假实现，不会走到这里）
// ---------------------------------------------------------------------------

/** smtpSecure=true：465 隐式 TLS 直连（原实现） */
function dialImplicitTls(account: MailAccount): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect(
      { host: account.smtpHost, port: account.smtpPort, servername: account.smtpHost, ALPNProtocols: ['smtp'] },
      () => {
        clearTimeout(timer);
        resolve(sock);
      },
    );
    const timer = setTimeout(() => sock.destroy(new Error(`SMTP 连接超时 ${account.smtpHost}:${account.smtpPort}`)), TIMEOUT_MS);
    sock.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** smtpSecure=false：先建明文 TCP，等 STARTTLS 再升级 */
function dialPlain(account: MailAccount): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: account.smtpHost, port: account.smtpPort });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`SMTP 连接超时 ${account.smtpHost}:${account.smtpPort}`));
    }, TIMEOUT_MS);
    sock.once('connect', () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** 在已连接的明文 socket 上升级 TLS（tls.connect({ socket })），握手成功才返回 */
function upgradeStartTls(plain: SmtpSocket, servername: string): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket: plain, servername, ALPNProtocols: ['smtp'] });
    const timer = setTimeout(() => {
      secure.destroy();
      reject(new Error('SMTP STARTTLS 升级超时'));
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

// ---------------------------------------------------------------------------
// 会话编排：EHLO / STARTTLS / 认证（sendMail 与 verifySmtpAuth 共用）
// ---------------------------------------------------------------------------

/** 完成认证后的会话信息（不含任何投递动作） */
export interface SmtpOpening {
  session: SmtpSession;
  /** 服务端自报的 banner（已去掉 220 状态码） */
  server: string;
  /** 实际用到的认证机制 */
  auth: 'plain' | 'login';
  /** 当前链路是否已加密（隐式 TLS 或 STARTTLS 升级成功） */
  secure: boolean;
  /** 认证前最后一次（STARTTLS 升级后的）EHLO 能力 */
  capabilities: EhloCapabilities;
}

/**
 * 建立连接并完成认证，不做任何投递动作（不写 MAIL FROM / RCPT TO / DATA）。
 * 明文账号（smtpSecure=false）强制走 STARTTLS：服务端不声明 STARTTLS 直接报错，
 * 绝不降级成明文认证。
 */
export async function openSmtpSession(account: MailAccount, deps: SmtpTransportDeps = {}): Promise<SmtpOpening> {
  const session = await SmtpSession.connect(account, deps);
  try {
    const greet = await session.reply();
    assert(greet.code, greet.text, [220]);
    const server = firstReplyLine(greet.text);

    // 明文链路：先 EHLO 探能力，确认服务端确实支持 STARTTLS 再升级
    if (!account.smtpSecure) {
      const probe = await session.send(`EHLO ${heloName()}`);
      assert(probe.code, probe.text, [250]);
      const preCaps = parseEhloCapabilities(probe.text);
      if (!preCaps.starttls) {
        throw new Error(
          `SMTP 服务器 ${account.smtpHost}:${account.smtpPort} 未声明 STARTTLS，无法安全登录（请改用 465 隐式 TLS 端口，或检查 smtpSecure 配置）`,
        );
      }
      await session.startTls();
    }

    // 隐式 TLS 首次 EHLO；STARTTLS 升级后必须重新 EHLO 再认证（协议要求，也是服务端的硬性限制）
    const hello = await session.send(`EHLO ${heloName()}`);
    assert(hello.code, hello.text, [250]);
    const capabilities = parseEhloCapabilities(hello.text);
    const auth = await authenticate(session, account, capabilities);
    return { session, server, auth, secure: session.isTls, capabilities };
  } catch (e) {
    session.close();
    throw e;
  }
}

/** 按服务端能力选择 PLAIN / LOGIN 完成认证 */
async function authenticate(session: SmtpSession, account: MailAccount, caps: EhloCapabilities): Promise<'plain' | 'login'> {
  if (chooseAuthMechanism(caps) === 'plain') {
    const r = await session.send(`AUTH PLAIN ${buildPlainAuthPayload(account.address, account.authCode)}`);
    assert(r.code, r.text, [235]);
    return 'plain';
  }

  // 回退原有 AUTH LOGIN 三步握手（QQ/163 等老服务器）
  const authStart = await session.send('AUTH LOGIN');
  assert(authStart.code, authStart.text, [334]);
  const userStep = await session.send(Buffer.from(account.address, 'utf8').toString('base64'));
  assert(userStep.code, userStep.text, [334]);
  const passStep = await session.send(Buffer.from(account.authCode, 'utf8').toString('base64'));
  assert(passStep.code, passStep.text, [235]);
  return 'login';
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/** 投递一封邮件，返回服务端成功应答文本（deps 仅供单测注入假 socket） */
export async function sendMail(account: MailAccount, to: string, message: string, deps: SmtpTransportDeps = {}): Promise<string> {
  const { session: s } = await openSmtpSession(account, deps);
  try {
    const from = await s.send(`MAIL FROM:<${account.address}>`);
    assert(from.code, from.text, [250]);
    const rcpt = await s.send(`RCPT TO:<${to}>`);
    assert(rcpt.code, rcpt.text, [250, 251]);

    const data = await s.send('DATA');
    assert(data.code, data.text, [354]);

    // 点填充：正文里以单个 . 开头的行要写成 ..
    const escaped = message.replace(/^(\.)/gm, '..');
    s.writeData(escaped.endsWith('\r\n') ? `${escaped}.\r\n` : `${escaped}\r\n.\r\n`);
    const queued = await s.reply();
    assert(queued.code, queued.text, [250]);

    await s.send('QUIT');
    return queued.text;
  } finally {
    s.close();
  }
}

/** 登录自检结果（doctor 直接展示，绝不含授权码） */
export interface SmtpAuthCheck {
  ok: true;
  /** 服务端自报的 banner（已去掉状态码） */
  server: string;
  /** 实际用到的认证机制：PLAIN 优先、否则 LOGIN */
  auth: 'plain' | 'login';
  /** 登录链路是否已加密（隐式 TLS 或 STARTTLS 升级成功） */
  secure: boolean;
}

/**
 * 邮箱 SMTP 登录自检（doctor 用）：真的连接 + EHLO + （必要时）STARTTLS + 认证，最后 QUIT。
 * 只验证“这个账号能不能登录发信服务器”，绝不投递——不会发 MAIL FROM / RCPT TO / DATA。
 * 连接、握手或认证失败时抛出带 SMTP 码的 Error（如 `SMTP 535：...`），便于医生直接展示原因。
 *
 * 第二个参数仅供单测注入假 socket；生产调用只需传 account。
 */
export async function verifySmtpAuth(account: MailAccount, deps: SmtpTransportDeps = {}): Promise<SmtpAuthCheck> {
  const opened = await openSmtpSession(account, deps);
  try {
    try {
      await opened.session.send('QUIT');
    } catch {
      // 认证已经成功，个别服务端收到 QUIT 就直接断开、不回 221，不影响自检结论
    }
    return { ok: true, server: opened.server, auth: opened.auth, secure: opened.secure };
  } finally {
    opened.session.close();
  }
}
