import type { UnifiedMessage } from '../types';

/**
 * 待办的截止时间：格式化 + 分组。
 *
 * 只做展示层面的判断，不编造时间：
 *  - 没有 dueAt 的归入「未设置截止」，不假装有期限；
 *  - 已过期的单独成组，用危险色标出来；
 *  - 分组顺序固定：已逾期 → 今天 → 本周内 → 更晚 → 未设置。
 */

export interface TodoGroup {
  key: 'overdue' | 'today' | 'week' | 'later' | 'none';
  label: string;
  items: UnifiedMessage[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function clockOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * 截止时间的展示文案与语义色调。
 * 今天之前 = 逾期；今天 = 紧急；其余按"今天/明天/周X/M月D日 + 时刻"。
 */
export function formatDue(
  dueAt?: string,
  now: Date = new Date(),
): { text: string; tone: 'overdue' | 'soon' | 'normal' } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;

  const today = startOfDay(now);
  const dueDay = startOfDay(due);
  const days = Math.round((dueDay.getTime() - today.getTime()) / DAY_MS);
  const time = clockOf(due);

  if (due.getTime() < now.getTime() && days < 0) {
    return { text: `已逾期 · ${due.getMonth() + 1}/${due.getDate()} ${time}`, tone: 'overdue' };
  }
  if (days < 0) return { text: `已逾期 · ${due.getMonth() + 1}/${due.getDate()} ${time}`, tone: 'overdue' };
  if (days === 0) {
    const expired = due.getTime() < now.getTime();
    return {
      text: expired ? `今天 ${time} · 已过点` : `今天 ${time}`,
      tone: expired ? 'overdue' : 'soon',
    };
  }
  if (days === 1) return { text: `明天 ${time}`, tone: 'soon' };
  if (days < 7) return { text: `周${'日一二三四五六'[due.getDay()]} ${time}`, tone: 'normal' };
  return { text: `${due.getMonth() + 1}月${due.getDate()}日 ${time}`, tone: 'normal' };
}

/** 待办按截止时间分组；组内按截止时间升序，无截止的按创建时间倒序 */
export function groupTodos(items: UnifiedMessage[], now: Date = new Date()): TodoGroup[] {
  const today = startOfDay(now).getTime();
  const endOfToday = today + DAY_MS;
  const endOfWeek = today + 7 * DAY_MS;

  const buckets: Record<TodoGroup['key'], UnifiedMessage[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    none: [],
  };

  for (const item of items) {
    if (!item.dueAt) {
      buckets.none.push(item);
      continue;
    }
    const at = new Date(item.dueAt).getTime();
    if (Number.isNaN(at)) {
      buckets.none.push(item);
    } else if (at < today) {
      buckets.overdue.push(item);
    } else if (at < endOfToday) {
      buckets.today.push(item);
    } else if (at < endOfWeek) {
      buckets.week.push(item);
    } else {
      buckets.later.push(item);
    }
  }

  const byDue = (a: UnifiedMessage, b: UnifiedMessage) =>
    new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime();
  const byCreated = (a: UnifiedMessage, b: UnifiedMessage) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  buckets.overdue.sort(byDue);
  buckets.today.sort(byDue);
  buckets.week.sort(byDue);
  buckets.later.sort(byDue);
  buckets.none.sort(byCreated);

  const groups: TodoGroup[] = [
    { key: 'overdue', label: '已逾期', items: buckets.overdue },
    { key: 'today', label: '今天', items: buckets.today },
    { key: 'week', label: '本周内', items: buckets.week },
    { key: 'later', label: '更晚', items: buckets.later },
    { key: 'none', label: '未设置截止', items: buckets.none },
  ];

  return groups.filter((group) => group.items.length > 0);
}
