import { useSyncExternalStore } from 'react';

/**
 * 个人设置（名称 / 头像 / 头像底色）。
 *
 * 只保存在本机 localStorage —— 这个项目后端没有账号体系，
 * 所以这里明确不做"云端同步"的假象，设置仅影响本机界面展示。
 */

export interface Profile {
  /** 显示名称 */
  name: string;
  /** 头像图片（dataURL）；为空则回退到名字首字 */
  avatarUrl: string | null;
  /** 首字头像的底色 */
  tone: string;
}

/** 头像底色：低饱和、与整体配色同一家族 */
export const AVATAR_TONES = [
  '#0A84FF',
  '#5B7CD6',
  '#3E8E7E',
  '#B25000',
  '#A23B72',
  '#3A3A3C',
] as const;

export const DEFAULT_PROFILE: Profile = {
  name: '我',
  avatarUrl: null,
  tone: AVATAR_TONES[0],
};

const STORAGE_KEY = 'linkhub-profile';

let cache: Profile | null = null;
const listeners = new Set<() => void>();

function sanitize(input: unknown): Profile {
  if (!input || typeof input !== 'object') return DEFAULT_PROFILE;
  const raw = input as Partial<Profile>;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 24) : DEFAULT_PROFILE.name;
  const avatarUrl =
    typeof raw.avatarUrl === 'string' && raw.avatarUrl.startsWith('data:image/') ? raw.avatarUrl : null;
  const tone = AVATAR_TONES.includes(raw.tone as (typeof AVATAR_TONES)[number])
    ? (raw.tone as string)
    : DEFAULT_PROFILE.tone;
  return { name, avatarUrl, tone };
}

function read(): Profile {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function getProfile(): Profile {
  if (!cache) cache = read();
  return cache;
}

export function saveProfile(next: Profile) {
  cache = sanitize(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // 隐私模式 / 配额不足时静默失败：本次会话内仍然生效
  }
  listeners.forEach((listener) => listener());
}

export function resetProfile() {
  saveProfile(DEFAULT_PROFILE);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useProfile(): Profile {
  return useSyncExternalStore(subscribe, getProfile, () => DEFAULT_PROFILE);
}

/** 头像展示文字：取名字首个字符（英文转大写，中文取字） */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'L';
  const first = Array.from(trimmed)[0];
  return first.toUpperCase();
}
