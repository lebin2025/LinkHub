import { MsgStatus, Platform } from '../types';
import type { MsgType, UnifiedMessage } from '../types';

/** 平台展示元信息：名称、品牌色、浅底色 */
export const PLATFORM_META: Record<Platform, { name: string; short: string; color: string; soft: string }> = {
  [Platform.FEISHU]: { name: '飞书', short: '飞', color: '#3370ff', soft: '#eaf0ff' },
  [Platform.DINGTALK]: { name: '钉钉', short: '钉', color: '#0089ff', soft: '#e6f4ff' },
  [Platform.WECOM]: { name: '企业微信', short: '企', color: '#07c160', soft: '#e8f9ee' },
};

/** 状态机展示元信息 */
export const STATUS_META: Record<MsgStatus, { label: string; color: string; soft: string }> = {
  [MsgStatus.RECEIVED]: { label: '已接收', color: '#8c8c8c', soft: '#f0f0f0' },
  [MsgStatus.PROCESSING]: { label: '处理中', color: '#1677ff', soft: '#e6f0ff' },
  [MsgStatus.REPLIED]: { label: '已回复', color: '#13c2c2', soft: '#e6fffb' },
  [MsgStatus.SENT]: { label: '已发送', color: '#722ed1', soft: '#f3e8ff' },
  [MsgStatus.SYNCED]: { label: '已同步', color: '#52c41a', soft: '#f0fbe6' },
  [MsgStatus.FAILED]: { label: '发送失败', color: '#ff4d4f', soft: '#fff1f0' },
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
export function intentColor(intent?: string): { color: string; soft: string } {
  if (!intent) return { color: '#8c8c8c', soft: '#f5f5f5' };
  if (intent.includes('待办')) return { color: '#d46b08', soft: '#fff7e6' };
  if (intent.includes('咨询')) return { color: '#0958d9', soft: '#e6f4ff' };
  if (intent.includes('通知')) return { color: '#531dab', soft: '#f9f0ff' };
  return { color: '#8c8c8c', soft: '#f5f5f5' };
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