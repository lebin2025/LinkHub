import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsRealtime } from './wsRealtime';
import type { RealtimeEvent } from './realtime';

/** 注入用假 WebSocket：手动触发 open/message/close */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  // ---- 测试辅助：模拟服务端行为 ----
  open(): void {
    this.onopen?.();
  }
  message(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  rawMessage(data: string): void {
    this.onmessage?.({ data });
  }
  serverClose(code = 1006): void {
    this.onclose?.({ code });
  }
}

function create(options: { maxRetries?: number } = {}) {
  return new WsRealtime('ws://127.0.0.1:3001/ws?token=dev-token', {
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    maxRetries: options.maxRetries ?? 2,
    baseDelayMs: 100,
    maxDelayMs: 400,
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WsRealtime', () => {
  it('连接成功后进入 connected，并解析分发事件（忽略坏帧）', () => {
    const rt = create();
    const events: RealtimeEvent[] = [];
    rt.subscribe((e) => events.push(e));

    expect(rt.getStatus()).toBe('reconnecting');
    FakeWebSocket.instances[0].open();
    expect(rt.getStatus()).toBe('connected');

    FakeWebSocket.instances[0].message({ type: 'message.received', data: { traceId: 't-1' } });
    FakeWebSocket.instances[0].rawMessage('not-json');

    expect(events.map((e) => e.type)).toEqual(['connected', 'message.received']);
    rt.close();
  });

  it('断开后退避重连，恢复后回到 connected', () => {
    const rt = create();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].serverClose();

    expect(rt.getStatus()).toBe('reconnecting');
    vi.advanceTimersByTime(1000); // 覆盖 100ms * 1.5 抖动
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].open();
    expect(rt.getStatus()).toBe('connected');
    rt.close();
  });

  it('超过最大重试次数后进入 offline，不再重连', () => {
    const rt = create({ maxRetries: 2 });
    FakeWebSocket.instances[0].open();

    FakeWebSocket.instances[0].serverClose();
    vi.advanceTimersByTime(1000);
    FakeWebSocket.instances[1].serverClose();
    vi.advanceTimersByTime(1000);
    FakeWebSocket.instances[2].serverClose();

    expect(rt.getStatus()).toBe('offline');
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    rt.close();
  });

  it('鉴权失败（1008）直接 offline，不做无意义重连', () => {
    const rt = create();
    FakeWebSocket.instances[0].serverClose(1008);

    expect(rt.getStatus()).toBe('offline');
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    rt.close();
  });

  it('主动 close 后不再重连', () => {
    const rt = create();
    FakeWebSocket.instances[0].open();
    rt.close();
    FakeWebSocket.instances[0].serverClose();

    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
