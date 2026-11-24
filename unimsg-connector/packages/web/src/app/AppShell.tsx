import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Alert, App as AntApp, Avatar, Button, Dropdown, Popover, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  ApiOutlined,
  CheckOutlined,  BarChartOutlined,
  CheckSquareOutlined,
  DownOutlined,
  HistoryOutlined,
  InboxOutlined,
  LinkOutlined,
  LoginOutlined,
  LogoutOutlined,
  MoonOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { useAppState } from '../hooks/useAppState';
import { useUrgentAlerts } from '../hooks/useUrgentAlerts';
import { useTodoReminders } from '../hooks/useTodoReminders';
import { useSnoozeAlerts } from '../hooks/useSnoozeAlerts';
import { store, services } from '../store';
import {
  clearSession,
  listSessions,
  switchSession,
  useSession,
  useSessions,
} from '../services/session';
import { PlatformGlyph } from '../components/PlatformGlyph';
import { footerShortLabel, footerState } from '../utils/footerState';
import { clamp } from '../utils/format';
import { formatSendError } from '../utils/sendError';
import { installScrollIndicator } from '../utils/scrollIndicator';
import { initialOf, useProfile } from '../features/settings/profile';
import { usePreferences } from '../features/settings/preferences';
import { SettingsModal } from '../features/settings/SettingsModal';
import { ComposeModal } from '../features/compose/ComposeModal';
import { CommandPalette } from '../components/CommandPalette';
import { useTheme } from './ThemeProvider';
import { pageMeta } from './pageMeta';
import { Platform } from '../types';
import type { UnifiedMessage } from '../types';
import { PLATFORM_META } from '../utils/format';
import { conversationKey } from '../utils/conversations';
import { ensureNotificationPermission, showSystemNotification } from '../services/notify';

/** 普通用户看到的排查提示：不出现端口 / token / 命令这类技术词 */
const ERROR_HINTS =
  '可以先刷新页面或重新打开 LinkHub 再试；如果一直这样，请确认 LinkHub 服务还在运行。';

/** 「给技术同事」的排查细节：默认折叠，只有需要的人展开 */
const ERROR_HINTS_DEV =
  '后端是否已启动（pnpm --filter @unimsg/server start）；VITE_API_BASE 是否指向正确端口；token 是否与后端 API_TOKEN 一致';


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

/**
 * 导航项：图标轨道里只留图标，名称交给右侧 Tooltip 与 aria-label。
 * 选中态不画底色——由导航容器里那块滑动高光统一承担，切页时高光会滑过去。
 */
function SideLink({
  to,
  icon,
  label,
  count,
  onNavigate,
  itemRef,
  focused,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  count?: number;
  onNavigate?: () => void;
  itemRef?: (el: HTMLElement | null) => void;
  /** 是否由高光选中：路由激活与「高光在哪」不是一回事（收件箱筛选了平台时高光在平台项上） */
  focused?: boolean;
}) {
  return (
    <Tooltip title={label} placement="right" mouseEnterDelay={0.18}>
      <NavLink
        to={to}
        ref={itemRef}
        aria-label={label}
        onClick={onNavigate}
        className={({ isActive }) =>
          `side-link${isActive ? ' is-active' : ''}${focused ? ' is-focus' : ''}`
        }
      >
        <span className="side-link__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="side-link__label">{label}</span>
        {typeof count === 'number' && count > 0 && (
          <span className="side-link__count">{count > 99 ? '99+' : count}</span>
        )}
      </NavLink>
    </Tooltip>
  );
}

/** 路由 → 高光目标键：与导航项注册的 key 一一对应 */
function navKeyOf(pathname: string): string {
  if (pathname.startsWith('/todos')) return 'to:/todos';
  if (pathname.startsWith('/trace')) return 'to:/trace';
  if (pathname.startsWith('/auto-reply')) return 'to:/auto-reply';
  if (pathname.startsWith('/stats')) return 'to:/stats';
  if (pathname.startsWith('/connect')) return 'to:/connect';
  if (pathname.startsWith('/accounts')) return 'to:/accounts';
  return 'to:/inbox';
}

/* ---------------- 图标轨道的两块滑动高光 ----------------
   导航组（第 1、3 组）共用一块品牌色高光，跟着路由走；
   平台组单独一块铜色高光，跟着收件箱的渠道筛选走。
   两块可以同时亮着：筛了飞书时「收件箱」也还是选中态，点它随时能回去。
   位置从真实 DOM 量：offsetTop 会受分组容器的定位影响，只能拿到组内偏移。 */
type GlowBox = { top: number; height: number } | null;

export function AppShell() {
  const state = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntApp.useApp();
  const { mode, toggle } = useTheme();
  const footer = footerState(state.demoMode, state.connection, state.error);
  /** 401/登录失效类错误：给「重新登录」按钮，而不是让用户对着术语发愁 */
  const needsLogin = Boolean(state.error && /登录|未授权|已过期/.test(state.error));
  const page = pageMeta(location.pathname);
  const compact = useIsCompact();
  const profile = useProfile();
  const prefs = usePreferences();
  /** 紧急消息提醒：挂在壳上，任何页面都能收到提示音 / 桌面通知 */
  useUrgentAlerts(state.messages, state.initialized && !state.loading);
  /** 待办到期提醒：待办就是 type='todo' 的消息，同样挂在壳上全局生效（评审 P0-2） */
  useTodoReminders(
    useMemo(() => state.messages.filter((m) => m.type === 'todo'), [state.messages]),
    state.initialized && !state.loading,
  );
  /** Snooze 到期提醒：页面关着错过到期，打开时补响一次（评审 P1-6） */
  useSnoozeAlerts(state.messages, state.initialized && !state.loading);
  /** 当前登录账号（未登录 = null，此时回退部署令牌，演示模式仍可用） */
  const session = useSession();
  /** 本机记着的全部账号：一个窗口里多开，点一下就换人 */
  const sessions = useSessions();
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 账号菜单受控：点完「切换 / 添加 / 退出」要主动收起，别一直挂在侧栏上挡视野 */
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  /**
   * 退出当前账号：先让服务端作废会话，再清本地状态；失败也照清，避免卡在"退不出去"。
   * 多开场景下还留着别的账号时，退完自动落到下一个账号，不把人赶回登录页。
   */
  const handleLogout = useCallback(async () => {
    try {
      await services.api.logout();
    } catch {
      // 忽略：本地清理优先
    }
    clearSession();
    services.realtime.reconnectNow?.();
    const rest = listSessions();
    if (rest.length > 0) {
      const next = rest[rest.length - 1];
      void store.refresh?.();
      message.success(`已退出，切换到 ${next.user.displayName}`);
      navigate('/inbox');
      return;
    }
    message.success('已退出登录');
    navigate('/login', { replace: true });
  }, [message, navigate]);

  /** 切换到另一个已登录账号：换令牌 → 重连实时通道 → 重拉数据（各账号只看自己的消息） */
  const handleSwitchAccount = useCallback(
    (token: string) => {
      setAccountMenuOpen(false);
      if (!switchSession(token)) return;
      services.realtime.reconnectNow?.();
      void store.refresh?.();
      navigate('/inbox');
    },
    [navigate],
  );

  /**
   * 账号切换菜单：一张列表看完本机所有账号，点谁切谁。
   * 用 Popover 而不是 Dropdown —— 只有 Popover 支持向右展开，
   * 侧栏贴左边，菜单必须往内容区方向长，才不会被视口裁掉。
   */
  const accountMenuBody = (
    <div className="acct-pop" role="menu" aria-label="切换账号">
      <div className="acct-pop__head">
        已登录账号
        <span className="acct-pop__count">{sessions.length}</span>
      </div>

      {sessions.map((item) => {
        const active = item.token === session?.token;
        return (
          <button
            key={item.token}
            type="button"
            role="menuitem"
            aria-current={active ? 'true' : undefined}
            className={`acct-row${active ? ' is-active' : ''}`}
            data-testid={`acct-row-${item.user.username}`}
            onClick={() => {
              if (active) return;
              handleSwitchAccount(item.token);
            }}
          >
            <span className="acct-row__avatar" aria-hidden="true">
              {initialOf(item.user.displayName)}
            </span>
            <span className="acct-row__text">
              <span className="acct-row__name">{item.user.displayName}</span>
              <span className="acct-row__id">@{item.user.username}</span>
            </span>
            {active && <CheckOutlined className="acct-row__check" aria-hidden="true" />}
          </button>
        );
      })}

      <div className="acct-pop__sep" aria-hidden="true" />
      <button
        type="button"
        role="menuitem"
        className="acct-row acct-row--action"
        onClick={() => {
          setAccountMenuOpen(false);
          navigate('/login?add=1');
        }}
      >
        <UserAddOutlined aria-hidden="true" />
        <span>添加账号</span>
        <span className="acct-row__hint">免邀请码</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="acct-row acct-row--action"
        onClick={() => {
          setAccountMenuOpen(false);
          setSettingsOpen(true);
        }}
      >
        <SettingOutlined aria-hidden="true" />
        <span>账号与安全</span>
      </button>
      <div className="acct-pop__sep" aria-hidden="true" />
      <button
        type="button"
        role="menuitem"
        className="acct-row acct-row--action acct-row--danger"
        onClick={() => {
          setAccountMenuOpen(false);
          void handleLogout();
        }}
      >
        <LogoutOutlined aria-hidden="true" />
        <span>退出当前账号</span>
      </button>
    </div>
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  /**
   * 发送失败要「上浮」到用户眼前：之前失败原因只在回放日志里，
   * 用户看到消息变成「发送失败」却不知道原因。这里用 error toast 带一句可读原因，
   * 并提供「查看详情」直接跳到该消息（详情页同样展示失败原因 + 重试按钮）。
   */
  const sendFailure = state.sendFailure;
  useEffect(() => {
    if (!sendFailure) return;
    // 失败原因若带「改用 identity=user」建议，要按该平台本人身份是否已连接来分支（NEW-P2-3）
    const snapshot = store.getSnapshot();
    const failedMessage = snapshot.messages.find((m) => m.traceId === sendFailure.traceId);
    const failedAccount = failedMessage
      ? snapshot.accounts.find((a) => a.platform === failedMessage.platform)
      : undefined;
    const readableReason = sendFailure.reason
      ? formatSendError(sendFailure.reason, failedAccount?.identity)
      : '';
    const reason = readableReason
      ? clamp(readableReason, 60)
      : '具体原因见消息详情或全链路回放';
    message.error(
      <span className="failure-toast">
        <span>发送失败：{reason}</span>
        <Button
          type="link"
          size="small"
          className="failure-toast__link"
          onClick={() => {
            store.dismissSendFailure();
            navigate(`/inbox/${sendFailure.traceId}`);
          }}
        >
          查看详情
        </Button>
      </span>,
      8,
    );
    // 已弹出即清掉，避免同一次失败在重渲染时重复提示
    store.dismissSendFailure();
  }, [sendFailure, message, navigate]);

  // 偏好落到 <html data-*> 上，交给 CSS 生效（密度 / 动效）
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = prefs.density;
    root.dataset.motion = prefs.motion;
  }, [prefs.density, prefs.motion]);

  // 滚动条「滚动时才出现」：全局捕获监听，给正在滚动的容器打 .is-scrolling
  useEffect(() => installScrollIndicator(), []);

  const counts = useMemo(() => {
    // 收件箱角标 = 未读数（阅读状态），不再用「未终结条数」——
    // 那个口径会让人误以为「角标 4 但其实都看过了」。
    // 自己发出的消息（含钉钉回声）不算未读：会话列表里它们不产生角标。
    const inbox = state.messages.filter((m) => m.direction !== 'out' && !m.readAt).length;
    const todos = state.messages.filter((m) => m.type === 'todo' && !m.done).length;
    // 接入平台分组：角标是**未读**，不是「该平台总条数」。
    // 统计总条数会导致角标永远不消失（点开也还在），和「未读」语义冲突。
    const perPlatform = new Map<Platform, number>();
    for (const m of state.messages) {
      if (m.direction === 'out' || m.readAt) continue;
      perPlatform.set(m.platform, (perPlatform.get(m.platform) ?? 0) + 1);
    }
    return { inbox, todos, perPlatform };
  }, [state.messages]);

  /**
   * 新消息提醒：应用内 toast + 系统通知（Windows / macOS 通知中心）。
   *  - 只提醒「入站」：自己发出的消息与钉钉回声永不弹窗；
   *  - 首屏已有历史不提醒，只有真正新到的才算；
   *  - 同一会话本批多条合并为一条通知，最多提醒 3 个会话，避免刷屏。
   */
  const seenInbound = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (state.loading) return;
    const inbound = state.messages.filter((m) => m.direction !== 'out');
    if (seenInbound.current === null) {
      seenInbound.current = new Set(inbound.map((m) => m.traceId));
      return;
    }
    const seen = seenInbound.current;
    const fresh = inbound.filter((m) => !seen.has(m.traceId) && !m.readAt);
    for (const m of inbound) seen.add(m.traceId);
    if (fresh.length === 0) return;

    const byConv = new Map<string, UnifiedMessage[]>();
    for (const m of fresh) {
      const key = conversationKey(m);
      const list = byConv.get(key);
      if (list) list.push(m);
      else byConv.set(key, [m]);
    }

    void (async () => {
      await ensureNotificationPermission();
      let shown = 0;
      for (const [key, list] of byConv) {
        if (shown >= 3) break;
        shown += 1;
        const last = list[list.length - 1];
        const title =
          last.conversation?.type === 'group' && last.conversation.title
            ? last.conversation.title
            : last.sender.name;
        const body = clamp(last.body, 40);
        showSystemNotification({ title, count: list.length, body, tag: key });
        // 应用内兜底：系统通知被拒或被专注助手拦截时，至少应用里能看见
        message.info(`${title}：${body}`);
      }
    })();
  }, [state.messages, state.loading, message]);

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

  /** 平台导航：点一下 = 进收件箱 + 把渠道筛选切到该平台（复用既有筛选能力，不是新造的假入口） */
  const openPlatform = (platform: Platform) => {
    store.setFilters({ platform });
    navigate('/inbox');
  };
  const activePlatform =
    location.pathname.startsWith('/inbox') ? state.filters.platform : undefined;

  /* 高光不按「每个 item 各自画背景」，而是导航里独一块，位置从真实 DOM 量出来；
     切换时外层用带过冲的弹簧曲线平移、内层重放一次轻微挤压，合起来就是果冻感。 */
  const navRef = useRef<HTMLElement | null>(null);
  const navItems = useRef(new Map<string, HTMLElement>());
  const [navGlow, setNavGlow] = useState<GlowBox>(null);
  const [platformGlow, setPlatformGlow] = useState<GlowBox>(null);
  const [glowReady, setGlowReady] = useState(false);

  const registerNavItem = (key: string) => (el: HTMLElement | null) => {
    if (el) navItems.current.set(key, el);
    else navItems.current.delete(key);
  };

  const measureGlow = useCallback((key: string | null): GlowBox => {
    const nav = navRef.current;
    if (!nav || !key) return null;
    const el = navItems.current.get(key);
    if (!el) return null;
    const navRect = nav.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return { top: rect.top - navRect.top + nav.scrollTop, height: rect.height };
  }, []);

  /** 导航高光：只由路由决定（收件箱 / 待办 / 回放 / 连接账号 / 平台账号） */
  const activeNavKey = navKeyOf(location.pathname);
  /** 平台高光：只由收件箱的渠道筛选决定；「全部」时为 null → 这块高光消失 */
  const activePlatformKey = activePlatform ? `platform:${activePlatform}` : null;

  useLayoutEffect(() => {
    setNavGlow(measureGlow(activeNavKey));
    setPlatformGlow(measureGlow(activePlatformKey));
  }, [
    activeNavKey,
    activePlatformKey,
    counts.inbox,
    counts.todos,
    counts.perPlatform,
    compact,
    measureGlow,
  ]);

  /* 首帧不做位移动画：让高光直接出现在目标上，之后才启用弹簧过渡 */
  useEffect(() => {
    if ((!navGlow && !platformGlow) || glowReady) return;
    const id = requestAnimationFrame(() => setGlowReady(true));
    return () => cancelAnimationFrame(id);
  }, [navGlow, platformGlow, glowReady]);

  /* 窗口缩放 / 字体变化会让导航项高度变，两块高光都要跟着重新量 */
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setNavGlow(measureGlow(activeNavKey));
      setPlatformGlow(measureGlow(activePlatformKey));
    });
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeNavKey, activePlatformKey, measureGlow]);

  /** 顺序与收件箱的渠道筛选条保持一致（全部 → 飞书 → 钉钉 → 邮箱 → 微信），
      两处顺序不同会让人以为是两套不同的入口 */
  const platformNav = useMemo(
    () =>
      [Platform.FEISHU, Platform.DINGTALK, Platform.MAIL, Platform.WECHAT].map((platform) => ({
        platform,
        name:
          PLATFORM_META[platform].name,
        count: counts.perPlatform.get(platform) ?? 0,
      })),
    [counts.perPlatform],
  );

  return (
    <div className="app-shell">
      <aside className="side">
        <div className="side__brand">
          {/* 个人头像占据品牌位：保持「头像入侧栏」，同时保留品牌文字 */}
          <Tooltip title={`${profile.name} · 个人设置`} placement="right" mouseEnterDelay={0.22}>
            <button
              className="avatar-btn side__avatar"
              type="button"
              aria-label="打开个人设置"
              style={{ '--avatar-tone': profile.tone } as CSSProperties}
              onClick={() => setSettingsOpen(true)}
            >
              <Avatar
                size={32}
                className="brand-avatar"
                src={profile.avatarUrl ?? undefined}
              >
                {initialOf(profile.name)}
              </Avatar>
            </button>
          </Tooltip>
          <span className="side__brand-text">
            <strong>LinkHub</strong>
            <small>统一消息中心</small>
          </span>
        </div>

        <nav className="side__nav" aria-label="主导航" ref={navRef}>
          {/* 导航组高光（第 1、3 组共用）：品牌色 */}
          <span
            className={`side__glow side__glow--nav${glowReady ? ' is-ready' : ''}`}
            style={
              navGlow
                ? {
                    transform: `translate3d(0, ${navGlow.top}px, 0)`,
                    height: `${navGlow.height}px`,
                  }
                : undefined
            }
            aria-hidden="true"
          >
            {/* key 随选中项变化 → 挤压动画每次切换都重放一次 */}
            <i className="side__glow-fill" key={`nav:${activeNavKey}`} />
          </span>

          {/* 平台组高光：每个平台一种颜色，选「全部」时不渲染 */}
          {activePlatformKey && (
            <span
              className={`side__glow side__glow--platform${glowReady ? ' is-ready' : ''}`}
              data-platform={activePlatform}
              style={
                platformGlow
                  ? {
                      transform: `translate3d(0, ${platformGlow.top}px, 0)`,
                      height: `${platformGlow.height}px`,
                    }
                  : undefined
              }
              aria-hidden="true"
            >
              <i className="side__glow-fill" key={activePlatformKey} />
            </span>
          )}

          <div className="side__group">
            <SideLink
              to="/inbox"
              icon={<InboxOutlined />}
              label="收件箱"
              count={counts.inbox}
              itemRef={registerNavItem('to:/inbox')}
              focused={activeNavKey === 'to:/inbox'}
            />
            <SideLink
              to="/todos"
              icon={<CheckSquareOutlined />}
              label="待办"
              count={counts.todos}
              itemRef={registerNavItem('to:/todos')}
              focused={activeNavKey === 'to:/todos'}
            />
            <SideLink
              to="/trace"
              icon={<HistoryOutlined />}
              label="全链路回放"
              itemRef={registerNavItem('to:/trace')}
              focused={activeNavKey === 'to:/trace'}
            />
            <SideLink
              to="/auto-reply"
              icon={<ThunderboltOutlined />}
              label="自动回复"
              itemRef={registerNavItem('to:/auto-reply')}
              focused={activeNavKey === 'to:/auto-reply'}
            />
            <SideLink
              to="/stats"
              icon={<BarChartOutlined />}
              label="看板"
              itemRef={registerNavItem('to:/stats')}
              focused={activeNavKey === 'to:/stats'}
            />
          </div>

          <div className="side__group">
            <span className="side__group-label">接入平台</span>
            {platformNav.map((item) => {
              const active = activePlatform === item.platform;
              const focused = activePlatformKey === `platform:${item.platform}`;
              return (
                <Tooltip
                  key={item.platform}
                  title={item.name}
                  placement="right"
                  mouseEnterDelay={0.18}
                >
                  <button
                    ref={registerNavItem(`platform:${item.platform}`)}
                    type="button"
                    className={`side-link side-link--platform${active ? ' is-active' : ''}${focused ? ' is-focus-platform' : ''}`}
                    aria-label={item.name}
                    aria-pressed={active}
                    onClick={() => openPlatform(item.platform)}
                  >
                    <span
                      className={`side-link__icon side-link__icon--glyph is-${item.platform}`}
                      aria-hidden="true"
                    >
                      <PlatformGlyph platform={item.platform} size={15} />
                    </span>
                    <span className="side-link__label">{item.name}</span>
                    {item.count > 0 && <span className="side-link__count">{item.count}</span>}
                  </button>
                </Tooltip>
              );
            })}
          </div>

          <div className="side__group">
            <SideLink
              to="/connect"
              icon={<LinkOutlined />}
              label="连接账号"
              itemRef={registerNavItem('to:/connect')}
              focused={activeNavKey === 'to:/connect'}
            />
            <SideLink
              to="/accounts"
              icon={<ApiOutlined />}
              label="平台账号"
              itemRef={registerNavItem('to:/accounts')}
              focused={activeNavKey === 'to:/accounts'}
            />
          </div>
        </nav>

        <div className="side__foot">
          {/* 账号：多开入口。点开就是本机所有账号 —— 点谁切谁，最后一项退到登录页 */}
          {session ? (
            <Popover
              content={accountMenuBody}
              trigger="click"
              placement="rightBottom"
              arrow={false}
              open={accountMenuOpen}
              onOpenChange={setAccountMenuOpen}
              overlayClassName="acct-pop-overlay"
            >
              <button
                className="side-link side-link--plain side-account"
                type="button"
                aria-label={`当前用户 ${session.user.displayName}，打开账号菜单`}
                aria-haspopup="menu"
                data-testid="account-menu-trigger"
              >
                <span className="side-link__icon side-account__badge" aria-hidden="true">
                  {initialOf(session.user.displayName)}
                </span>
                <span className="side-link__label">{session.user.displayName}</span>
                {sessions.length > 1 && (
                  <span className="side-account__more" aria-hidden="true">
                    +{sessions.length - 1}
                  </span>
                )}
              </button>
            </Popover>
          ) : (
            <button
              className="side-link side-link--plain"
              type="button"
              aria-label="登录或注册"
              onClick={() => navigate('/login')}
            >
              <span className="side-link__icon" aria-hidden="true">
                <LoginOutlined />
              </span>
              <span className="side-link__label">登录</span>
            </button>
          )}

          <button
            className="side-link side-link--plain"
            type="button"
            aria-label="个人设置"
            onClick={() => setSettingsOpen(true)}
          >
            <span className="side-link__icon" aria-hidden="true">
              <SettingOutlined />
            </span>
            <span className="side-link__label">设置</span>
          </button>

          <Tooltip title={`${footer.badge} · ${footer.text}`} placement="right">
            <span
              className={`side-status side-status--${footer.tone === 'ok' ? 'ok' : footer.tone}`}
              role="status"
              aria-label={`${footer.badge}：${footer.text}`}
            >
              <span className="side-status__dot" />
              <span className="side-status__text">{footerShortLabel(footer)}</span>
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

          {/* 搜索居中：顶栏只留一个入口，真正的搜索在 ⌘K 面板里 */}
          <div className="cmdbar__search">
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
          </div>

          <div className="cmdbar__actions">
            {state.demoMode && (
              <Dropdown menu={demoMenu} trigger={['click']}>
                <button className="demo-btn" type="button">
                  <ThunderboltOutlined /> 演示 <DownOutlined className="demo-btn__caret" />
                </button>
              </Dropdown>
            )}

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

            {/* 主动发送是最重的操作：收在右侧最末端，用系统内的低饱和主按钮色 */}
            <Tooltip title="从统一入口向指定平台发送文本或文件">
              <button
                className="cmdbar__compose"
                type="button"
                onClick={() => setComposeOpen(true)}
                aria-label="新建发送"
                data-testid="open-compose"
              >
                <SendOutlined />
                新建发送
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
              message={needsLogin ? '需要重新登录' : '数据加载异常'}
              description={
                needsLogin ? (
                  <div>登录状态已失效，重新登录就能继续使用，消息不会丢。</div>
                ) : (
                  <div className="alert-detail">
                    <div>{state.error}</div>
                    <div className="alert-detail__hint">{ERROR_HINTS}</div>
                    <details className="alert-detail__dev">
                      <summary>给技术同事的排查线索</summary>
                      <div>{ERROR_HINTS_DEV}</div>
                    </details>
                  </div>
                )
              }
              action={
                needsLogin ? (
                  <Button size="small" type="primary" onClick={() => navigate('/login')}>
                    重新登录
                  </Button>
                ) : undefined
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
      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        /**
         * 发完直接跳到「刚发出去的那条消息」所在会话。
         * 不跳的话，用户在 A 对话框里发到 B 会话，会以为消息没发出去。
         */
        onSent={(taskId) => navigate(`/inbox/${encodeURIComponent(taskId)}`)}
      />
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
            to="/connect"
            className={({ isActive }) => `mobile-nav__item${isActive ? ' is-active' : ''}`}
          >
            <LinkOutlined />
            <span>连接</span>
          </NavLink>
          <NavLink
            to="/todos"
            className={({ isActive }) => `mobile-nav__item${isActive ? ' is-active' : ''}`}
          >
            <CheckSquareOutlined />
            <span>待办</span>
          </NavLink>
          <NavLink
            to="/auto-reply"
            className={({ isActive }) => `mobile-nav__item${isActive ? ' is-active' : ''}`}
          >
            <ThunderboltOutlined />
            <span>自动回复</span>
          </NavLink>
          <NavLink
            to="/stats"
            className={({ isActive }) => `mobile-nav__item${isActive ? ' is-active' : ''}`}
          >
            <BarChartOutlined />
            <span>看板</span>
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
