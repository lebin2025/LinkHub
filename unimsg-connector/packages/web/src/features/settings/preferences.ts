import { useSyncExternalStore } from 'react';

/**
 * 应用偏好（外观 / 交互 / 消息展示）。
 *
 * 与个人资料一样只存本机；区别是这些偏好会直接改界面行为：
 *  - density   → <html data-density>，压缩留白
 *  - motion    → <html data-motion>，减弱动效
 *  - sendKey   → 回复框的发送快捷键
 *  - showAiDraft → 是否展示「AI 建议」卡片
 */

export type Density = 'comfortable' | 'compact';
export type MotionLevel = 'full' | 'reduced';
export type SendKey = 'mod-enter' | 'enter';

export interface Preferences {
  density: Density;
  motion: MotionLevel;
  sendKey: SendKey;
  showAiDraft: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  density: 'comfortable',
  motion: 'full',
  sendKey: 'mod-enter',
  showAiDraft: true,
};

const STORAGE_KEY = 'linkhub-prefs';

let cache: Preferences | null = null;
const listeners = new Set<() => void>();

function sanitize(input: unknown): Preferences {
  if (!input || typeof input !== 'object') return DEFAULT_PREFERENCES;
  const raw = input as Partial<Preferences>;
  return {
    density: raw.density === 'compact' ? 'compact' : 'comfortable',
    motion: raw.motion === 'reduced' ? 'reduced' : 'full',
    sendKey: raw.sendKey === 'enter' ? 'enter' : 'mod-enter',
    showAiDraft: typeof raw.showAiDraft === 'boolean' ? raw.showAiDraft : true,
  };
}

function read(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    return sanitize(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function getPreferences(): Preferences {
  if (!cache) cache = read();
  return cache;
}

export function savePreferences(next: Preferences) {
  cache = sanitize(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // 隐私模式下写入失败：本次会话仍然生效
  }
  listeners.forEach((listener) => listener());
}

export function patchPreferences(patch: Partial<Preferences>) {
  savePreferences({ ...getPreferences(), ...patch });
}

export function resetPreferences() {
  savePreferences(DEFAULT_PREFERENCES);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getPreferences, () => DEFAULT_PREFERENCES);
}
