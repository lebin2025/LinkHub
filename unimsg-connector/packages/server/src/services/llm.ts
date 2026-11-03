/**
 * 大模型服务（Mock 先行）。
 *
 * - Mock 模式：按关键词给出确定性的意图/摘要/回复草稿，零密钥可跑。
 * - 真实模式：拿到 apiKey 后在此处调用文心/通义（密钥仅服务端读取）；
 *   失败判据：超时(LLM_TIMEOUT_MS) / 非合法 JSON / 低置信 → 回退“未分类”。
 * - 特别地，正文含 [[FAIL_LLM]] 时模拟失败，用于边界单测。
 */
import { UnifiedMessage } from '@unimsg/shared';
import { config } from '../config';

export type LlmResult =
  | { ok: true; intent: string; confidence: number; summary: string; replyDraft: string }
  | { ok: false; reason: string };

export class LlmService {
  async analyze(msg: UnifiedMessage): Promise<LlmResult> {
    // 真实 provider 已配置时，将来在此接入真实 API（当前统一走本地 mock，保证零密钥可演示）；
    // 这里刻意不看平台模式：LLM 的 Mock/真实与平台连接器解耦，避免"飞书换号导致意图识别切换"。
    if (config.llm.provider !== 'mock' && config.llm.apiKey) {
      // TODO(real): const res = await callWenxinOrQwen(msg, config.llmTimeoutMs); if 失败 return {ok:false,...}
    }
    return this.mock(msg);
  }

  private mock(msg: UnifiedMessage): LlmResult {
    const body = msg.body ?? '';
    if (body.includes('[[FAIL_LLM]]')) return { ok: false, reason: 'mock_llm_failure' };

    let intent = '未分类';
    let confidence = 0.4;
    if (/周报|待办|任务|提醒|截止|deadline/i.test(body)) { intent = '待办'; confidence = 0.92; }
    else if (/[?？]|怎么|如何|为什么|吗/.test(body)) { intent = '咨询'; confidence = 0.8; }
    else if (/通知|公告|会议|安排/.test(body)) { intent = '通知'; confidence = 0.78; }

    const summary = body.length > 40 ? `${body.slice(0, 40)}…` : body;
    const replyDraft =
      intent === '待办' ? '收到，我会在截止前完成。'
      : intent === '咨询' ? '收到，我确认后回复你。'
      : '收到。';
    return { ok: true, intent, confidence, summary, replyDraft };
  }
}
