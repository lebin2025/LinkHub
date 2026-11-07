import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Alert, App as AntApp, Avatar, Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined,
  CheckSquareOutlined,
  DownOutlined,
  HistoryOutlined,
  InboxOutlined,
  MoonOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useAppState } from '../hooks/useAppState';
import { store } from '../store';
import { ConnectionDot } from '../components/ConnectionDot';
import { footerState } from '../utils/footerState';
import { initialOf, useProfile } from '../features/settings/profile';
import { usePreferences } from '../features/settings/preferences';
import { SettingsModal } from '../features/settings/SettingsModal';
import { CommandPalette } from '../components/CommandPalette';
import { useTheme } from './ThemeProvider';

/** 错误排查提示：后端未启动 / 端口不一致 / token 不一致是最常见的三类首启问题 */
const ERROR_HINTS =
  '排查：后端是否已启动（pnpm --filter @unimsg/server start）；VITE_API_BASE 是否指向正确端口；token 是否与后端 API_TOKEN 一致';

/** 顶栏标题：小号 eyebrow + 大标题，Apple 式信息层级 */
function pageMeta(pathname: string): { eyebrow: string; title: string } {
  if (pathname.startsWith('/todos')) return { eyebrow: 'TASKS', title: '待办' };
  if (pathname.startsWith('/trace')) return { eyebrow: 'TRACE', title: '全链路回放' };
  if (pathname.startsWith('/accounts')) return { eyebrow: 'ACCOUNTS', title: '平台账号' };
  return { eyebrow: 'INBOX', title: '收件箱' };
}

/** ≤640px 时渲染底部导航；测试环境 matchMedia 返回 false，不会产生重复文案 */
function useIsCompact(): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 640px)');
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  return compact;
}

/** 图标轨导航项：图标常显，文字走 hover Tooltip（右侧弹出），计数以角标呈现 */
function RailLink({
  to,
  icon,
  label,
  count,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <Tooltip title={label} placement="right" mouseEnterDelay={0.22}>
      <NavLink
        to={to}
        aria-label={label}
        className={({ isActive }) => `rail-item${isActive ? ' is-active' : ''}`}
      >
        {icon}
        {typeof count === 'number' && count > 0 && (
          <span className="rail-item__badge">{count > 99 ? '99+' : count}</span>
        )}
      </NavLink>
    </Tooltip>
  );
}

export function AppShell() {
  const state = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntApp.useApp();
  const { mode, toggle } = useTheme();
  const footer = footerState(state.demoMode, state.connection, state.error);
  const page = pageMeta(location.pathname);
  const compact = useIsCompact();
  const profile = useProfile();
  const prefs = usePreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // —— 图标轨滑动高光 ——
  const navRef = useRef<HTMLElement | null>(null);
  const [glow, setGlow] = useState<{ top: number; height: number } | null>(null);
  const [jelly, setJelly] = useState(false);
  const firstGlow = useRef(true);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('.rail-item.is-active');
      if (!active) {
        setGlow(null);
        return;
      }
      setGlow({ top: active.offsetTop, height: active.offsetHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [location.pathname]);

  // 每次高光位移都补一段果冻挤压（首帧落位不做，避免刚进页面就抖一下）
  useEffect(() => {
    if (!glow) return;
    if (firstGlow.current) {
      firstGlow.current = false;
      return;
    }
    setJelly(true);
    const timer = window.setTimeout(() => setJelly(false), 560);
    return () => window.clearTimeout(timer);
  }, [glow?.top, glow?.height]);

  // 偏好落到 <html data-*> 上，交给 CSS 生效（密度 / 动效）
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = prefs.density;
    root.dataset.motion = prefs.motion;
  }, [prefs.density, prefs.motion]);

  const counts = useMemo(() => {
    const inbox = state.messages.filter((m) => m.status !== 'synced' && m.status !== 'failed').length;
    const todos = state.messages.filter((m) => m.type === 'todo' && !m.done).length;
    return { inbox, todos };
  }, [state.messages]);

  // ⌘K / Ctrl+K 打开命令面板（顶层监听，输入框内也生效）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
      <aside className="app-side">
        <div className="rail__brand">
          <Tooltip title="LinkHub · 统一消息中心" placement="right">
            <button
              className="brand__mark"
              type="button"
              aria-label="返回收件箱"
              onClick={() => navigate('/inbox')}
            >
              L
            </button>
          </Tooltip>
        </div>

        <nav className="rail__nav" aria-label="主导航" ref={navRef}>
          {glow && (
            <span
              className={`rail__glow${jelly ? ' is-moving' : ''}`}
              style={{ '--glow-y': `${glow.top}px`, height: glow.height } as CSSProperties}
              aria-hidden="true"
            />
          )}

          <div className="rail__group">
            <RailLink to="/inbox" icon={<InboxOutlined />} label="收件箱" count={counts.inbox} />
            <RailLink to="/todos" icon={<CheckSquareOutlined />} label="待办" count={counts.todos} />
            <RailLink to="/trace" icon={<HistoryOutlined />} label="全链路回放" />
          </div>

          <span className="rail__sep" role="presentation" />

          <div className="rail__group">
            <RailLink to="/accounts" icon={<ApiOutlined />} label="平台账号" />
          </div>
        </nav>

        <div className="rail__foot">
          <Tooltip title="个人设置" placement="right">
            <button
              className="rail-item rail-item--plain"
              type="button"
              aria-label="个人设置"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingOutlined />
            </button>
          </Tooltip>

          <Tooltip title={`${footer.badge} · ${footer.text}`} placement="right">
            <span
              className={`rail-status rail-status--${footer.tone === 'ok' ? 'ok' : footer.tone}`}
              role="status"
              aria-label={`${footer.badge}：${footer.text}`}
            >
              <span className="rail-status__dot" />
            </span>
          </Tooltip>
        </div>
      </aside>

      <div className="app-body">
        <div className="cmdbar">
          <div className="cmdbar__lead">
            <span className="cmdbar__eyebrow">{page.eyebrow}</span>
            <h1 className="cmdbar__title">{page.title}</h1>
          </div>

          <div className="cmdbar__actions">
            <button
              className="search-trigger"
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="打开命令面板"
            >
              <SearchOutlined />
              <span className="search-trigger__label">搜索</span>
              <kbd className="kbd">⌘K</kbd>
            </button>

            <Tooltip title={state.demoMode ? '实时推送状态（Mock 模拟连接）' : 'WebSocket 实时连接状态'}>
              <span>
                <ConnectionDot status={state.connection} />
              </span>
            </Tooltip>

            <Tooltip title={mode === 'dark' ? '切换到明色' : '切换到暗色'}>
              <button
                className="icon-btn"
                type="button"
                onClick={() => toggle()}
                aria-label="切换明暗主题"
              >
                {mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
              </button>
            </Tooltip>

            {state.demoMode && (
              <Dropdown menu={demoMenu} trigger={['click']}>
                <button className="demo-btn" type="button">
                  <ThunderboltOutlined /> 演示 <DownOutlined className="demo-btn__caret" />
                </button>
              </Dropdown>
            )}

            <Tooltip title={`${profile.name} · 个人设置`}>
              <button
                className="avatar-btn"
                type="button"
                aria-label="打开个人设置"
                onClick={() => setSettingsOpen(true)}
              >
                <Avatar
                  size={30}
                  className="brand-avatar"
                  style={{ background: profile.tone }}
                  src={profile.avatarUrl ?? undefined}
                >
                  {initialOf(profile.name)}
                </Avatar>
              </button>
            </Tooltip>
          </div>
        </div>

        <main className="app-main">
          {state.error && (
            <Alert
              style={{ margin: '12px 24px 0' }}
              type="error"
              showIcon
              closable
              message="数据加载异常"
              description={
                <div className="alert-detail">
                  <div>{state.error}</div>
                  <div className="alert-detail__hint">{ERROR_HINTS}</div>
                </div>
              }
              onClose={() => store.dismissError()}
            />
          )}
          <div className="app-content">
            <Outlet />
          </div>
        </main>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {compact && (
        <nav className="mobile-nav" aria-label="移动端导航">
          <NavLink
            to="/inbox"
            className={({ isActive }) => `mobile-nav__item${isActive ? ' is-active' : ''}`}
          >
            <InboxOutlined />
            <span>收件箱</span>
          </NavLink>
          <NavLink
            to="/todos"
            className={({ isActive }) => `mobile-nav__item${isActive ? ' is-active' : ''}`}
          >
            <CheckSquareOutlined />
            <span>待办</span>
          </NavLink>
          <NavLink
            to="/trace"
            className={({ isActive }) => `mobile-nav__item${isActive ? ' is-active' : ''}`}
          >
            <HistoryOutlined />
            <span>回放</span>
          </NavLink>
          <NavLink
            to="/accounts"
            className={({ isActive }) => `mobile-nav__item${isActive ? ' is-active' : ''}`}
          >
            <ApiOutlined />
            <span>账号</span>
          </NavLink>
        </nav>
      )}
    </div>
  );
}
