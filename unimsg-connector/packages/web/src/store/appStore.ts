/**
 * 轻量应用状态：一个可订阅的 store + useSyncExternalStore。
 *
 * 不引入额外状态库：消息列表由实时事件驱动，
 * 筛选在本地完成（后端 filter 接口保持一致，后续可直接切换）。
 */
import { MsgStatus } from '../types';
import type { MsgType, Platform, UnifiedMessage } from '../types';
import type { AccountInfo, HealthInfo, MessageApi } from '../services/api';
import { isDemoApi } from '../services/api';
import type { RealtimeClient, RealtimeStatus } from '../services/realtime';
import { sortMessages } from '../utils/format';

export interface Filters {
  platform?: Platform;
  status?: MsgStatus;
  type?: MsgType;
  keyword: string;
  onlyReview: boolean;
}

export interface AppState {
  messages: UnifiedMessage[];
  loading: boolean;
  error: string | null;
  filters: Filters;
  accounts: AccountInfo[];
  health: HealthInfo | null;
  connection: RealtimeStatus;
  demoMode: boolean;
  initialized: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  platform: undefined,
  status: undefined,
  type: undefined,
  keyword: '',
  onlyReview: false,
};

export function filterMessages(messages: UnifiedMessage[], filters: Filters): UnifiedMessage[] {
  const keyword = filters.keyword.trim().toLowerCase();
  const items = messages.filter((m) => {
    if (filters.platform && m.platform !== filters.platform) return false;
    if (filters.status && m.status !== filters.status) return false;
    if (filters.type && m.type !== filters.type) return false;
    if (filters.onlyReview && !m.needsReview) return false;
    if (keyword) {
      const hit =
        m.body.toLowerCase().includes(keyword) ||
        m.sender.name.toLowerCase().includes(keyword) ||
        m.traceId.toLowerCase().includes(keyword) ||
        (m.intent ?? '').toLowerCase().includes(keyword);
      if (!hit) return false;
    }
    return true;
  });
  return sortMessages(items);
}

export class AppStore {
  private state: AppState = {
    messages: [],
    loading: true,
    error: null,
    filters: { ...DEFAULT_FILTERS },
    accounts: [],
    health: null,
    connection: 'connected',
    demoMode: true,
    initialized: false,
  };

  private listeners = new Set<() => void>();
  private offRealtime?: () => void;
  private offStatus?: () => void;

  constructor(
    private api: MessageApi,
    private realtime: RealtimeClient,
  ) {
    // demoMode 由数据源自动派生：接真实后端后，演示入口与 Mock 标识自动隐藏
    this.state = {
      ...this.state,
      demoMode: isDemoApi(api),
      connection: realtime.getStatus(),
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AppState => this.state;

  async init(): Promise<void> {
    if (this.state.initialized) return;
    this.offStatus = this.realtime.subscribeStatus((connection) => {
      const prev = this.state.connection;
      this.set({ connection });
      // 断线重连成功后静默重拉，补齐重连期间错过的推送（启动首连同理，幂等）
      if (connection === 'connected' && (prev === 'reconnecting' || prev === 'offline')) {
        void this.reload();
      }
    });
    this.offRealtime = this.realtime.subscribe((event) => this.onRealtime(event));
    this.set({ initialized: true });

    try {
      const [messages, accounts, health] = await Promise.all([
        this.api.list(),
        this.api.accounts(),
        this.api.health(),
      ]);
      this.set({ messages, accounts, health, loading: false, error: null });
    } catch (e) {
      this.set({ loading: false, error: e instanceof Error ? e.message : '加载失败' });
    }
  }

  dispose(): void {
    this.offRealtime?.();
    this.offStatus?.();
    this.realtime.close();
    // 可重入：卸载后若再次 init，能重新订阅（配合 init 的 initialized 守卫）
    this.offRealtime = undefined;
    this.offStatus = undefined;
    this.set({ initialized: false });
  }

  setFilters(patch: Partial<Filters>): void {
    this.set({ filters: { ...this.state.filters, ...patch } });
  }

  resetFilters(): void {
    this.set({ filters: { ...DEFAULT_FILTERS } });
  }

  dismissError(): void {
    this.set({ error: null });
  }

  async reply(id: string, text: string): Promise<void> {
    const ack = await this.api.reply(id, text);
    // 202 回执兜底：WS 丢包时也能把回复内容与 replied 状态落地。
    // 只补字段、不把状态往回拽（HTTP 202 可能晚于 WS 的 sent/synced 推送）。
    this.upsertReply(ack.message);
    await this.refreshHealth();
  }

  async markDone(id: string): Promise<void> {
    const updated = await this.api.markDone(id);
    this.upsert(updated);
  }

  getTrace(id: string) {
    return this.api.trace(id);
  }

  async simulateIncoming(): Promise<void> {
    if (!isDemoApi(this.api)) return;
    await this.api.simulateIncoming();
    await this.refreshHealth();
  }

  armFailure(): void {
    if (isDemoApi(this.api)) this.api.armNextSendFailure();
  }

  /** 静默重拉全量数据（空态注入、外部写入后手动对齐用；失败保持现状） */
  async refresh(): Promise<void> {
    await this.reload();
  }

  async refreshHealth(): Promise<void> {
    try {
      this.set({ health: await this.api.health() });
    } catch {
      // 健康指标失败不影响主流程
    }
  }

  /** 静默重拉全量数据（断线重连后的状态兜底；失败则保持现有数据） */
  private async reload(): Promise<void> {
    try {
      const [messages, accounts, health] = await Promise.all([
        this.api.list(),
        this.api.accounts(),
        this.api.health(),
      ]);
      this.set({ messages, accounts, health });
    } catch {
      // 静默失败：保持现有数据，等待下一次实时推送
    }
  }

  private onRealtime(event: { type: string; data?: UnifiedMessage }): void {
    if (!event.data) return;
    if (event.type === 'message.received' || event.type === 'message.updated' || event.type === 'message.failed') {
      this.upsert(event.data);
    }
  }

  /** 合并 202 回执：本地已推进到 sent/synced 时保留本地状态，避免乱序回退 */
  private upsertReply(incoming: UnifiedMessage): void {
    if (!incoming?.traceId) return;
    const cur = this.state.messages.find((m) => m.traceId === incoming.traceId);
    if (!cur) {
      this.upsert(incoming);
      return;
    }
    const keepLocalStatus = cur.status === MsgStatus.SENT || cur.status === MsgStatus.SYNCED;
    this.upsert({
      ...cur,
      reply: incoming.reply ?? cur.reply,
      intent: incoming.intent ?? cur.intent,
      replyDraft: incoming.replyDraft ?? cur.replyDraft,
      updatedAt: incoming.updatedAt ?? cur.updatedAt,
      status: keepLocalStatus ? cur.status : incoming.status,
    });
  }

  private upsert(message: UnifiedMessage): void {
    const exists = this.state.messages.some((m) => m.traceId === message.traceId);
    const messages = exists
      ? this.state.messages.map((m) => (m.traceId === message.traceId ? message : m))
      : [message, ...this.state.messages];
    this.set({ messages });
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
}