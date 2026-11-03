/**
 * 前端数据访问契约。
 *
 * 页面与状态层只依赖这一个接口：
 *  - 现在：MockApi（内存数据 + 模拟推送）
 *  - 后续：HttpApi（对接 packages/server 的 REST/WS），页面代码零改动
 */
import type { MsgType, TraceEntry, UnifiedMessage } from '../types';
import type { Platform, MsgStatus } from '../types';

export interface MessageFilter {
  platform?: Platform;
  status?: MsgStatus;
  type?: MsgType;
  keyword?: string;
  onlyReview?: boolean;
}

/** 回复回执：与后端 202 响应同构 */
export interface ReplyAck {
  message: UnifiedMessage;
  taskId: string;
}

export interface AccountInfo {
  platform: Platform;
  configured: boolean;
}

export interface HealthInfo {
  received: number;
  deduped: number;
  sent: number;
  failed: number;
  dlq: number;
}

export interface TraceResult {
  data: UnifiedMessage[];
  log: TraceEntry[];
}

export interface MessageApi {
  list(filter?: MessageFilter): Promise<UnifiedMessage[]>;
  get(id: string): Promise<UnifiedMessage | undefined>;
  reply(id: string, text: string): Promise<ReplyAck>;
  markDone(id: string): Promise<UnifiedMessage>;
  trace(id: string): Promise<TraceResult>;
  accounts(): Promise<AccountInfo[]>;
  health(): Promise<HealthInfo>;
}

/** 演示用能力：仅 Mock 实现，真实后端接入后按钮自动隐藏 */
export interface DemoApi extends MessageApi {
  simulateIncoming(): Promise<UnifiedMessage>;
  armNextSendFailure(): void;
}

export function isDemoApi(api: MessageApi): api is DemoApi {
  return typeof (api as Partial<DemoApi>).simulateIncoming === 'function';
}