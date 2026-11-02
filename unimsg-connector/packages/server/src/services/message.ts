/**
 * 消息中枢：统一消息的业务核心。
 *
 * 职责：
 *  - ingest：接入 + 幂等去重 + OCR/LLM 富化 + WS 推送
 *  - reply：状态机 processing→replied，异步触发回写（结果走 WS）
 *  - markDone：待办完成
 *  - syncStatus / onPlatformEvent：平台状态回流
 *  - getTrace / getLoopLog：全链路回放
 */
import {
  Platform, MsgStatus, UnifiedMessage, PlatformConnector,
} from '@unimsg/shared';
import { MessageRepository } from '../db/repository';
import { LlmService } from './llm';
import { OcrService } from './ocr';
import { RateLimiter } from './rateLimiter';
import { decidePlatformEvent } from './sync';
import { writeTrace } from '../core/loop-log';
import { counters } from '../core/metrics';
import { config } from '../config';

export interface Broadcast {
  (event: { type: string; data?: unknown }): void;
}

export interface IngestResult {
  message: UnifiedMessage;
  duplicate: boolean;
}

export class MessageService {
  constructor(
    private repo: MessageRepository,
    private connectors: Record<Platform, PlatformConnector>,
    private llm: LlmService,
    private ocr: OcrService,
    private limiter: RateLimiter,
    private broadcast: Broadcast,
  ) {}

  // ---------- 接收 ----------
  async ingest(platform: Platform, raw: unknown): Promise<IngestResult> {
    const connector = this.connectors[platform];
    const incoming = connector.receive(raw);

    const existing = this.repo.findByExternal(platform, incoming.externalId);
    if (existing) {
      counters.deduped += 1;
      writeTrace(this.repo, existing, 'redelivered', '平台重复推送，幂等忽略');
      return { message: existing, duplicate: true };
    }

    this.repo.save(incoming);
    counters.received += 1;
    writeTrace(this.repo, incoming, 'received');

    await this.enrich(incoming);

    const saved = this.repo.get(incoming.traceId)!;
    this.broadcast({ type: 'message.received', data: saved });
    return { message: saved, duplicate: false };
  }

  /** OCR + LLM 富化；全部可降级，不阻塞主闭环 */
  private async enrich(msg: UnifiedMessage): Promise<void> {
    const m = this.repo.get(msg.traceId);
    if (!m) return;

    if (m.type === 'image' || m.type === 'file') {
      const r = await this.ocr.recognize(m);
      if (r.ok) {
        if (r.text) m.body = `${m.body ? `${m.body} ` : ''}${r.text}`;
        if (r.confidence < config.ocrThreshold) {
          m.needsReview = true;
          m.body = `${m.body} [待人工确认]`;
          writeTrace(this.repo, m, 'ocr_low_confidence', `confidence=${r.confidence}`);
        } else {
          writeTrace(this.repo, m, 'ocr', `confidence=${r.confidence}`);
        }
      } else {
        m.needsReview = true;
        writeTrace(this.repo, m, 'ocr_failed', r.reason);
      }
    }

    const lr = await this.llm.analyze(m);
    if (lr.ok) {
      m.intent = lr.intent;
      m.replyDraft = lr.replyDraft;
      writeTrace(this.repo, m, 'intent', `${lr.intent}(${lr.confidence})`);
    } else {
      m.intent = '未分类';
      writeTrace(this.repo, m, 'intent_fallback', lr.reason);
    }

    this.repo.update(m.traceId, {
      body: m.body,
      needsReview: m.needsReview,
      intent: m.intent,
      replyDraft: m.replyDraft,
    });
  }

  // ---------- 展示 ----------
  list(filter?: { platform?: Platform; status?: MsgStatus }): UnifiedMessage[] {
    return this.repo.list(filter);
  }

  get(id: string): UnifiedMessage | undefined {
    return this.repo.get(id);
  }

  // ---------- 处理 / 回写 ----------
  async reply(id: string, text: string): Promise<{ message: UnifiedMessage; taskId: string }> {
    const cur = this.repo.get(id);
    if (!cur) throw new Error('message not found');

    let m = this.repo.update(id, { status: MsgStatus.PROCESSING, reply: text })!;
    writeTrace(this.repo, m, 'processing');
    this.broadcast({ type: 'message.updated', data: m });

    m = this.repo.update(id, { status: MsgStatus.REPLIED, reply: text })!;
    writeTrace(this.repo, m, 'replied');
    this.broadcast({ type: 'message.updated', data: m });

    // 异步回写：不阻塞 HTTP 响应，结果经 WS 推送
    void this.processSend(id);
    return { message: m, taskId: id };
  }

  private async processSend(id: string): Promise<void> {
    const cur = this.repo.get(id);
    if (!cur) return;
    const connector = this.connectors[cur.platform];
    const outgoing: UnifiedMessage = { ...cur, body: cur.reply ?? cur.body };

    try {
      await this.limiter.send(cur.platform, () => connector.send(outgoing));

      let m = this.repo.update(id, { status: MsgStatus.SENT })!;
      writeTrace(this.repo, m, 'sent');
      this.broadcast({ type: 'message.updated', data: m });

      m = this.repo.update(id, { status: MsgStatus.SYNCED })!;
      writeTrace(this.repo, m, 'synced');
      this.broadcast({ type: 'message.updated', data: m });
      counters.sent += 1;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const m = this.repo.update(id, { status: MsgStatus.FAILED })!;
      writeTrace(this.repo, m, 'failed', reason);
      this.repo.pushDlq({ platform: cur.platform, payload: outgoing, reason, at: new Date().toISOString() });
      this.broadcast({ type: 'message.failed', data: m });
      counters.failed += 1;
    }
  }

  async markDone(id: string): Promise<void> {
    const m = this.repo.update(id, { done: true });
    if (!m) throw new Error('message not found');
    writeTrace(this.repo, m, 'done');
    this.broadcast({ type: 'message.updated', data: m });
  }

  // ---------- 回流 ----------
  async syncStatus(traceId: string, platformStatus: string): Promise<void> {
    const m = this.repo.get(traceId);
    if (!m) return;
    const valid = Object.values(MsgStatus) as string[];
    const status = (valid.includes(platformStatus) ? platformStatus : MsgStatus.SYNCED) as MsgStatus;
    const u = this.repo.update(traceId, { status })!;
    writeTrace(this.repo, u, 'sync', `platformStatus=${platformStatus}`);
    this.broadcast({ type: 'message.updated', data: u });
  }

  async onPlatformEvent(
    platform: Platform,
    raw: unknown,
  ): Promise<{ applied: boolean; message?: UnifiedMessage; duplicate?: boolean }> {
    const d = decidePlatformEvent(raw);
    if (d.kind === 'status') {
      let target = d.traceId ? this.repo.get(d.traceId) : undefined;
      if (!target && d.externalId) target = this.repo.findByExternal(platform, d.externalId);
      if (!target) return { applied: false };
      await this.syncStatus(target.traceId, d.platformStatus);
      return { applied: true, message: this.repo.get(target.traceId) };
    }
    const r = await this.ingest(platform, raw);
    return { applied: true, message: r.message, duplicate: r.duplicate };
  }

  // ---------- 回放 ----------
  getTrace(traceId: string): UnifiedMessage[] {
    const m = this.repo.get(traceId);
    return m ? [m] : [];
  }

  getLoopLog(traceId: string) {
    return this.repo.getLoopLog(traceId);
  }

  listDlq() {
    return this.repo.listDlq();
  }
}
