/**
 * 连接器公共底座。
 *
 * - genTraceId：每条消息一个全链路追踪号（闭环可回放的基础）。
 * - sentBox：Mock 模式下的"已发送箱"。真实平台不可达时，回写动作被
 *   记录到这里，既能在演示里证明"对方平台确实收到"，也能被单测断言。
 * - verifyMock：本地演示用的宽松验签（接受 'mock' / 'dev*' 签名）。
 *   真实验签会在各平台文件里按官方规则补齐（需要真密钥）。
 */
import { randomUUID } from 'node:crypto';
import { Platform } from '@unimsg/shared';
import { config } from '../config';

export function genTraceId(): string {
  return randomUUID();
}

export const sentBox: Record<string, unknown[]> = {
  [Platform.FEISHU]: [],
  [Platform.DINGTALK]: [],
  [Platform.WECOM]: [],
  [Platform.MAIL]: [],
};

export function mockSend(platform: Platform, payload: unknown): { ok: boolean } {
  sentBox[platform].push({ at: new Date().toISOString(), payload });
  console.log(`[mock-send] -> ${platform}:`, JSON.stringify(payload));
  return { ok: true };
}

export function verifyMock(sig: string): boolean {
  return sig === 'mock' || sig.startsWith('dev');
}

/** 根据正文猜测消息类型，便于演示里把"待办类"消息高亮 */
export function inferType(body: string): 'todo' | 'text' {
  return /周报|待办|todo|任务|提醒|deadline|截止/i.test(body) ? 'todo' : 'text';
}
