import { describe, expect, it } from 'vitest';
import { formatDue, groupTodos } from './due';
import { MsgStatus, Platform } from '../types';
import type { UnifiedMessage } from '../types';

/** 固定"现在"：2026-11-06 10:00（周五） */
const NOW = new Date(2026, 10, 6, 10, 0, 0);

let seq = 0;
function msg(over: Partial<UnifiedMessage> = {}): UnifiedMessage {
  seq += 1;
  return {
    traceId: `t-${seq}`,
    platform: Platform.FEISHU,
    externalId: `e-${seq}`,
    sender: { id: 'u1', name: '张三' },
    type: 'todo',
    body: '待办示例',
    status: MsgStatus.RECEIVED,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  } as UnifiedMessage;
}

const iso = (y: number, m: number, d: number, hh = 18, mm = 0) =>
  new Date(y, m - 1, d, hh, mm, 0).toISOString();

describe('formatDue', () => {
  it('没有截止时间时返回 null（不编造）', () => {
    expect(formatDue(undefined)).toBeNull();
    expect(formatDue('not-a-date')).toBeNull();
  });

  it('今天 = 紧急，文案带时刻', () => {
    expect(formatDue(iso(2026, 11, 6, 14, 0), NOW)).toEqual({ text: '今天 14:00', tone: 'soon' });
  });

  it('今天已过点 → 逾期', () => {
    const due = formatDue(iso(2026, 11, 6, 9, 0), NOW);
    expect(due?.tone).toBe('overdue');
    expect(due?.text).toContain('已过点');
  });

  it('昨天 → 逾期，且给出具体日期', () => {
    const due = formatDue(iso(2026, 11, 4), NOW);
    expect(due?.tone).toBe('overdue');
    expect(due?.text).toBe('已逾期 · 11/4 18:00');
  });

  it('明天 / 本周内 / 更远分别用不同文案', () => {
    expect(formatDue(iso(2026, 11, 7), NOW)?.text).toBe('明天 18:00');
    expect(formatDue(iso(2026, 11, 9), NOW)?.text).toBe('周一 18:00');
    expect(formatDue(iso(2026, 12, 3, 9), NOW)?.text).toBe('12月3日 09:00');
  });
});

describe('groupTodos', () => {
  it('按 逾期 → 今天 → 本周 → 更晚 → 未设置 分组，并过滤空组', () => {
    const items = [
      msg({ dueAt: iso(2026, 11, 20) }),
      msg({ dueAt: iso(2026, 11, 2) }),
      msg(),
      msg({ dueAt: iso(2026, 11, 6, 16, 0) }),
      msg({ dueAt: iso(2026, 11, 9) }),
    ];

    const groups = groupTodos(items, NOW);
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'today', 'week', 'later', 'none']);
    expect(groups.map((g) => g.items.length)).toEqual([1, 1, 1, 1, 1]);
    expect(groups[0].label).toBe('已逾期');
    expect(groups[4].label).toBe('未设置截止');
  });

  it('组内按截止时间升序；无截止按创建时间倒序', () => {
    const late = msg({ dueAt: iso(2026, 11, 12) });
    const early = msg({ dueAt: iso(2026, 11, 8) });
    const oldNoDue = msg({ createdAt: iso(2026, 11, 1) });
    const newNoDue = msg({ createdAt: iso(2026, 11, 5) });

    const groups = groupTodos([late, early, oldNoDue, newNoDue], NOW);
    const week = groups.find((g) => g.key === 'week');
    expect(week?.items.map((i) => i.traceId)).toEqual([early.traceId, late.traceId]);

    const none = groups.find((g) => g.key === 'none');
    expect(none?.items.map((i) => i.traceId)).toEqual([newNoDue.traceId, oldNoDue.traceId]);
  });

  it('全部没有截止时间时只返回一个「未设置截止」组', () => {
    const groups = groupTodos([msg(), msg()], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('none');
  });
});
