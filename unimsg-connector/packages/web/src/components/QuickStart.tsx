/**
 * 空收件箱的「入口」而不是「说明书」。
 *
 * 设计取舍：空态最有价值的不是解释怎么用，而是**让人立刻看到一条真消息**。
 * 所以这里只放三颗按钮（飞书 / 钉钉 / 企微），点一下走真实入站链路灌一条示例。
 * 纯前端 Mock 模式下不假装有平台，只给一颗「灌入演示消息」。
 *
 * 底部的键位提示是唯一的文字：它是可操作信息，不是解释文案。
 */
import { useState } from 'react';
import { InboxOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { INJECT_PLATFORMS, type InjectPlatform } from '../services/demoSamples';
import { PLATFORM_META } from '../utils/format';

/** 键位提示：与 useHotkeys 绑定的一致 */
const KEYS: Array<[string, string]> = [
  ['j k', '切换'],
  ['Enter', '打开'],
  ['R', '回复'],
  ['E', '完成'],
  ['⌘K', '搜索'],
];

export function QuickStart({
  demoMode,
  onInject,
}: {
  demoMode: boolean;
  /** 注入一条样例；抛错由调用方提示。resolve 后按钮恢复可点 */
  onInject: (platform?: InjectPlatform) => Promise<void>;
}) {
  const [busy, setBusy] = useState<InjectPlatform | 'demo' | null>(null);

  const run = async (key: InjectPlatform | 'demo', platform?: InjectPlatform) => {
    if (busy) return;
    setBusy(key);
    try {
      await onInject(platform);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="quickstart" data-testid="quickstart">
      <span className="quickstart__icon" aria-hidden="true">
        <InboxOutlined />
      </span>
      <p className="quickstart__title">还没有收到消息</p>

      {demoMode ? (
        <button
          type="button"
          className="quickstart__chip"
          disabled={busy !== null}
          onClick={() => void run('demo')}
        >
          <ThunderboltOutlined />
          {busy === 'demo' ? '灌入中…' : '灌入一条演示消息'}
        </button>
      ) : (
        <div className="quickstart__grid">
          {INJECT_PLATFORMS.map((platform) => {
            const meta = PLATFORM_META[platform];
            return (
              <button
                key={platform}
                type="button"
                className="quickstart__chip"
                disabled={busy !== null}
                onClick={() => void run(platform, platform)}
              >
                <span
                  className="quickstart__dot"
                  style={{ background: meta.color }}
                  aria-hidden="true"
                />
                {busy === platform ? '注入中…' : meta.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="quickstart__keys">
        {KEYS.map(([key, label]) => (
          <span key={key} className="quickstart__key">
            <kbd className="kbd">{key}</kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
