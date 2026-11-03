import { EmitterRealtime } from '../services/realtime';
import { MockApi } from '../services/mock/mockApi';
import { HttpApi } from '../services/httpApi';
import { WsRealtime } from '../services/wsRealtime';
import { AppStore } from './appStore';
import type { MessageApi } from '../services/api';
import type { RealtimeClient } from '../services/realtime';

/**
 * 应用级单例 · 唯一装配点。
 *
 * 数据源由环境变量决定（见 .env.example）：
 *  - 未设置 VITE_API_BASE → MockApi + EmitterRealtime（纯前端演示，无需后端）
 *  - 设置了 VITE_API_BASE → HttpApi + WsRealtime（对接 packages/server 真实后端）
 *
 * 页面与 store 只依赖 MessageApi / RealtimeClient 两个接口，切换零改动。
 */
const rawBase = (import.meta.env.VITE_API_BASE ?? '').trim();
const apiToken = import.meta.env.VITE_API_TOKEN ?? 'dev-token';
// 只要配置了 VITE_API_BASE 就接真实后端；'/' 表示前后端同源部署
const useRealBackend = rawBase.length > 0;

/** WS 地址：绝对 http(s) 基址走协议替换；同源部署基于当前 location 推导 */
function buildWsUrl(base: string, token: string): string {
  const query = `?token=${encodeURIComponent(token)}`;
  if (/^https?:\/\//i.test(base)) {
    return `${base.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws${query}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws${query}`;
}

function createServices(): { api: MessageApi; realtime: RealtimeClient } {
  if (useRealBackend) {
    const httpBase = rawBase.replace(/\/+$/, ''); // '' → 相对路径 /api/*（同源）
    const realtime = new WsRealtime(buildWsUrl(rawBase, apiToken));
    return { api: new HttpApi(httpBase, apiToken), realtime };
  }
  const realtime = new EmitterRealtime();
  const api = new MockApi(realtime, {
    latency: 160,
    sendDelay: 600,
    syncDelay: 800,
    enrichDelay: 650,
  });
  return { api, realtime };
}

export const services = createServices();
export const store = new AppStore(services.api, services.realtime);
