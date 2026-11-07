import type { CSSProperties } from 'react';
import type { DeliveryInfo } from '@unimsg/shared';
import { mixHex, readableInk } from './ink';
import { MsgStatus, Platform } from '../types';
import type { MsgType, UnifiedMessage } from '../types';

/**
 * 标签色板：**一个作者值**（`color`）派生出四支，不再各处硬编码。
 *
 * - `color` 品牌原色，只给**图形**（色点、头像底、连接灯）——非文字只需 3:1
 * - `soft` 文字底：`color` 混白 90%
 * - `ink` 浅底上的墨色：同色相压暗，≥4.5:1
 * - `softDark` / `inkDark` 暗色主题那一对（浅底混黑 16% → 重新算墨色）
 *
 * 原来 color / soft / ink 是三个独立字符串，暗色还要在 CSS 里用 `!important`
 * 再覆盖一次——同一个视觉决策有四处真相，改一处必忘三处。现在只留 `color`，
 * 其余由 `tone()` 推导，组件只负责把 CSS 变量挂上去。
 */
export interface TagTone {
  color: string;
  soft: string;
  ink: string;
  softDark: string;
  inkDark: string;
}

/** 浅底混黑的比例：与 `--surface-3` 同一档灰度，保留一点点色相偏色 */
const DARK_TINT = 0.16;

export function tone(color: string): TagTone {
  // 往白走到 90% → 浅色底；从纯黑往浅底走 16% → 暗色底（两者同一个色相来源）
  const soft = mixHex(color, '#ffffff', 0.9);
  const softDark = mixHex('#000000', soft, DARK_TINT);
  return {
    color,
    soft,
    ink: readableInk(color, soft),
    softDark,
    inkDark: readableInk(color, softDark),
  };
}

/** 挂到元素上的 CSS 变量（`as CSSProperties` 让自定义属性穿过类型检查） */
export function toneStyle(t: TagTone): CSSProperties {
  return {
    '--tag-soft': t.soft,
    '--tag-ink': t.ink,
    '--tag-soft-dark': t.softDark,
    '--tag-ink-dark': t.inkDark,
  } as CSSProperties;
}

export interface PlatformTone extends TagTone {
  name: string;
  short: string;
}

export const PLATFORM_META: Record<Platform, PlatformTone> = {
  [Platform.FEISHU]: { name: '飞书', short: '飞', ...tone('#3370ff') },
  [Platform.DINGTALK]: { name: '钉钉', short: '钉', ...tone('#0089ff') },
  [Platform.WECOM]: { name: '企业微信', short: '企', ...tone('#07c160') },
  [Platform.MAIL]: { name: '邮箱', short: '邮', ...tone('#ff9500') },
};

/** 状态机展示元信息（color 给色点，ink 给文字） */
export interface StatusTone extends TagTone {
  label: string;
}

export const STATUS_META: Record<MsgStatus, StatusTone> = {
  [MsgStatus.RECEIVED]: { label: '已接收', ...tone('#6e6e73') },
  [MsgStatus.PROCESSING]: { label: '处理中', ...tone('#0a6cd6') },
  [MsgStatus.REPLIED]: { label: '已回复', ...tone('#1f8a9e') },
  [MsgStatus.SENT]: { label: '已发送', ...tone('#4a47c4') },
  [MsgStatus.SYNCED]: { label: '已同步', ...tone('#248a3d') },
  [MsgStatus.FAILED]: { label: '发送失败', ...tone('#d70015') },
};

/** 闭环状态顺序（用于时间线与进度条） */
export const STATUS_FLOW: MsgStatus[] = [
  MsgStatus.RECEIVED,
  MsgStatus.PROCESSING,
  MsgStatus.REPLIED,
  MsgStatus.SENT,
  MsgStatus.SYNCED,
];

export const TYPE_LABEL: Record<MsgType, string> = {
  text: '文本',
  image: '图片',
  file: '文件',
  todo: '待办',
};

/** 投递方式展示结果：kind 决定 Tag 颜色，text 直接展示 */
export interface DeliveryLabel {
  text: string;
  kind: 'real' | 'mock' | 'none';
}

/**
 * 回写投递方式文案（收件箱详情与账号页复用）。
 * 契约要求：Mock 结果必须明确标注「未调用真实平台」，绝不伪装成真实平台已收到。
 */
export function deliveryLabel(delivery?: DeliveryInfo): DeliveryLabel {
  if (!delivery) return { text: '—', kind: 'none' };
  if (delivery.mode === 'mock') return { text: '模拟发送（未调用真实平台）', kind: 'mock' };
  const platformReply = delivery.platformReply?.trim();
  return { text: platformReply ? `真实接口（${platformReply}）` : '真实接口', kind: 'real' };
}

/**
 * 会话类型文案（详情页「会话」一行）：
 * 群聊消息必须一眼看出回复会发回群里，而不是私聊给发送人。
 */
export function conversationLabel(message: Pick<UnifiedMessage, 'conversation'>): string {
  const c = message.conversation;
  if (!c) return '—';
  if (c.type !== 'group') return '单聊';
  return c.title ? `群聊「${c.title}」` : '群聊';
}

/** 相对时间：刚刚 / n 分钟前 / 今天 HH:mm / 昨天 HH:mm / MM-DD HH:mm */
export function formatRelative(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Math.max(0, now - t);
  const minute = 60_000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;

  const d = new Date(t);
  const n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return `今天 ${hm}`;

  const yesterday = new Date(now - 24 * 60 * minute);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return `昨天 ${hm}`;

  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function shortTrace(traceId: string): string {
  return traceId.length > 12 ? `${traceId.slice(0, 8)}…${traceId.slice(-4)}` : traceId;
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return /^[a-zA-Z]/.test(trimmed) ? trimmed.slice(0, 1).toUpperCase() : trimmed.slice(-1);
}

/** 意图标签配色：待办橙、咨询蓝、通知紫、未分类灰 */
export function intentColor(intent?: string): TagTone {
  if (!intent) return tone('#6e6e73');
  if (intent.includes('待办')) return tone('#b25000');
  if (intent.includes('咨询')) return tone('#0a6cd6');
  if (intent.includes('通知')) return tone('#4a47c4');
  return tone('#6e6e73');
}

/** 列表排序：按创建时间倒序（与后端 list 接口默认行为一致） */
export function sortMessages(list: UnifiedMessage[]): UnifiedMessage[] {
  return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}