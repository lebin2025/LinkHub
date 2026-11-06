import { useEffect, useRef } from 'react';

/** 光标是否落在可输入元素里 —— 热键必须让位给正常打字 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
}

/**
 * 单键热键（j / k / e / r / Escape…）。
 *
 * 约定：
 *  - 带 ⌘/Ctrl/Alt 的组合不在这里处理，避免抢掉浏览器与命令面板的快捷键；
 *  - 输入框/文本域/可编辑区域内一律忽略；
 *  - 命中时 preventDefault，避免页面滚动等默认行为。
 */
export function useHotkeys(map: Record<string, (event: KeyboardEvent) => void>, enabled = true) {
  const latest = useRef(map);
  latest.current = map;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handler = latest.current[key];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
