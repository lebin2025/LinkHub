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

/**
 * 无效平台事件（空 body、空对象、解析后缺消息 ID 等）。
 *
 * 单独一个错误类型，是为了让路由层能把「用户/平台推来的畸形事件」回 400，
 * 而真正的服务端故障仍回 500；抛出点位于写 trace 与幂等表之前，
 * 保证这类事件绝不会污染去重键（旧实现的空 `{}` 会占住 externalId='unknown' 永久去重）。
 */
export class InvalidPlatformEvent extends Error {
  readonly platform: Platform;
  readonly reason: string;

  constructor(platform: Platform, reason: string) {
    super(`无效的平台事件（${platform}）：${reason}`);
    this.name = 'InvalidPlatformEvent';
    this.platform = platform;
    this.reason = reason;
  }
}

/** 值是否「没有内容」：空串 / 空数组 / null，或所有字段都为空的普通对象（如空 XML 壳解析出的 { xml: '' }） */
function isEmptyEventValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isEmptyEventValue);
  }
  return false; // number / boolean 等标量视为有内容
}

/** 事件体是否「明显为空」：空对象 / 空数组 / 空白字符串 / 标量。这种推送不可能承载消息或状态回流。 */
export function isEmptyPlatformEvent(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'string') return raw.trim().length === 0;
  if (typeof raw !== 'object') return true; // number / boolean / bigint 等标量不是合法平台事件
  return isEmptyEventValue(raw);
}

/** 闭环状态推进序（failed 是失败旁路，不参与排序） */
const STATUS_RANK: Record<string, number> = {
  [MsgStatus.RECEIVED]: 0,
  [MsgStatus.PROCESSING]: 1,
  [MsgStatus.REPLIED]: 2,
  [MsgStatus.SENT]: 3,
  [MsgStatus.SYNCED]: 4,
};

export interface StatusTransitionDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * 回流状态是否允许落到消息上（防止「后到的旧 status」把进度打回去）：
 *  - 正常状态只允许前进：received→processing→replied→sent→synced；
 *  - failed 是失败旁路：允许作为重试起点进入任何正常状态（如 failed→sent）；
 *  - 同状态、倒退、以及从正常状态回到 failed 一律忽略。
 */
export function checkStatusTransition(current: MsgStatus, next: MsgStatus): StatusTransitionDecision {
  if (current === next) return { allowed: false, reason: `状态未变化（${current}），忽略重复回流` };
  const curRank = STATUS_RANK[current];
  const nextRank = STATUS_RANK[next];
  if (curRank === undefined) {
    if (current === MsgStatus.FAILED) return { allowed: true };
    return { allowed: false, reason: `当前状态 ${current} 不在状态机内，忽略` };
  }
  if (nextRank === undefined) {
    return { allowed: false, reason: `${current}→${next} 不是前进方向（仅允许 received→processing→replied→sent→synced）` };
  }
  if (nextRank <= curRank) {
    return { allowed: false, reason: `${current}→${next} 属于状态倒退（顺序 received<processing<replied<sent<synced）` };
  }
  return { allowed: true };
}

export interface SyncStatusResult {
  /** 是否真的把状态写进了消息（false = 被防倒退规则忽略） */
  applied: boolean;
  message?: UnifiedMessage;
  reason?: string;
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
    // 入参守卫（P0）：空 body / 空对象必须在 receive、写 trace、写幂等表之前拒绝。
    // 旧实现里 mock 验签会放行 `{}`，receive 兜底出 externalId='unknown'，
    // 首条空事件就会永久占住去重键，后续真实消息也进不来。
    if (isEmptyPlatformEvent(raw)) {
      throw new InvalidPlatformEvent(platform, '事件体为空（空对象/空数组/空白字符串），未写入任何记录');
    }

    const connector = this.connectors[platform];
    const incoming = connector.receive(raw);

    // 平台侧唯一 ID 是幂等键的唯一来源：缺失/兜底成 'unknown' 时必须拒收，
    // 否则多条不同消息会互相去重（或占死 unknown 键）。
    const externalId = typeof incoming.externalId === 'string' ? incoming.externalId.trim() : '';
    if (!externalId || externalId === 'unknown') {
      throw new InvalidPlatformEvent(platform, '解析后缺少消息唯一 ID（externalId），未写入任何记录');
    }
    incoming.externalId = externalId;

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
      const result = await this.limiter.send(cur.platform, () => connector.send(outgoing));
      const at = new Date().toISOString();

      // 把"本次到底走了真实接口还是本地模拟"写进消息与闭环日志，绝不静默假装成功
      let m = this.repo.update(id, {
        status: MsgStatus.SENT,
        delivery: { mode: result.mode, platformReply: result.platformReply, at },
      })!;
      writeTrace(
        this.repo,
        m,
        'sent',
        result.mode === 'mock'
          ? '模拟发送（本地 Mock，未调用真实平台接口）'
          : `真实接口${result.platformReply ? ` · ${result.platformReply}` : ''}`,
      );
      this.broadcast({ type: 'message.updated', data: m });

      m = this.repo.update(id, { status: MsgStatus.SYNCED })!;
      writeTrace(
        this.repo,
        m,
        'synced',
        result.mode === 'mock' ? '模拟状态回流（本地 Mock）' : '平台状态回流',
      );
      this.broadcast({ type: 'message.updated', data: m });
      counters.sent += 1;
      if (result.mode === 'mock') counters.sentMock += 1;
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
  /**
   * 平台状态回流。接口永远成功返回（路由照常 200），但只有「前进」才改状态：
   * 倒退/重复请求写 trace `sync_ignored` 并保留原状态，避免旧回调把已完成的消息打回 received。
   */
  async syncStatus(traceId: string, platformStatus: string): Promise<SyncStatusResult> {
    const m = this.repo.get(traceId);
    if (!m) return { applied: false, reason: '消息不存在，忽略回流' };

    const valid = Object.values(MsgStatus) as string[];
    // 未知平台状态沿用旧行为兜底为 synced（平台回调字段不稳定，不算畸形事件）
    const status = (valid.includes(platformStatus) ? platformStatus : MsgStatus.SYNCED) as MsgStatus;

    const decision = checkStatusTransition(m.status, status);
    if (!decision.allowed) {
      writeTrace(
        this.repo,
        m,
        'sync_ignored',
        `platformStatus=${platformStatus}，当前状态=${m.status}，${decision.reason}`,
      );
      return { applied: false, message: m, reason: decision.reason };
    }

    const u = this.repo.update(traceId, { status })!;
    writeTrace(this.repo, u, 'sync', `platformStatus=${platformStatus}`);
    this.broadcast({ type: 'message.updated', data: u });
    return { applied: true, message: u };
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
      const r = await this.syncStatus(target.traceId, d.platformStatus);
      return { applied: r.applied, message: r.message ?? this.repo.get(target.traceId) };
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
