/**
 * 回流事件分流：Webhook 同一条入口既要收“新消息”，也要收“状态事件”。
 * 这里把原始回调判定为 status（回流）或 message（新消息）。
 */
export type PlatformEventDecision =
  | { kind: 'status'; traceId?: string; externalId?: string; platformStatus: string }
  | { kind: 'message' };

export function decidePlatformEvent(raw: unknown): PlatformEventDecision {
  const r = raw as Record<string, unknown> | null;
  const ev = (r?.event ?? r?.Event ?? r?.type) as unknown;
  if (ev === 'status' || ev === 'sync' || ev === 'message.status') {
    const traceId = (r?.traceId ?? r?.TraceId) as string | undefined;
    const externalId = (r?.externalId ?? r?.ExternalId) as string | undefined;
    const platformStatus = String(r?.status ?? r?.Status ?? 'synced');
    return { kind: 'status', traceId, externalId, platformStatus };
  }
  return { kind: 'message' };
}
