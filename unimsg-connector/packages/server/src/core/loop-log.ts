/**
 * 闭环日志：每条消息的每次状态/事件变更都写一条 TraceEntry，
 * 同时打印单行 JSON 日志（便于检索与回放）。
 */
import { UnifiedMessage, TraceEntry } from '@unimsg/shared';
import { MessageRepository } from '../db/repository';

export function writeTrace(
  repo: MessageRepository,
  msg: UnifiedMessage,
  event: string,
  detail?: string,
): TraceEntry {
  const entry: TraceEntry = {
    traceId: msg.traceId,
    platform: msg.platform,
    status: msg.status,
    event,
    detail,
    at: new Date().toISOString(),
  };
  repo.appendTrace(entry);
  console.log(
    JSON.stringify({
      ts: entry.at,
      level: event === 'failed' ? 'error' : 'info',
      traceId: entry.traceId,
      platform: entry.platform,
      status: entry.status,
      event,
      detail,
    }),
  );
  return entry;
}
