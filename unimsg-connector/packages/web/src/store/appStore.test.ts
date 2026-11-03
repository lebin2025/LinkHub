import { describe, expect, it, vi } from 'vitest';
import { AppStore, filterMessages } from './appStore';
import { EmitterRealtime } from '../services/realtime';
import { MockApi } from '../services/mock/mockApi';
import { MsgStatus, Platform } from '../types';
import type { MessageApi } from '../services/api';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore() {
  const realtime = new EmitterRealtime();
  const api = new MockApi(realtime, { latency: 0, sendDelay: 5, syncDelay: 5, enrichDelay: 5 });
  return { store: new AppStore(api, realtime), api, realtime };
}

describe('AppStore', () => {
  it('初始化后加载消息、账号与健康指标', async () => {
    const { store } = makeStore();
    await store.init();
    const state = store.getSnapshot();
    expect(state.loading).toBe(false);
    expect(state.messages.length).toBeGreaterThanOrEqual(12);
    expect(state.accounts).toHaveLength(3);
    expect(state.health?.received).toBeGreaterThan(0);
  });

  it('筛选条件生效且不改变原始消息', () => {
    const { store } = makeStore();
    store.setFilters({ platform: Platform.DINGTALK, keyword: '周报' });
    const state = store.getSnapshot();
    const visible = filterMessages(state.messages, state.filters);
    expect(visible.every((m) => m.platform === Platform.DINGTALK)).toBe(true);
    expect(state.messages.length).toBeGreaterThanOrEqual(visible.length);
  });

  it('实时事件驱动列表更新（不重新拉取列表）', async () => {
    const { store } = makeStore();
    await store.init();
    const before = store.getSnapshot().messages.length;
    await store.simulateIncoming();
    await wait(10);
    expect(store.getSnapshot().messages.length).toBe(before + 1);
  });

  it('回复后状态随实时事件推进', async () => {
    const { store } = makeStore();
    await store.init();
    const target = store.getSnapshot().messages.find((m) => m.status === MsgStatus.RECEIVED);
    expect(target).toBeTruthy();
    await store.reply(target!.traceId, '收到');
    await wait(40);
    const updated = store.getSnapshot().messages.find((m) => m.traceId === target!.traceId);
    expect(updated?.status).toBe(MsgStatus.SYNCED);
  });

  it('标记完成后本地状态同步', async () => {
    const { store } = makeStore();
    await store.init();
    const todo = store.getSnapshot().messages.find((m) => m.type === 'todo' && !m.done);
    expect(todo).toBeTruthy();
    await store.markDone(todo!.traceId);
    const updated = store.getSnapshot().messages.find((m) => m.traceId === todo!.traceId);
    expect(updated?.done).toBe(true);
  });

  it('demoMode 由数据源派生：MockApi 为 true，非演示 API 为 false', async () => {
    const { store: mockStore } = makeStore();
    expect(mockStore.getSnapshot().demoMode).toBe(true);

    const realtime = new EmitterRealtime();
    const httpLikeApi: MessageApi = {
      list: async () => [],
      get: async () => undefined,
      reply: async () => Promise.reject(new Error('unused')),
      markDone: async () => Promise.reject(new Error('unused')),
      trace: async () => ({ data: [], log: [] }),
      accounts: async () => [],
      health: async () => ({ received: 0, deduped: 0, sent: 0, failed: 0, dlq: 0 }),
    };
    const realStore = new AppStore(httpLikeApi, realtime);
    await realStore.init();
    expect(realStore.getSnapshot().demoMode).toBe(false);
  });

  it('连接从 reconnecting 恢复 connected 时自动重拉列表', async () => {
    const { store, api, realtime } = makeStore();
    await store.init();
    const listSpy = vi.spyOn(api, 'list');
    listSpy.mockClear();

    realtime.setStatus('reconnecting');
    realtime.setStatus('connected');
    await wait(10);

    expect(listSpy).toHaveBeenCalled();
  });

  it('202 回执晚于 WS 推送时不会把 synced 状态回退', async () => {
    const { store, api, realtime } = makeStore();
    await store.init();
    const target = store.getSnapshot().messages.find((m) => m.status === MsgStatus.RECEIVED)!;

    // WS 先把状态推进到 synced
    realtime.emit({ type: 'message.updated', data: { ...target, status: MsgStatus.SYNCED } });
    // HTTP 202 后到，只返回 replied 回执且不发事件
    vi.spyOn(api, 'reply').mockResolvedValueOnce({
      message: { ...target, status: MsgStatus.REPLIED, reply: '收到' },
      taskId: target.traceId,
    });

    await store.reply(target.traceId, '收到');

    const cur = store.getSnapshot().messages.find((m) => m.traceId === target.traceId);
    expect(cur?.status).toBe(MsgStatus.SYNCED); // 未被拽回 replied
    expect(cur?.reply).toBe('收到'); // 回复内容仍然落地
  });

  it('dispose 后可再次 init 重新订阅', async () => {
    const { store } = makeStore();
    await store.init();
    expect(store.getSnapshot().initialized).toBe(true);

    store.dispose();
    expect(store.getSnapshot().initialized).toBe(false);

    await store.init();
    expect(store.getSnapshot().initialized).toBe(true);
    expect(store.getSnapshot().messages.length).toBeGreaterThan(0);
  });
});