import { describe, expect, it } from 'vitest';
import { formatRelative, initials, shortTrace, sortMessages } from './format';
import { MsgStatus, Platform } from '../types';
import type { UnifiedMessage } from '../types';

function msg(partial: Partial<UnifiedMessage>): UnifiedMessage {
  return {
    traceId: 't-1',
    platform: Platform.FEISHU,
    externalId: 'e-1',
    sender: { id: 'u1', name: '张三' },
    type: 'text',
    body: 'hello',
    status: MsgStatus.RECEIVED,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('format utils', () => {
  it('相对时间：刚刚 / 分钟 / 今天', () => {
    const now = Date.now();
    expect(formatRelative(new Date(now - 5_000).toISOString(), now)).toBe('刚刚');
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 分钟前');
    expect(formatRelative(new Date(now - 60 * 60_000).toISOString(), now)).toMatch(/^今天 \d{2}:\d{2}$/);
  });

  it('姓名首字与 traceId 缩略', () => {
    expect(initials('张三')).toBe('三');
    expect(initials('alice')).toBe('A');
    expect(shortTrace('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toContain('…');
  });

  it('排序：按创建时间倒序', () => {
    const old = msg({ traceId: 'a', createdAt: new Date(Date.now() - 60_000).toISOString() });
    const fresh = msg({ traceId: 'b', createdAt: new Date().toISOString() });
    const older = msg({ traceId: 'c', needsReview: true, createdAt: new Date(Date.now() - 120_000).toISOString() });
    expect(sortMessages([old, fresh, older]).map((m) => m.traceId)).toEqual(['b', 'a', 'c']);
  });
});