/**
 * 连接器公共底座。
 *
 * - genTraceId：每条消息一个全链路追踪号（闭环可回放的基础）。
 * - sentBox：Mock 模式下的"已发送箱"。真实平台不可达时，回写动作被
 *   记录到这里，既能在演示里证明"本地确实走到了发送步骤"，也能被单测断言。
 *   ⚠️ Mock 发送一律返回 mode='mock'，由消息中枢写入 delivery 并在前端标注「模拟发送」，
 *   绝不把 Mock 伪装成真实平台已收到。
 * - verifyMock：本地演示用的宽松验签（接受 'mock' / 'dev*' 签名）。
 * - assertRealSendable：真实模式但凭据不全时显式报错，方便接手人一眼看出缺什么。
 */
import { randomUUID } from 'node:crypto';
import { Platform } from '@unimsg/shared';
import { config, MODE_ENV_KEYS, modeOf } from '../config';

export function genTraceId(): string {
  return randomUUID();
}

export const sentBox: Record<string, unknown[]> = {
  [Platform.FEISHU]: [],
  [Platform.DINGTALK]: [],
  [Platform.WECOM]: [],
  [Platform.MAIL]: [],
};

export function mockSend(platform: Platform, payload: unknown): { ok: boolean; mode: 'mock' } {
  sentBox[platform].push({ at: new Date().toISOString(), payload });
  // 日志不打正文/接收人（避免演示日志被转发时泄露消息内容）；完整 payload 仍保留在 sentBox，前端/回放可见
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(payload));
  } catch {
    size = 0;
  }
  console.log(`[mock-send] -> ${platform}: 模拟发送（未调用真实平台，正文/接收人不出现在日志里，payload ${size} 字节）`);
  return { ok: true, mode: 'mock' };
}

export function verifyMock(sig: string): boolean {
  return sig === 'mock' || sig.startsWith('dev');
}

/** 是否走本地模拟（各连接器统一从这里取，禁止再读全局开关） */
export function isMock(platform: Platform): boolean {
  return modeOf(platform) === 'mock';
}

/**
 * 真实模式下的"发件能力"守卫：凭据不全时直接抛错并给出可操作建议。
 * 这是"绝不静默假装成功"的最后一道防线。
 */
export function assertRealSendable(platform: Platform): void {
  const r = config.runtime[platform];
  if (r.canSend) return;
  const detail = r.missing.length > 0 ? `缺少 ${r.missing.join(' / ')}` : '凭据不完整';
  throw new Error(
    `${r.label}当前是真实模式（${MODE_ENV_KEYS[platform]}=${r.policy}），但${detail}。`
    + `可运行 pnpm run doctor 自检，或把 ${MODE_ENV_KEYS[platform]} 设为 mock 先本地演示。`,
  );
}

/** 根据正文猜测消息类型，便于演示里把"待办类"消息高亮 */
export function inferType(body: string): 'todo' | 'text' {
  return /周报|待办|todo|任务|提醒|deadline|截止/i.test(body) ? 'todo' : 'text';
}
