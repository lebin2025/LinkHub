/**
 * 真实 WebSocket 客户端：对接 packages/server 的 /ws 实时推送。
 *
 * 高可用设计：
 *  - 指数退避 + 随机抖动重连，避免服务端重启瞬间被回连风暴打满；
 *  - 鉴权失败（服务端 1008 关闭）不再重连，直接 offline，避免无意义死循环；
 *  - 超过最大重试次数后进入 offline，由 UI 提示用户；
 *  - close() 为主动关闭，不再重连（与 EmitterRealtime.close 语义一致）。
 *
 * 一致性兜底：重连期间错过的推送，由 AppStore 监听
 * reconnecting/offline → connected 的跃迁后重新拉取列表补齐。
 *
 * 说明：浏览器 WebSocket API 不暴露 ping/pong 帧，应用层心跳需要后端
 * 配套支持（当前后端只下发、不读上行），因此本版本依赖 TCP close
 * 事件触发重连；如需秒级探活，可后续在后端加 ping 帧支持。
 */
import type { RealtimeClient, RealtimeEvent, RealtimeStatus } from './realtime';

export interface WsOptions {
  /** 最大重连次数，超出后进入 offline（默认 8） */
  maxRetries?: number;
  /** 退避基数毫秒（默认 500） */
  baseDelayMs?: number;
  /** 退避上限毫秒（默认 10s） */
  maxDelayMs?: number;
  /** 测试注入用：替换全局 WebSocket 实现 */
  WebSocketImpl?: typeof WebSocket;
}

/** 服务端鉴权失败的关闭码（见 packages/server/src/ws.ts） */
const WS_CLOSE_UNAUTHORIZED = 1008;

export class WsRealtime implements RealtimeClient {
  private listeners = new Set<(event: RealtimeEvent) => void>();
  private statusListeners = new Set<(status: RealtimeStatus) => void>();
  private status: RealtimeStatus = 'reconnecting';

  private ws?: WebSocket;
  private attempts = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly WS: typeof WebSocket;

  constructor(
    private readonly url: string,
    options: WsOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? 8;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 10_000;
    this.WS = options.WebSocketImpl ?? WebSocket;
    this.connect();
  }

  subscribe(listener: (event: RealtimeEvent) => void): () => void {
    this.listeners.add(listener);
    // 已连接时补发一次 connected，语义对齐 EmitterRealtime
    if (this.status === 'connected') listener({ type: 'connected' });
    return () => this.listeners.delete(listener);
  }

  subscribeStatus(listener: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  /** 主动关闭：不再重连，清空订阅（组件卸载/应用销毁时调用） */
  close(): void {
    this.closed = true;
    this.clearTimer();
    this.ws?.close();
    this.listeners.clear();
    this.statusListeners.clear();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new this.WS(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus('connected');
      this.emit({ type: 'connected' });
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.data)) as RealtimeEvent;
        if (parsed && typeof parsed.type === 'string') this.emit(parsed);
      } catch {
        // 无法解析的帧直接忽略，不影响连接
      }
    };

    // 错误统一交给 onclose 处理重连，避免双触发
    ws.onerror = () => {};

    ws.onclose = (ev) => {
      if (this.closed) return;
      if (ev.code === WS_CLOSE_UNAUTHORIZED) {
        // Token 无效：重连无意义，直接离线交给人处理
        this.setStatus('offline');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.attempts >= this.maxRetries) {
      this.setStatus('offline');
      return;
    }
    this.attempts += 1;
    this.setStatus('reconnecting');
    // 指数退避 + 50%~100% 随机抖动
    const backoff = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (this.attempts - 1));
    const jitter = backoff * (0.5 + Math.random() * 0.5);
    this.timer = setTimeout(() => this.connect(), jitter);
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  private emit(event: RealtimeEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
