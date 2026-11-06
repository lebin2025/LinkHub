/**
 * 列表 → 详情的「共享元素」转场（View Transition API）。
 *
 * 视觉意图：点开一条消息时，不是详情面板凭空淡入，而是**这张卡片自己长大**成详情——
 * 空间关系连续，用户知道"我现在看的就是刚才那条"。这正是 iOS 打开 App 的转场方式。
 *
 * 实现要点（三个坑，逐个绕开）：
 *  1. `view-transition-name` 必须在新旧两份快照里**各出现一次**，否则不会形成 morph。
 *     做法：点击时给卡片行内挂名（旧快照），在 `flushSync(navigate)` 之后把名字摘掉、
 *     改挂到详情面板上（新快照）——同一时刻只有一个元素持名，否则 Chrome 会因重名直接放弃转场。
 *  2. 导航是 React Router 的异步提交，必须 `flushSync` 让 DOM 在回调里同步落地，
 *     否则新快照拍到的是旧页面。
 *  3. 不支持该 API（Safari / Firefox）、开了「减少动态效果」、或找不到源卡片时，
 *     一律**直接 navigate**——功能永远不受转场影响。
 */
import { flushSync } from 'react-dom';

/** 转场组的名字，与 app.css 中 `::view-transition-*(msg-morph)` 对应 */
const MORPH_NAME = 'msg-morph';

type ViewTransitionLike = { finished: Promise<void> };

type DocumentWithVT = Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionLike;
};

/** 当前环境能否做共享元素转场（同时尊重用户的减动偏好） */
export function canMorph(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as DocumentWithVT;
  if (typeof doc.startViewTransition !== 'function') return false;
  if (document.documentElement.dataset.motion === 'reduced') return false;
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

/** 从 `/inbox/<traceId>` 里取最后一段，用于定位源卡片 */
function traceIdOf(to: string): string | undefined {
  const segments = to.split(/[?#]/)[0].split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return last && last !== 'inbox' ? last : undefined;
}

/** 按 traceId 找到列表里的那张卡片（MessageCard 上带 data-trace） */
function findSourceCard(traceId: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(traceId) : traceId;
  return document.querySelector<HTMLElement>(`[data-trace="${escaped}"]`);
}

/**
 * 带共享元素转场地导航到 `to`。
 *
 * @param navigate React Router 的 navigate
 * @param to 目标路径，形如 `/inbox/<traceId>`
 */
export function navigateWithMorph(navigate: (to: string) => void, to: string): void {
  const doc = document as DocumentWithVT;
  const traceId = traceIdOf(to);
  const source = traceId ? findSourceCard(traceId) : null;

  if (!traceId || !source || !canMorph()) {
    navigate(to);
    return;
  }

  const root = document.documentElement;
  let panel: HTMLElement | null = null;

  // 旧快照：卡片持名
  source.style.viewTransitionName = MORPH_NAME;
  root.classList.add('vt-morph');

  const cleanup = () => {
    root.classList.remove('vt-morph');
    source.style.viewTransitionName = '';
    if (panel) panel.style.viewTransitionName = '';
  };

  try {
    const transition = doc.startViewTransition!(() => {
      flushSync(() => navigate(to));
      // 新快照：名字从卡片交给详情面板，避免重名导致转场被丢弃
      source.style.viewTransitionName = '';
      panel = document.querySelector<HTMLElement>('[data-testid="detail-panel"]');
      if (panel) panel.style.viewTransitionName = MORPH_NAME;
    });
    void transition.finished.then(cleanup, cleanup);
  } catch {
    // 任何异常都不影响导航本身
    cleanup();
    navigate(to);
  }
}
