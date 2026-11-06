/**
 * InboxPage 接线测试：证明首屏空态接的是「一键注入入口」而不是文档说明。
 *
 * 用 vi.mock 隔离全局 store 单例（真实 store 会创建 WebSocket），
 * 以「状态驱动」的方式覆盖：真实后端空收件箱 → 显示 QuickStart；Mock 模式 / 有消息 / 加载失败 → 不显示。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ACCOUNTS } from '../../services/mock/fixtures';
import { MsgStatus, Platform } from '../../types';
import type { UnifiedMessage } from '../../types';

const hoisted = vi.hoisted(() => {
  const state = {
    messages: [] as unknown[],
    loading: false,
    error: null as string | null,
    filters: { keyword: '', onlyReview: false },
    accounts: [] as unknown[],
    health: null as null | { received: number },
    connection: 'connected' as 'connected' | 'reconnecting' | 'offline',
    demoMode: false,
    initialized: true,
  };
  return { state };
});

vi.mock('../../hooks/useAppState', () => ({
  useAppState: () => hoisted.state,
}));

// 只提供 InboxPage / DetailPanel 用到的 store 方法；避免 import 真实单例创建 WS 连接
vi.mock('../../store', () => ({
  store: {
    setFilters: vi.fn(),
    resetFilters: vi.fn(),
    dismissError: vi.fn(),
    reply: vi.fn(),
    markDone: vi.fn(),
    getTrace: vi.fn(),
    refreshHealth: vi.fn(),
    simulateIncoming: vi.fn(),
    armFailure: vi.fn(),
  },
}));

import { InboxPage } from './InboxPage';

const MESSAGE: UnifiedMessage = {
  traceId: 't-inbox-1',
  platform: Platform.FEISHU,
  externalId: 'e-inbox-1',
  sender: { id: 'u1', name: '张三' },
  type: 'text',
  body: '周五前交周报。',
  status: MsgStatus.RECEIVED,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function mockState(patch: Partial<typeof hoisted.state> = {}) {
  hoisted.state = {
    messages: [],
    loading: false,
    error: null,
    filters: { keyword: '', onlyReview: false },
    accounts: [],
    health: null,
    connection: 'connected',
    demoMode: false,
    initialized: true,
    ...patch,
  };
}

/**
 * 必须用 <Routes> 提供真实路由上下文，否则 useParams() 永远拿到 {}：
 * 「选中某条消息 / 自动跳转」这类用例测不到路由参数。
 */
function renderInboxPage(path = '/inbox') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/inbox/:traceId" element={<InboxPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('InboxPage 首启空态接线', () => {
  it('真实后端 + 空收件箱：空态渲染一键注入入口，文案不再说「没有匹配的消息」', () => {
    mockState({ demoMode: false, accounts: ACCOUNTS, health: { received: 0 } });
    renderInboxPage();

    const quickstart = screen.getByTestId('quickstart');
    expect(quickstart).toBeInTheDocument();
    // 三个可注入的平台各一颗按钮（邮箱是 IMAP 轮询，没有 webhook，不出现）
    expect(within(quickstart).getByRole('button', { name: '飞书' })).toBeInTheDocument();
    expect(within(quickstart).getByRole('button', { name: '钉钉' })).toBeInTheDocument();
    expect(within(quickstart).getByRole('button', { name: '企业微信' })).toBeInTheDocument();
    expect(within(quickstart).queryByRole('button', { name: '邮箱' })).toBeNull();
    // 键位提示是唯一的文字说明（可操作信息，不是解释文案）
    expect(within(quickstart).getByText('切换')).toBeInTheDocument();
    // 首启空态：不能再用「没有匹配的消息 / 清空筛选」误导用户
    expect(screen.getByText('还没有收到消息')).toBeInTheDocument();
    expect(screen.queryByText('没有匹配的消息')).not.toBeInTheDocument();
    // 文档型引导块已从首屏移除
    expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument();
  });

  it('前端 Mock 演示模式：空收件箱不渲染注入入口（无平台可假装）', () => {
    mockState({ demoMode: true, accounts: ACCOUNTS });
    renderInboxPage();
    expect(screen.queryByTestId('quickstart')).not.toBeInTheDocument();
  });

  it('已有消息：不渲染注入入口（列表加载中也不误判为空）', () => {
    mockState({ loading: true, messages: [MESSAGE], accounts: ACCOUNTS });
    renderInboxPage();
    expect(screen.queryByTestId('quickstart')).not.toBeInTheDocument();
  });

  it('加载失败：不渲染注入入口，空态提示「消息加载失败」而不是「没收到消息」', () => {
    mockState({ error: '无法连接后端服务，请确认服务已启动' });
    renderInboxPage();
    expect(screen.queryByTestId('quickstart')).not.toBeInTheDocument();
    expect(screen.getByText('消息加载失败')).toBeInTheDocument();
    expect(screen.queryByText('还没有收到消息')).not.toBeInTheDocument();
  });

  it('URL 里的 traceId 已不存在（重启后内存清空）：回退到卡片网格，不替用户选一条', async () => {
    mockState({ messages: [MESSAGE], accounts: ACCOUNTS });
    renderInboxPage('/inbox/stale-trace-id-from-before-restart');

    // 意图与队友那次修复一致：右侧不留空白、不让人误以为消息丢了。
    // 但默认态是卡片网格，替用户打开"最新一条"会让他以为自己点错了消息，
    // 所以这里回退到网格——消息本身就在眼前。
    expect(await screen.findByText('周五前交周报。')).toBeInTheDocument();
    // 没有打开任何详情：详情面板不存在（网格模式右侧的占位只是被 CSS 隐藏，不算"空白"）
    expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument();
  });

  it('URL 里的 traceId 有效：保持用户当前选中的消息，不跳转', async () => {
    const other: UnifiedMessage = { ...MESSAGE, traceId: 't-inbox-2', body: '另一条消息' };
    mockState({ messages: [MESSAGE, other], accounts: ACCOUNTS });
    renderInboxPage('/inbox/t-inbox-1');

    expect(await screen.findByTestId('detail-panel')).toBeInTheDocument();
    expect(within(screen.getByTestId('detail-panel')).getByText('周五前交周报。')).toBeInTheDocument();
  });
});
