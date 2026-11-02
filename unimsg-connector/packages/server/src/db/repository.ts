/**
 * 数据层（仓储模式）。
 *
 * 先用【内存实现】让项目零依赖跑起来；后续接 Postgres 时，
 * 只需新增一个实现同一接口的 PgRepository，在 index.ts 按 config.databaseUrl 切换，
 * 业务代码一行都不用改。
 */
import { UnifiedMessage, TraceEntry, Platform, MsgStatus } from '@unimsg/shared';

export interface DlqEntry {
  platform: Platform;
  payload: unknown;
  reason: string;
  at: string;
}

export interface MessageRepository {
  save(msg: UnifiedMessage): void;
  get(id: string): UnifiedMessage | undefined;
  /** 按 (platform, externalId) 查重，支撑幂等 */
  findByExternal(platform: Platform, externalId: string): UnifiedMessage | undefined;
  list(filter?: { platform?: Platform; status?: MsgStatus }): UnifiedMessage[];
  update(id: string, patch: Partial<UnifiedMessage>): UnifiedMessage | undefined;
  appendTrace(e: TraceEntry): void;
  getLoopLog(traceId: string): TraceEntry[];
  pushDlq(e: DlqEntry): void;
  listDlq(): DlqEntry[];
}

export class InMemoryRepository implements MessageRepository {
  private byId = new Map<string, UnifiedMessage>();
  private byExternal = new Map<string, string>(); // `${platform}:${externalId}` -> traceId
  private traces = new Map<string, TraceEntry[]>();
  private dlq: DlqEntry[] = [];

  save(msg: UnifiedMessage): void {
    this.byId.set(msg.traceId, msg);
    this.byExternal.set(`${msg.platform}:${msg.externalId}`, msg.traceId);
    if (!this.traces.has(msg.traceId)) this.traces.set(msg.traceId, []);
  }

  get(id: string): UnifiedMessage | undefined {
    return this.byId.get(id);
  }

  findByExternal(platform: Platform, externalId: string): UnifiedMessage | undefined {
    const id = this.byExternal.get(`${platform}:${externalId}`);
    return id ? this.byId.get(id) : undefined;
  }

  list(filter?: { platform?: Platform; status?: MsgStatus }): UnifiedMessage[] {
    let items = [...this.byId.values()];
    if (filter?.platform) items = items.filter((i) => i.platform === filter.platform);
    if (filter?.status) items = items.filter((i) => i.status === filter.status);
    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  update(id: string, patch: Partial<UnifiedMessage>): UnifiedMessage | undefined {
    const cur = this.byId.get(id);
    if (!cur) return undefined;
    const next: UnifiedMessage = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.byId.set(id, next);
    return next;
  }

  appendTrace(e: TraceEntry): void {
    const arr = this.traces.get(e.traceId) ?? [];
    arr.push(e);
    this.traces.set(e.traceId, arr);
  }

  getLoopLog(traceId: string): TraceEntry[] {
    return this.traces.get(traceId) ?? [];
  }

  pushDlq(e: DlqEntry): void {
    this.dlq.push(e);
  }

  listDlq(): DlqEntry[] {
    return [...this.dlq];
  }
}
