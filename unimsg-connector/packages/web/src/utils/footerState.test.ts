import { describe, expect, it } from 'vitest';
import { footerState } from './footerState';

describe('footerState 页脚状态映射', () => {
  it('Mock 演示模式：保持「前端演示模式 · 未接后端」', () => {
    const footer = footerState(true, 'offline', null);
    expect(footer).toEqual({
      badge: 'Mock 数据',
      text: '前端演示模式 · 未接后端',
      tone: 'demo',
    });
  });

  it('真实后端已连接：显示「已接入 LinkHub Server」', () => {
    expect(footerState(false, 'connected', null)).toEqual({
      badge: '真实后端',
      text: '已接入 LinkHub Server',
      tone: 'ok',
    });
  });

  it('真实后端重连中：如实显示「后端连接中…」，不再伪装成已接入', () => {
    expect(footerState(false, 'reconnecting', null)).toEqual({
      badge: '真实后端',
      text: '后端连接中…',
      tone: 'pending',
    });
  });

  it('真实后端已离线：提示检查后端是否启动', () => {
    expect(footerState(false, 'offline', null)).toEqual({
      badge: '真实后端',
      text: '后端未连接（检查后端是否启动）',
      tone: 'error',
    });
  });

  it('存在加载错误时 badge 显示「连接异常」，优先于连接状态', () => {
    const footer = footerState(false, 'connected', '无法连接后端服务，请确认服务已启动');
    expect(footer.badge).toBe('连接异常');
    expect(footer.tone).toBe('error');
    expect(footer.text).toContain('检查后端是否启动');
    // 错误态对任何连接状态都显示为异常（含重连中/离线）
    expect(footerState(false, 'offline', '请求超时').badge).toBe('连接异常');
  });

  it('Mock 模式不会被后端错误污染（演示模式不发请求）', () => {
    expect(footerState(true, 'connected', 'should-not-happen').tone).toBe('demo');
  });
});
