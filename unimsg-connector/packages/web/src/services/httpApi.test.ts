import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpApi } from './httpApi';
import { MsgStatus, Platform } from '../types';
import type { UnifiedMessage } from '../types';

const BASE = 'http://127.0.0.1:3001';
const TOKEN = 'dev-token';

function message(partial: Partial<UnifiedMessage> = {}): UnifiedMessage {
  return {
    traceId: 't-1',
    platform: Platform.FEISHU,
    externalId: 'e-1',
    sender: { id: 'u1', name: '张三' },
    type: 'text',
    body: 'hello world',
    status: MsgStatus.RECEIVED,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(...responses: Response[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function callArgs(fn: ReturnType<typeof vi.fn>, index = 0): [string, RequestInit] {
  return fn.mock.calls[index] as unknown as [string, RequestInit];
}

afterEach(() => vi.unstubAllGlobals());

describe('HttpApi', () => {
  it('list：解包信封、携带 Bearer 鉴权头、只下发 platform/status', async () => {
    const fn = mockFetch(jsonResponse({ ok: true, data: [message()] }));
    const api = new HttpApi(BASE, TOKEN);

    const list = await api.list({ platform: Platform.FEISHU, status: MsgStatus.RECEIVED, keyword: 'hello' });

    expect(list).toHaveLength(1);
    const [url, init] = callArgs(fn);
    // type/keyword/onlyReview 不下发给后端
    expect(url).toBe(`${BASE}/api/messages?platform=feishu&status=received`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('list：keyword 在本地过滤', async () => {
    const fn = mockFetch(
      jsonResponse({ ok: true, data: [message({ traceId: 'a', body: 'hello' }), message({ traceId: 'b', body: 'bye' })] }),
    );
    const api = new HttpApi(BASE, TOKEN);
    const list = await api.list({ keyword: 'hello' });
    expect(list.map((m) => m.traceId)).toEqual(['a']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('get：404 返回 undefined 而不是抛错', async () => {
    mockFetch(jsonResponse({ ok: false, error: 'not found' }, 404));
    const api = new HttpApi(BASE, TOKEN);
    expect(await api.get('missing')).toBeUndefined();
  });

  it('reply：POST text，解包 202 的 { message, taskId }', async () => {
    const fn = mockFetch(
      jsonResponse({ ok: true, message: message({ status: MsgStatus.REPLIED }), taskId: 't-1' }, 202),
    );
    const api = new HttpApi(BASE, TOKEN);

    const ack = await api.reply('t-1', '收到');

    expect(ack.taskId).toBe('t-1');
    expect(ack.message.status).toBe(MsgStatus.REPLIED);
    const [url, init] = callArgs(fn);
    expect(url).toBe(`${BASE}/api/messages/t-1/reply`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ text: '收到' });
  });

  it('markDone：done 接口无消息体时，自动重取完整消息', async () => {
    const fn = mockFetch(
      jsonResponse({ ok: true }), // POST /done 只回 ok
      jsonResponse({ ok: true, data: message({ done: true }) }), // 重取 GET /messages/:id
    );
    const api = new HttpApi(BASE, TOKEN);

    const updated = await api.markDone('t-1');

    expect(updated.done).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(callArgs(fn, 0)[0]).toBe(`${BASE}/api/messages/t-1/done`);
    expect(callArgs(fn, 1)[0]).toBe(`${BASE}/api/messages/t-1`);
  });

  it('trace：解包 { data, log }', async () => {
    mockFetch(
      jsonResponse({
        ok: true,
        data: [message()],
        log: [{ traceId: 't-1', platform: 'feishu', status: 'received', event: 'received', at: new Date().toISOString() }],
      }),
    );
    const api = new HttpApi(BASE, TOKEN);
    const result = await api.trace('t-1');
    expect(result.data).toHaveLength(1);
    expect(result.log[0]?.event).toBe('received');
  });

  it('health：只保留计数字段，缺省补 0', async () => {
    mockFetch(jsonResponse({ ok: true, ts: '2026-11-03T00:00:00Z', received: 3, deduped: 1, sent: 1 }));
    const api = new HttpApi(BASE, TOKEN);
    const health = await api.health();
    expect(health).toEqual({ received: 3, deduped: 1, sent: 1, failed: 0, dlq: 0 });
  });

  it('health：透传后端 sentMock（模拟发送次数）', async () => {
    mockFetch(
      jsonResponse({ ok: true, received: 3, deduped: 1, sent: 2, sentMock: 1, failed: 0, dlq: 0 }),
    );
    const api = new HttpApi(BASE, TOKEN);
    const health = await api.health();
    expect(health.sent).toBe(2);
    expect(health.sentMock).toBe(1);
  });

  it('accounts：解包四类数据源，保留邮箱嵌套账号与 mode/missing', async () => {
    const fn = mockFetch(
      jsonResponse({
        ok: true,
        data: [
          {
            platform: 'feishu',
            label: '飞书',
            configured: true,
            policy: 'auto',
            mode: 'real',
            canReceive: true,
            canSend: true,
            missing: [],
            warnings: ['未配置 FEISHU_ENCRYPT_KEY：仅支持未加密回调'],
            reason: '凭据齐全，auto → 真实接口',
          },
          {
            platform: 'mail',
            label: '邮箱',
            configured: true,
            policy: 'auto',
            mode: 'real',
            missing: [],
            issues: [{ level: 'warn', message: 'MAIL_WORK_PROVIDER=custom：请确认自定义 host' }],
            accounts: [
              {
                key: 'qq',
                label: 'QQ邮箱',
                address: 'me@qq.com',
                imapHost: 'imap.qq.com',
                smtpHost: 'smtp.qq.com',
                folders: ['INBOX'],
                mode: 'real',
              },
            ],
          },
        ],
      }),
    );
    const api = new HttpApi(BASE, TOKEN);
    const accounts = await api.accounts();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ platform: Platform.FEISHU, mode: 'real', canSend: true });
    // 能力缺口 / 配置问题也要原样透传给账号页
    expect(accounts[0]?.warnings?.[0]).toContain('FEISHU_ENCRYPT_KEY');
    expect(accounts[1]?.issues?.[0]).toMatchObject({ level: 'warn' });
    expect(accounts[1]?.accounts?.[0]).toMatchObject({
      key: 'qq',
      imapHost: 'imap.qq.com',
      folders: ['INBOX'],
    });
  });

  it('401 映射为 ApiError（status=401）', async () => {
    mockFetch(jsonResponse({ ok: false, error: 'unauthorized' }, 401));
    const api = new HttpApi(BASE, 'bad-token');
    await expect(api.list()).rejects.toMatchObject({ name: 'ApiError', status: 401 });
  });

  it('网络异常映射为 ApiError（status=0）', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fn);
    const api = new HttpApi(BASE, TOKEN);
    await expect(api.list()).rejects.toMatchObject({ name: 'ApiError', status: 0 });
  });

  it('请求超时（AbortError）映射为可读的超时提示', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    const fn = vi.fn().mockRejectedValueOnce(abortErr);
    vi.stubGlobal('fetch', fn);
    const api = new HttpApi(BASE, TOKEN);
    await expect(api.list()).rejects.toMatchObject({
      name: 'ApiError',
      message: expect.stringContaining('超时'),
    });
  });
});
