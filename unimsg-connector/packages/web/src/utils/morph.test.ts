import { describe, expect, it, vi } from 'vitest';
import { canMorph, navigateWithMorph } from './morph';

/**
 * 转场是纯增强：任何不支持的环境都必须**照常导航**。
 * jsdom 没有 startViewTransition，正好覆盖降级路径。
 */
describe('navigateWithMorph 降级', () => {
  it('环境不支持时直接导航（不抛错、不挂样式）', () => {
    expect(canMorph()).toBe(false);

    const navigate = vi.fn();
    expect(() => navigateWithMorph(navigate, '/inbox/abc')).not.toThrow();
    expect(navigate).toHaveBeenCalledWith('/inbox/abc');
    expect(document.documentElement.classList.contains('vt-morph')).toBe(false);
  });

  it('页面上找不到源卡片时也直接导航', () => {
    const navigate = vi.fn();
    navigateWithMorph(navigate, '/inbox/not-in-list');
    expect(navigate).toHaveBeenCalledWith('/inbox/not-in-list');
  });

  it('打开「减少动态效果」时不接管导航', () => {
    document.documentElement.dataset.motion = 'reduced';
    const navigate = vi.fn();
    navigateWithMorph(navigate, '/inbox/abc');
    expect(canMorph()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/inbox/abc');
    delete document.documentElement.dataset.motion;
  });
});
