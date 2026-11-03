/**
 * 首启引导：真实后端已连上、但还没有收到任何消息时，给出「3 步上手」。
 *
 * 设计约束（为了零学习成本 + 可独立单测）：
 *  - 纯 props 驱动：不直接读 store，页面负责把 AppState 的关键字段传进来；
 *  - localStorage 可注入：key = linkhub.firstRunDismissed，默认 window.localStorage，
 *    读写失败（隐私模式 / 沙箱）一律降级为「未关闭」，绝不阻塞渲染；
 *  - 显示条件严格：非 Mock 演示 + 0 条消息 + 后端从未收到消息 + 未点过「知道了」；
 *    加载中 / 加载失败也不显示（失败时不能谎称「后端已连上」）。
 *    真实后端有消息、或前端 Mock 模式，都不显示。
 */
import { useState } from 'react';
import { Button, Card, Tag, Typography } from 'antd';
import { ArrowRightOutlined, RocketOutlined } from '@ant-design/icons';
import type { AccountInfo } from '../services/api';
import type { RealtimeStatus } from '../services/realtime';
import { Platform } from '../types';
import { PLATFORM_META } from '../utils/format';

/** 「知道了」标记的 localStorage key（测试需在前后清理） */
export const FIRST_RUN_DISMISS_KEY = 'linkhub.firstRunDismissed';

/** 冒烟脚本默认后端地址：VITE_API_BASE 未配置成绝对地址时的回退值 */
export const DEFAULT_SMOKE_BASE = 'http://127.0.0.1:3001';

/** 可注入的最小存储接口：测试传内存实现即可，不依赖 jsdom 的 localStorage */
export type FirstRunStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** 四类数据源的展示顺序（与侧边栏 / 账号页一致） */
const PLATFORM_ORDER: Platform[] = [Platform.FEISHU, Platform.DINGTALK, Platform.WECOM, Platform.MAIL];

/** 本次实际通道：real=真实接口，mock=本地模拟（Mock 绝不伪装成真实成功） */
const MODE_META: Record<string, { label: string; color: string }> = {
  real: { label: '真实接口', color: 'success' },
  mock: { label: 'Mock 模拟', color: 'warning' },
};

/** 实时连接状态：说「后端已连上」的同时如实展示连接质量 */
const CONNECTION_META: Record<RealtimeStatus, { label: string; color: string }> = {
  connected: { label: '实时连接正常', color: 'success' },
  reconnecting: { label: '实时连接重连中', color: 'warning' },
  offline: { label: '实时连接已断开', color: 'error' },
};

const COPY_TOOLTIPS: [string, string] = ['复制命令', '已复制'];

/** 默认存储：localStorage 在隐私模式 / SSR 下可能抛错，读取失败按「未关闭」处理 */
function defaultStorage(): FirstRunStorage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** 读取「知道了」标记；存储不可用或抛错时按未关闭处理（引导优先展示） */
export function readFirstRunDismissed(storage?: FirstRunStorage): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(FIRST_RUN_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** 空首启判定（与「知道了」无关）：真实后端 + 收件箱为空 + 后端从未收到消息 */
export function isEmptyFirstRun(input: {
  demoMode: boolean;
  messageCount: number;
  received: number;
}): boolean {
  return !input.demoMode && input.messageCount === 0 && input.received === 0;
}

/** 显示条件（严格）：空首启 && 用户没点过「知道了」 */
export function shouldShowFirstRun(input: {
  demoMode: boolean;
  messageCount: number;
  received: number;
  dismissed: boolean;
}): boolean {
  return isEmptyFirstRun(input) && !input.dismissed;
}

/** 冒烟命令里的后端地址：优先用实际 VITE_API_BASE；相对路径（同源部署）回退默认端口 */
export function smokeBaseUrl(apiBase?: string): string {
  const base = (apiBase ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(base) ? base : DEFAULT_SMOKE_BASE;
}

/** 可一键复制的命令行（Typography.Text copyable，命令本身也可见可选中） */
function Command({ text }: { text: string }) {
  return (
    <Typography.Text className="first-run-guide__cmd" code copyable={{ text, tooltips: COPY_TOOLTIPS }}>
      {text}
    </Typography.Text>
  );
}

export interface FirstRunGuideProps {
  /** 前端 Mock 演示模式（true 时永不显示） */
  demoMode: boolean;
  /** 当前收件箱消息数（>0 时说明已有数据，不显示） */
  messageCount: number;
  /** 后端健康指标 health.received（>0 时说明后端已收到过消息，不显示） */
  received: number;
  /** /api/accounts 的四平台通道状态（mode / missing 用于展示） */
  accounts: AccountInfo[];
  /** 实时连接状态（如实展示，不参与显示条件） */
  connection: RealtimeStatus;
  /** 可注入的本地存储（测试 / SSR 用）；默认 window.localStorage */
  storage?: FirstRunStorage;
  /** 实际后端地址（来自 VITE_API_BASE），用于生成可复制的冒烟命令 */
  apiBase?: string;
  /** 是否仍在加载：加载中不显示，避免数据未就绪时误报「空收件箱」 */
  loading?: boolean;
  /** 加载错误：请求失败时绝不显示（不能在后端不可用时谎称「后端已连上」） */
  error?: string | null;
  /** 打开「平台账号」页（不传则只显示文字指引，便于组件独立单测） */
  onOpenAccounts?: () => void;
}

export function FirstRunGuide({
  demoMode,
  messageCount,
  received,
  accounts,
  connection,
  storage,
  apiBase,
  loading = false,
  error = null,
  onOpenAccounts,
}: FirstRunGuideProps) {
  const resolvedStorage = storage ?? defaultStorage();
  const [dismissed, setDismissed] = useState(() => readFirstRunDismissed(resolvedStorage));

  // 诚实性优先：加载中/加载失败时不显示引导（失败时页面上方已有错误 Alert）
  if (loading || error) return null;
  if (!shouldShowFirstRun({ demoMode, messageCount, received, dismissed })) return null;

  const connectionMeta = CONNECTION_META[connection];
  const smokeCommand = `python scripts/smoke.py ${smokeBaseUrl(apiBase)}`;

  const handleDismiss = () => {
    try {
      resolvedStorage?.setItem(FIRST_RUN_DISMISS_KEY, '1');
    } catch {
      // 隐私模式 / 存储不可写时也不阻塞关闭：本次会话内隐藏即可
    }
    setDismissed(true);
  };

  return (
    <section className="first-run-guide" data-testid="first-run-guide" aria-label="首次上手引导">
      <Card
        className="first-run-guide__card"
        title={
          <span className="first-run-guide__card-title">
            <RocketOutlined /> 3 步上手
          </span>
        }
      >
        <div className="first-run-guide__lead">
          <span className="first-run-guide__lead-strong">后端已连上，但还没有消息</span>
          <span className="first-run-guide__lead-desc">
            收到第一条后，「接收 → 回复 → 回写 → 回流」的完整闭环会出现在这里。
          </span>
          <Tag color={connectionMeta.color} className="first-run-guide__connection">
            {connectionMeta.label}
          </Tag>
        </div>

        <div className="first-run-guide__modes" data-testid="first-run-modes">
          <span className="first-run-guide__modes-label">当前通道</span>
          {PLATFORM_ORDER.map((platform) => {
            const account = accounts.find((item) => item.platform === platform);
            const meta = PLATFORM_META[platform];
            const modeMeta = account?.mode ? MODE_META[account.mode] : undefined;
            const missing = account?.missing ?? [];
            return (
              <span
                className="first-run-guide__mode-item"
                key={platform}
                data-testid={`first-run-mode-${platform}`}
              >
                <Tag color={modeMeta?.color ?? 'default'}>
                  {meta.name} · {modeMeta?.label ?? '通道未知'}
                </Tag>
                {missing.length > 0 && (
                  <span className="first-run-guide__missing">缺 {missing.join('、')}</span>
                )}
              </span>
            );
          })}
        </div>

        <ol className="first-run-guide__steps">
          <li className="first-run-guide__step">
            <span className="first-run-guide__num">1</span>
            <div className="first-run-guide__step-body">
              <div className="first-run-guide__step-head">
                <span className="first-run-guide__step-title">想立刻看到效果</span>
                <Command text={smokeCommand} />
              </div>
              <div className="first-run-guide__step-desc">
                在 unimsg-connector/ 下执行：灌入三平台示例消息，跑通「接收 → 回复 → 回写 → 回流」。
              </div>
            </div>
          </li>

          <li className="first-run-guide__step">
            <span className="first-run-guide__num">2</span>
            <div className="first-run-guide__step-body">
              <div className="first-run-guide__step-head">
                <span className="first-run-guide__step-title">想接真实平台</span>
                <Command text="pnpm run doctor" />
              </div>
              <div className="first-run-guide__step-desc">
                在 unimsg-connector/ 下自检各平台模式 / 凭据 / 连通性；按 docs/swap-accounts.md 填好 .env
                后重启后端。
              </div>
            </div>
          </li>

          <li className="first-run-guide__step">
            <span className="first-run-guide__num">3</span>
            <div className="first-run-guide__step-body">
              <div className="first-run-guide__step-head">
                <span className="first-run-guide__step-title">想核对每个平台走了哪条通道</span>
                {onOpenAccounts ? (
                  <Button
                    type="link"
                    size="small"
                    className="first-run-guide__link"
                    onClick={onOpenAccounts}
                  >
                    查看平台账号 <ArrowRightOutlined />
                  </Button>
                ) : (
                  <span className="first-run-guide__step-desc">打开左侧「平台账号」页查看。</span>
                )}
              </div>
              <div className="first-run-guide__step-desc">
                账号页展示真实接口 / Mock 模拟、缺失变量与告警，方便一眼定位接入问题。
              </div>
            </div>
          </li>
        </ol>

        <div className="first-run-guide__start">
          <span className="first-run-guide__start-label">启动后端</span>
          <Command text="pnpm --filter @unimsg/server start" />
          <span className="first-run-guide__start-label">启动前端</span>
          <Command text="pnpm --filter @unimsg/web dev" />
        </div>

        <div className="first-run-guide__footer">
          <span className="first-run-guide__foot-hint">收到第一条消息后，这条引导会自动隐藏。</span>
          <Button size="small" onClick={handleDismiss}>
            知道了
          </Button>
        </div>
      </Card>
    </section>
  );
}
