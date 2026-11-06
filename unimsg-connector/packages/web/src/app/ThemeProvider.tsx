import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { buildTheme, type ThemeMode } from './theme';

/**
 * 明暗双主题装配点。
 *
 * 约定：
 *  - 偏好可以是 light / dark / system（跟随系统）；实际生效主题由「偏好 + 系统偏好」算出；
 *  - 主题写入 <html data-theme="light|dark">，app.css 用 [data-theme='dark'] 覆盖 CSS 变量；
 *  - AntD 通过 buildTheme(mode) 切换 defaultAlgorithm / darkAlgorithm；
 *  - 偏好持久化到 localStorage，首次访问默认跟随系统；
 *  - 切换时用 View Transition 做「水波从中心扩散」的圆形揭示（不支持则直接切，尊重 reduced-motion）。
 */

const STORAGE_KEY = 'linkhub-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  /** 实际生效的主题 */
  mode: ThemeMode;
  /** 用户偏好（可能是 system） */
  preference: ThemePreference;
  setPreference: (preference: ThemePreference, origin?: { x: number; y: number }) => void;
  setMode: (mode: ThemeMode, origin?: { x: number; y: number }) => void;
  toggle: (origin?: { x: number; y: number }) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Chrome 111+ 支持；TS 的 lib.dom 里还不一定有，这里只声明用到的部分 */
interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
}
type DocumentWithTransition = Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionLike;
};

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(DARK_QUERY).matches;
}

function readInitialPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  // 支持 ?theme=dark / ?theme=light 深链接（演示与截图用），优先级高于本地偏好
  try {
    const forced = new URLSearchParams(window.location.search).get('theme');
    if (forced === 'light' || forced === 'dark') return forced;
  } catch {
    // 忽略 URL 解析异常
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    // localStorage 被禁用时静默回退
  }
  return 'system';
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(REDUCE_QUERY).matches;
}

/** 同步把主题落到 <html> 上：View Transition 的快照必须在这一帧就拿到新配色 */
function applyTheme(mode: ThemeMode, preference: ThemePreference) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // 忽略隐私模式下的写入失败
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readInitialPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // 跟随系统时，监听系统配色变化
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(DARK_QUERY);
    const sync = () => setSystemDark(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  const mode: ThemeMode = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    applyTheme(mode, preference);
  }, [mode, preference]);

  const setPreference = useCallback((next: ThemePreference, origin?: { x: number; y: number }) => {
    const nextMode: ThemeMode =
      next === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : next;

    const doc = document as DocumentWithTransition;
    const sameTheme = document.documentElement.dataset.theme === nextMode;
    if (typeof doc.startViewTransition !== 'function' || prefersReducedMotion() || sameTheme) {
      setPreferenceState(next);
      return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    // 默认从视口正中向外扩散；传 origin 则从该点扩散
    const x = origin?.x ?? width / 2;
    const y = origin?.y ?? height / 2;
    const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));

    try {
      const transition = doc.startViewTransition(() => {
        flushSync(() => {
          applyTheme(nextMode, next);
          setPreferenceState(next);
        });
      });

      transition.ready
        .then(() => {
          document.documentElement.animate(
            {
              clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
            },
            {
              duration: 620,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              pseudoElement: '::view-transition-new(root)',
            },
          );
        })
        .catch(() => {
          // 动画被打断（快速连点）时忽略即可，主题已切换
        });
    } catch {
      // 浏览器不支持或被禁用时的兜底
      setPreferenceState(next);
    }
  }, []);

  const setMode = useCallback(
    (next: ThemeMode, origin?: { x: number; y: number }) => setPreference(next, origin),
    [setPreference],
  );

  const toggle = useCallback(
    (origin?: { x: number; y: number }) => setPreference(mode === 'light' ? 'dark' : 'light', origin),
    [mode, setPreference],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, preference, setPreference, setMode, toggle }),
    [mode, preference, setPreference, setMode, toggle],
  );
  const antdTheme = useMemo(() => buildTheme(mode), [mode]);

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider locale={zhCN} theme={antdTheme} button={{ autoInsertSpace: false }}>
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 ThemeProvider 内使用');
  return ctx;
}
