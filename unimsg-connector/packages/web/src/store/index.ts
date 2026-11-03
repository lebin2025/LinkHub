import { EmitterRealtime } from '../services/realtime';
import { MockApi } from '../services/mock/mockApi';
import { AppStore } from './appStore';

/**
 * 应用级单例。
 * 接后端时只改这里：把 MockApi 换成 HttpApi、把 EmitterRealtime 换成 WsRealtime。
 */
const realtime = new EmitterRealtime();
const api = new MockApi(realtime, {
  latency: 160,
  sendDelay: 600,
  syncDelay: 800,
  enrichDelay: 650,
});

export const store = new AppStore(api, realtime);
export const services = { api, realtime };