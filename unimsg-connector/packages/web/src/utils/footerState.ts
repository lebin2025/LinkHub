/**
 * 侧边栏页脚状态映射（纯函数，便于单测）。
 *
 * 背景：页脚此前只要 demoMode=false 就永远显示「真实后端 · 已接入 LinkHub Server」，
 * 后端断连 / 请求报错时用户会误判。这里把「模式 + 实时连接 + 加载错误」如实映射为
 * badge / 说明文案 / 语义色调，AppShell 只负责渲染。
 */
import type { RealtimeStatus } from '../services/realtime';

export type FooterTone = 'demo' | 'ok' | 'pending' | 'error';

export interface FooterState {
  /** badge 文案 */
  badge: string;
  /** 说明文案 */
  text: string;
  /** 语义色调：demo=演示（橙）/ ok=正常（绿）/ pending=连接中（橙）/ error=异常（红） */
  tone: FooterTone;
}

/**
 * 页脚状态：
 *  - demoMode：Mock 演示，保持「前端演示模式 · 未接后端」；
 *  - 有 error：badge=连接异常（红色），提示检查后端；
 *  - 否则按实时连接：connected / reconnecting / offline 如实展示。
 */
export function footerState(
  demoMode: boolean,
  connection: RealtimeStatus,
  error: string | null,
): FooterState {
  if (demoMode) {
    return { badge: 'Mock 数据', text: '前端演示模式 · 未接后端', tone: 'demo' };
  }

  if (error) {
    return { badge: '连接异常', text: '数据加载失败 · 检查后端是否启动', tone: 'error' };
  }

  switch (connection) {
    case 'connected':
      return { badge: '真实后端', text: '已接入 LinkHub Server', tone: 'ok' };
    case 'reconnecting':
      return { badge: '真实后端', text: '后端连接中…', tone: 'pending' };
    case 'offline':
      return { badge: '真实后端', text: '后端未连接（检查后端是否启动）', tone: 'error' };
  }
}
