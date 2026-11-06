/**
 * InboxPage 接线测试：证明 FirstRunGuide 真的挂在收件箱页顶部，而不是只存在于组件文件里。
 *
 * 用 vi.mock 隔离全局 store 单例（真实 store 会创建 WebSocket），
 * 以「props/状态驱动」的方式覆盖：真实后端空收件箱 → 显示；Mock 模式 / 有消息 → 不显示。
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

describe('InboxPage 首启引导接线', () => {
  it('真实后端 + 空收件箱：页面顶部渲染 FirstRunGuide，空态文案不再说「没有匹配的消息」', () => {
    mockState({ demoMode: false, accounts: ACCOUNTS, health: { received: 0 } });
    renderInboxPage();

    expect(screen.getByTestId('first-run-guide')).toBeInTheDocument();
    expect(screen.getByText('后端已连上，但还没有消息')).toBeInTheDocument();
    expect(screen.getByTestId('first-run-mode-feishu')).toHaveTextContent('真实接口');
    // 首启空态：不能再用「没有匹配的消息 / 清空筛选」误导用户
    expect(screen.getByText('还没有收到消息')).toBeInTheDocument();
    expect(screen.queryByText('没有匹配的消息')).not.toBeInTheDocument();
  });

  it('前端 Mock 演示模式：InboxPage 不渲染首启引导', () => {
    mockState({ demoMode: true, accounts: ACCOUNTS });
    renderInboxPage();
    expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument();
  });

  it('已有消息：InboxPage 不渲染首启引导（列表加载中也不误报首启）', () => {
    mockState({ loading: true, messages: [MESSAGE], accounts: ACCOUNTS });
    renderInboxPage();
    expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument();
  });

  it('加载失败：不渲染首启引导，空态提示「消息加载失败」而不是「没收到消息」', () => {
    mockState({ error: '无法连接后端服务，请确认服务已启动' });
    renderInboxPage();
    expect(screen.queryByTestId('first-run-guide')).not.toBeInTheDocument();
    expect(screen.getByText('消息加载失败')).toBeInTheDocument();
    expect(screen.queryByText('还没有收到消息')).not.toBeInTheDocument();
  });

  it('URL 里的 traceId 已不存在（重启后内存清空）：自动打开最新一条，右侧不再空白', async () => {
    mockState({ messages: [MESSAGE], accounts: ACCOUNTS });
    renderInboxPage('/inbox/stale-trace-id-from-before-restart');

    expect(await screen.findByTestId('detail-panel')).toBeInTheDocument();
    expect(within(screen.getByTestId('detail-panel')).getByText('周五前交周报。')).toBeInTheDocument();
    expect(screen.queryByText('选择一条消息')).not.toBeInTheDocument();
  });

  it('URL 里的 traceId 有效：保持用户当前选中的消息，不跳转', async () => {
    const other: UnifiedMessage = { ...MESSAGE, traceId: 't-inbox-2', body: '另一条消息' };
    mockState({ messages: [MESSAGE, other], accounts: ACCOUNTS });
    renderInboxPage('/inbox/t-inbox-1');

    expect(await screen.findByTestId('detail-panel')).toBeInTheDocument();
    expect(within(screen.getByTestId('detail-panel')).getByText('周五前交周报。')).toBeInTheDocument();
  });
});
