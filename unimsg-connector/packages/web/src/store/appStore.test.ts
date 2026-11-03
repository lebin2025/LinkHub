import { describe, expect, it } from 'vitest';
import { AppStore, filterMessages } from './appStore';
import { EmitterRealtime } from '../services/realtime';
import { MockApi } from '../services/mock/mockApi';
import { MsgStatus, Platform } from '../types';

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
});