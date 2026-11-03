/**
 * 极简 SMTP 客户端（node:tls 隐式 TLS，直连 465）。
 *
 * 只做 AUTH LOGIN + 投递一封文本邮件；QQ/网易都要求发信地址与登录账号一致，
 * 否则会被判为冒用（550/535），所以 MAIL FROM 固定用账号本身。
 */
import tls from 'node:tls';
import os from 'node:os';
import type { MailAccount } from '../../config';

const TIMEOUT_MS = 20_000;

class SmtpSession {
  private buf = Buffer.alloc(0);
  private waiters: { res: () => void; rej: (e: Error) => void; timer: NodeJS.Timeout }[] = [];

  private constructor(private sock: tls.TLSSocket) {
    sock.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      const ws = this.waiters;
      this.waiters = [];
      for (const w of ws) {
        clearTimeout(w.timer);
        w.res();
      }
    });
    sock.on('error', (e) => this.failAll(e instanceof Error ? e : new Error(String(e))));
    sock.on('close', () => this.failAll(new Error('SMTP 连接已关闭')));
  }

  static connect(account: MailAccount): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const sock = tls.connect(
        { host: account.smtpHost, port: account.smtpPort, servername: account.smtpHost, ALPNProtocols: ['smtp'] },
        () => {
          clearTimeout(timer);
          resolve(new SmtpSession(sock));
        },
      );
      const timer = setTimeout(() => sock.destroy(new Error(`SMTP 连接超时 ${account.smtpHost}:${account.smtpPort}`)), TIMEOUT_MS);
      sock.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
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

  /** 直接写入报文体（结尾的 . 由调用方给出） */
  writeData(chunk: string) {
    this.sock.write(chunk);
  }

  close() {
    this.sock.removeAllListeners('data');
    this.failAll(new Error('SMTP 会话结束'));
    this.sock.end();
    this.sock.destroy();
  }
}

function assert(code: number, text: string, expect: number[]) {
  if (!expect.includes(code)) throw new Error(`SMTP ${code}：${text}`);
}

/** 投递一封邮件，返回服务端成功应答文本 */
export async function sendMail(account: MailAccount, to: string, message: string): Promise<string> {
  const s = await SmtpSession.connect(account);
  try {
    const greet = await s.reply();
    assert(greet.code, greet.text, [220]);
    const hello = await s.send(`EHLO ${os.hostname() || 'localhost'}`);
    assert(hello.code, hello.text, [250]);

    const authStart = await s.send('AUTH LOGIN');
    assert(authStart.code, authStart.text, [334]);
    const userStep = await s.send(Buffer.from(account.address, 'utf8').toString('base64'));
    assert(userStep.code, userStep.text, [334]);
    const passStep = await s.send(Buffer.from(account.authCode, 'utf8').toString('base64'));
    assert(passStep.code, passStep.text, [235]);

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
