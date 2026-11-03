/**
 * 实时推送抽象。
 *
 * 页面只订阅事件；Mock 阶段由内存事件总线模拟，
 * 接后端时替换为原生 WebSocket（/ws?token=...）。
 */
import type { UnifiedMessage } from '../types';

export type RealtimeStatus = 'connected' | 'reconnecting' | 'offline';

export interface RealtimeEvent {
  type: 'message.received' | 'message.updated' | 'message.failed' | 'connected';
  data?: UnifiedMessage;
}

export interface RealtimeClient {
  subscribe(listener: (event: RealtimeEvent) => void): () => void;
  subscribeStatus(listener: (status: RealtimeStatus) => void): () => void;
  getStatus(): RealtimeStatus;
  close(): void;
}

/** 可手动 emit 的客户端：Mock 服务用它模拟服务端推送 */
export class EmitterRealtime implements RealtimeClient {
  private listeners = new Set<(event: RealtimeEvent) => void>();
  private statusListeners = new Set<(status: RealtimeStatus) => void>();
  private status: RealtimeStatus = 'connected';

  subscribe(listener: (event: RealtimeEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ type: 'connected' });
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

  setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  emit(event: RealtimeEvent): void {
    this.listeners.forEach((l) => l(event));
  }

  close(): void {
    this.listeners.clear();
    this.statusListeners.clear();
  }
}