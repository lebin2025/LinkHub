import { useMemo } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Alert, App as AntApp, Avatar, Dropdown, Input, Segmented, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined,
  CheckSquareOutlined,
  DownOutlined,
  HistoryOutlined,
  InboxOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useAppState } from '../hooks/useAppState';
import { store } from '../store';
import { Platform } from '../types';
import { ConnectionDot } from '../components/ConnectionDot';

export function AppShell() {
  const state = useAppState();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const counts = useMemo(() => {
    const inbox = state.messages.filter((m) => m.status !== 'synced' && m.status !== 'failed').length;
    const todos = state.messages.filter((m) => m.type === 'todo' && !m.done).length;
    return { inbox, todos };
  }, [state.messages]);

  const platformValue = state.filters.platform ?? 'all';

  const demoMenu: MenuProps = {
    items: [
      { key: 'incoming', icon: <InboxOutlined />, label: '模拟平台推送一条新消息' },
      { key: 'fail', icon: <ThunderboltOutlined />, label: '让下一次回复失败（演示 DLQ）' },
      { type: 'divider' },
      { key: 'reset', icon: <ReloadOutlined />, label: '重置筛选条件' },
    ],
    onClick: async ({ key }) => {
      if (key === 'incoming') {
        await store.simulateIncoming();
        message.success('已模拟一条平台推送');
      } else if (key === 'fail') {
        store.armFailure();
        message.warning('下一次回复将演示失败：状态会变为「发送失败」');
      } else if (key === 'reset') {
        store.resetFilters();
        navigate('/inbox');
      }
    },
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand" onClick={() => navigate('/inbox')} role="button" tabIndex={0}>
          <span className="brand__mark">L</span>
          <span className="brand__text">
            <span className="brand__name">LinkHub</span>
            <span className="brand__sub">统一消息中心</span>
          </span>
        </div>

        <Input
          className="global-search"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索发送人、正文、意图或 traceId"
          value={state.filters.keyword}
          onChange={(e) => store.setFilters({ keyword: e.target.value })}
        />

        <div className="header-actions">
          <Segmented
            size="small"
            value={platformValue}
            onChange={(value) =>
              store.setFilters({ platform: value === 'all' ? undefined : (value as Platform) })
            }
            options={[
              { label: '全部', value: 'all' },
              { label: '飞书', value: Platform.FEISHU },
              { label: '钉钉', value: Platform.DINGTALK },
              { label: '企微', value: Platform.WECOM },
            ]}
          />

          <Tooltip title={state.demoMode ? '实时推送状态（Mock 模拟连接）' : 'WebSocket 实时连接状态'}>
            <span>
              <ConnectionDot status={state.connection} />
            </span>
          </Tooltip>

          {state.demoMode && (
            <Dropdown menu={demoMenu} trigger={['click']}>
              <button className="demo-btn" type="button">
                <ThunderboltOutlined /> 演示 <DownOutlined className="demo-btn__caret" />
              </button>
            </Dropdown>
          )}

          <Avatar size={32} style={{ background: '#e6f0ff', color: '#1677ff', fontWeight: 600 }}>
            B
          </Avatar>
        </div>
      </header>

      <div className="app-body">
        <aside className="app-side">
          <nav className="side-nav">
            <NavLink to="/inbox" className={({ isActive }) => `side-item${isActive ? ' is-active' : ''}`}>
              <InboxOutlined />
              <span>收件箱</span>
              <span className="side-count">{counts.inbox}</span>
            </NavLink>
            <NavLink to="/todos" className={({ isActive }) => `side-item${isActive ? ' is-active' : ''}`}>
              <CheckSquareOutlined />
              <span>待办</span>
              <span className="side-count">{counts.todos}</span>
            </NavLink>
            <NavLink to="/trace" className={({ isActive }) => `side-item${isActive ? ' is-active' : ''}`}>
              <HistoryOutlined />
              <span>全链路回放</span>
            </NavLink>
            <NavLink to="/accounts" className={({ isActive }) => `side-item${isActive ? ' is-active' : ''}`}>
              <ApiOutlined />
              <span>平台账号</span>
            </NavLink>
          </nav>

          <div className="side-foot">
            <div className="side-foot__badge">{state.demoMode ? 'Mock 数据' : '真实后端'}</div>
            <div className="side-foot__text">
              {state.demoMode ? '前端演示模式 · 未接后端' : '已接入 LinkHub Server'}
            </div>
          </div>
        </aside>

        <main className="app-main">
          {state.error && (
            <Alert
              style={{ margin: '12px 20px 0' }}
              type="error"
              showIcon
              closable
              message="数据加载异常"
              description={state.error}
              onClose={() => store.dismissError()}
            />
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}