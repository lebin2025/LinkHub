import { MsgStatus } from '../../types';
import type { UnifiedMessage, TraceEntry } from '../../types';
import type {
  AccountInfo,
  DemoApi,
  HealthInfo,
  MessageFilter,
  ReplyAck,
  TraceResult,
} from '../api';
import { EmitterRealtime } from '../realtime';
import { ACCOUNTS, HEALTH, INCOMING_TEMPLATES, buildTrace, createSeedData } from './fixtures';

export interface MockOptions {
  /** 基础网络延迟（毫秒） */
  latency?: number;
  /** 回复后「已发送」延迟 */
  sendDelay?: number;
  /** 「已发送」后「已同步」延迟 */
  syncDelay?: number;
  /** 新消息到达后 AI 富化延迟 */
  enrichDelay?: number;
}

const DEFAULTS: Required<MockOptions> = {
  latency: 140,
  sendDelay: 600,
  syncDelay: 800,
  enrichDelay: 650,
};

/**
 * Mock 服务：内存实现 MessageApi，并通过 EmitterRealtime 模拟 WS 推送。
 * 行为刻意对齐后端：reply 先同步推进到 replied 并返回回执，sent/synced 异步推送。
 */
export class MockApi implements DemoApi {
  private messages = new Map<string, UnifiedMessage>();
  private traces = new Map<string, TraceEntry[]>();
  private metrics: HealthInfo = { ...HEALTH };
  private options: Required<MockOptions>;
  private seq = 0;
  private incomingSeq = 0;
  private failNextSend = false;

  constructor(private realtime: EmitterRealtime, options: MockOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset(): void {
    const seed = createSeedData();
    this.messages = new Map(seed.messages.map((m) => [m.traceId, m]));
    this.traces = seed.traces;
    this.metrics = { ...HEALTH };
  }

  async list(filter?: MessageFilter): Promise<UnifiedMessage[]> {
    await this.wait();
    let items = [...this.messages.values()];
    if (filter?.platform) items = items.filter((m) => m.platform === filter.platform);
    if (filter?.status) items = items.filter((m) => m.status === filter.status);
    if (filter?.type) items = items.filter((m) => m.type === filter.type);
    if (filter?.onlyReview) items = items.filter((m) => Boolean(m.needsReview));
    if (filter?.keyword) {
      const k = filter.keyword.trim().toLowerCase();
      items = items.filter(
        (m) =>
          m.body.toLowerCase().includes(k) ||
          m.sender.name.toLowerCase().includes(k) ||
          m.traceId.toLowerCase().includes(k) ||
          (m.intent ?? '').toLowerCase().includes(k),
      );
    }
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async get(id: string): Promise<UnifiedMessage | undefined> {
    await this.wait();
    return this.messages.get(id);
  }

  async reply(id: string, text: string): Promise<ReplyAck> {
    const cur = this.messages.get(id);
    if (!cur) throw new Error('message not found');
    await this.wait();

    this.patch(id, { status: MsgStatus.PROCESSING, reply: text }, 'processing');
    const replied = this.patch(id, { status: MsgStatus.REPLIED, reply: text }, 'replied');

    const shouldFail = this.failNextSend;
    this.failNextSend = false;

    // 异步回写：不阻塞调用方，结果通过实时事件推送
    window.setTimeout(() => {
      if (shouldFail) {
        this.metrics.failed += 1;
        this.patch(id, { status: MsgStatus.FAILED }, 'failed', 'platform 500：重试 3 次仍失败，已写入死信队列');
        return;
      }
      this.patch(id, { status: MsgStatus.SENT }, 'sent');
      window.setTimeout(() => {
        this.patch(id, { status: MsgStatus.SYNCED }, 'synced');
        this.metrics.sent += 1;
      }, this.options.syncDelay);
    }, this.options.sendDelay);

    return { message: replied, taskId: id };
  }

  async markDone(id: string): Promise<UnifiedMessage> {
    await this.wait();
    return this.patch(id, { done: true }, 'done');
  }

  async trace(id: string): Promise<TraceResult> {
    await this.wait();
    const message = this.messages.get(id);
    return { data: message ? [message] : [], log: this.traces.get(id) ?? [] };
  }

  async accounts(): Promise<AccountInfo[]> {
    await this.wait();
    return ACCOUNTS.map((a) => ({ ...a }));
  }

  async health(): Promise<HealthInfo> {
    await this.wait();
    return { ...this.metrics };
  }

  /** 模拟平台推来一条新消息 */
  async simulateIncoming(): Promise<UnifiedMessage> {
    const template = INCOMING_TEMPLATES[this.incomingSeq % INCOMING_TEMPLATES.length];
    this.incomingSeq += 1;
    this.seq += 1;

    const now = new Date().toISOString();
    const traceId = `demo-${Date.now().toString(16)}-${String(this.seq).padStart(4, '0')}`;
    const message: UnifiedMessage = {
      traceId,
      platform: template.platform,
      externalId: `demo_ext_${this.seq}`,
      sender: { id: template.senderId, name: template.senderName },
      type: template.type ?? 'text',
      body: template.body,
      status: MsgStatus.RECEIVED,
      createdAt: now,
      updatedAt: now,
    };
    this.messages.set(traceId, message);
    this.traces.set(traceId, buildTrace(message, 0));
    this.metrics.received += 1;
    this.realtime.emit({ type: 'message.received', data: message });

    // 模拟 OCR / LLM 富化：稍后补上意图与草稿
    window.setTimeout(() => {
      const cur = this.messages.get(traceId);
      if (!cur) return;
      const enriched = this.patch(
        traceId,
        {
          intent: template.intent ?? '未分类',
          replyDraft: template.replyDraft,
          needsReview: template.platform === 'wecom' && template.type === 'image' ? true : cur.needsReview,
        },
        'intent',
        `${template.intent ?? '未分类'}(${template.confidence ?? 0.6})`,
      );
      if (template.type === 'image') {
        this.patch(traceId, { needsReview: true }, 'ocr_low_confidence', 'confidence=0.55，已标记待人工确认');
      }
      void enriched;
    }, this.options.enrichDelay);

    return message;
  }

  /** 演示「发送失败 → DLQ」分支 */
  armNextSendFailure(): void {
    this.failNextSend = true;
  }

  private patch(
    id: string,
    patch: Partial<UnifiedMessage>,
    event: string,
    detail?: string,
  ): UnifiedMessage {
    const cur = this.messages.get(id);
    if (!cur) throw new Error(`message not found: ${id}`);
    const next: UnifiedMessage = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.messages.set(id, next);

    const log = this.traces.get(id) ?? [];
    log.push({
      traceId: id,
      platform: next.platform,
      status: next.status,
      event,
      detail,
      at: next.updatedAt,
    });
    this.traces.set(id, log);

    this.realtime.emit({
      type: next.status === MsgStatus.FAILED ? 'message.failed' : 'message.updated',
      data: next,
    });
    return next;
  }

  private wait(): Promise<void> {
    if (this.options.latency <= 0) return Promise.resolve();
    return new Promise((resolve) => window.setTimeout(resolve, this.options.latency));
  }
}