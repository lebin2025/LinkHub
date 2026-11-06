import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiOutlined,
  BgColorsOutlined,
  CheckSquareOutlined,
  ClearOutlined,
  HistoryOutlined,
  InboxOutlined,
  MessageOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useAppState } from '../hooks/useAppState';
import { useTheme } from '../app/ThemeProvider';
import { store } from '../store';
import { Platform } from '../types';
import { PLATFORM_META, clamp, formatRelative, shortTrace } from '../utils/format';

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  kbd?: string;
  run: () => void;
}

/**
 * ⌘K 命令面板：顶栏不再常驻搜索框，把「搜索消息 / 跳转页面 / 执行动作」收进一个浮层。
 *
 * 键盘：↑ ↓ 选择、Enter 执行、Esc 关闭。
 * 消息搜索匹配发送人、正文与 traceId，最多取 6 条，避免面板变成第二个列表。
 */
export function CommandPalette({
  open,
  onClose,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const state = useAppState();
  const navigate = useNavigate();
  const { mode, toggle } = useTheme();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  const go = useCallback(
    (path: string) => {
      navigate(path);
      onClose();
    },
    [navigate, onClose],
  );

  const commands = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [
      { id: 'nav-inbox', group: '跳转', label: '收件箱', icon: <InboxOutlined />, run: () => go('/inbox') },
      { id: 'nav-todos', group: '跳转', label: '待办', icon: <CheckSquareOutlined />, run: () => go('/todos') },
      { id: 'nav-trace', group: '跳转', label: '全链路回放', icon: <HistoryOutlined />, run: () => go('/trace') },
      { id: 'nav-accounts', group: '跳转', label: '平台账号', icon: <ApiOutlined />, run: () => go('/accounts') },
      {
        id: 'settings',
        group: '跳转',
        label: '个人设置',
        icon: <SettingOutlined />,
        run: () => {
          onClose();
          onOpenSettings();
        },
      },
      {
        id: 'theme',
        group: '动作',
        label: mode === 'dark' ? '切换到明色' : '切换到暗色',
        icon: <BgColorsOutlined />,
        kbd: 'T',
        run: () => {
          toggle();
          onClose();
        },
      },
      {
        id: 'reset',
        group: '动作',
        label: '清空筛选条件',
        icon: <ClearOutlined />,
        run: () => {
          store.resetFilters();
          go('/inbox');
        },
      },
    ];

    if (state.demoMode) {
      list.push(
        {
          id: 'demo-incoming',
          group: '演示',
          label: '模拟平台推送一条新消息',
          icon: <ThunderboltOutlined />,
          run: () => {
            void store.simulateIncoming();
            onClose();
          },
        },
        {
          id: 'demo-fail',
          group: '演示',
          label: '让下一次回复失败（DLQ）',
          icon: <ThunderboltOutlined />,
          run: () => {
            store.armFailure();
            onClose();
          },
        },
      );
    }

    const platforms: Array<{ value?: Platform; label: string }> = [
      { value: undefined, label: '全部平台' },
      { value: Platform.FEISHU, label: PLATFORM_META[Platform.FEISHU].name },
      { value: Platform.DINGTALK, label: PLATFORM_META[Platform.DINGTALK].name },
      { value: Platform.WECOM, label: PLATFORM_META[Platform.WECOM].name },
      { value: Platform.MAIL, label: PLATFORM_META[Platform.MAIL].name },
    ];

    platforms.forEach((p) => {
      list.push({
        id: `platform-${p.label}`,
        group: '筛选',
        label: `只看 ${p.label}`,
        icon: <SearchOutlined />,
        run: () => {
          store.setFilters({ platform: p.value });
          go('/inbox');
        },
      });
    });

    return list;
  }, [go, mode, onClose, onOpenSettings, state.demoMode, toggle]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const matchedCommands = q
      ? commands.filter((c) => c.label.toLowerCase().includes(q))
      : commands;

    const matchedMessages: PaletteItem[] = q
      ? state.messages
          .filter((m) => {
            const haystack = `${m.sender.name} ${m.body} ${m.traceId}`.toLowerCase();
            return haystack.includes(q);
          })
          .slice(0, 6)
          .map((m) => ({
            id: `msg-${m.traceId}`,
            group: '消息',
            label: `${m.sender.name}：${clamp(m.body, 42)}`,
            hint: `${PLATFORM_META[m.platform].name} · ${formatRelative(m.createdAt)} · ${shortTrace(m.traceId)}`,
            icon: <MessageOutlined />,
            run: () => go(`/inbox/${m.traceId}`),
          }))
      : [];

    return [...matchedMessages, ...matchedCommands];
  }, [commands, go, query, state.messages]);

  // 打开时重置并聚焦；关闭时把焦点还给原来的元素
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    setQuery('');
    setIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (open) return;
    const el = restoreRef.current as HTMLElement | null;
    el?.focus?.();
  }, [open]);

  useEffect(() => {
    setIndex((current) => (current >= items.length ? 0 : current));
  }, [items.length]);

  // 让高亮项始终留在可视区域
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('.cmdk__item.is-active');
    active?.scrollIntoView({ block: 'nearest' });
  }, [index, items.length]);

  if (!open) return null;

  const runAt = (i: number) => {
    const item = items[i];
    if (item) item.run();
  };

  let lastGroup = '';

  return (
    <div
      className="cmdk"
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk__panel">
        <div className="cmdk__search">
          <SearchOutlined />
          <input
            ref={inputRef}
            className="cmdk__input"
            value={query}
            placeholder="搜索消息、跳转页面、执行动作…"
            aria-label="搜索"
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => (items.length ? (i + 1) % items.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runAt(index);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <div className="cmdk__list" ref={listRef} role="listbox" aria-label="可执行项">
          {items.length === 0 && <div className="cmdk__empty">没有匹配项</div>}
          {items.map((item, i) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {showGroup && <div className="cmdk__group">{item.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  className={`cmdk__item${i === index ? ' is-active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={item.run}
                >
                  <span className="cmdk__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="cmdk__text">
                    <span className="cmdk__label">{item.label}</span>
                    {item.hint && <span className="cmdk__hint">{item.hint}</span>}
                  </span>
                  {item.kbd && <kbd className="kbd">{item.kbd}</kbd>}
                </button>
              </div>
            );
          })}
        </div>

        <div className="cmdk__foot">
          <span>
            <kbd className="kbd">j</kbd>
            <kbd className="kbd">k</kbd> 切换
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> 打开
          </span>
          <span>
            <kbd className="kbd">R</kbd> 回复
          </span>
          <span>
            <kbd className="kbd">E</kbd> 完成
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> 收起
          </span>
        </div>
      </div>
    </div>
  );
}
