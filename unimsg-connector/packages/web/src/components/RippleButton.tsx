import { useCallback, useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, KeyboardEvent, PointerEvent } from 'react';

type Wave = { id: number; x: number; y: number; size: number };

/**
 * 水波纹按钮：波纹从**指针落点**扩散，而不是从控件中心。
 *
 * 关键点：
 *  - 用 `pointerdown` 取 `clientX/clientY`，换算成相对按钮的坐标 → 点哪波纹从哪散开；
 *  - 半径取「落点到最远角」的距离，保证波纹一定能铺满整个按钮；
 *  - 键盘触发（Enter / Space）没有坐标，回退到中心点；
 *  - 动画结束后从状态中移除，避免节点堆积。
 */
export function RippleButton({
  children,
  className = '',
  loading = false,
  disabled = false,
  variant = 'solid',
  onPointerDown,
  onKeyDown,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: 'solid' | 'soft';
}) {
  const [waves, setWaves] = useState<Wave[]>([]);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    },
    [],
  );

  const pushWave = useCallback((clientX: number, clientY: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const x = clientX === 0 && clientY === 0 ? rect.width / 2 : clientX - rect.left;
    const y = clientX === 0 && clientY === 0 ? rect.height / 2 : clientY - rect.top;
    const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));

    const id = ++seq.current;
    // 只保留最近 4 圈，防连点堆积
    setWaves((prev) => [...prev.slice(-3), { id, x, y, size: radius * 2 }]);

    const timer = window.setTimeout(() => {
      setWaves((prev) => prev.filter((w) => w.id !== id));
    }, 960);
    timers.current.push(timer);
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    // 只响应主键 / 触摸；右键与中键不该出水波
    if (event.button === 0 && !disabled && !loading) {
      pushWave(event.clientX, event.clientY, event.currentTarget);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if ((event.key === 'Enter' || event.key === ' ') && !disabled && !loading) {
      const rect = event.currentTarget.getBoundingClientRect();
      pushWave(rect.left + rect.width / 2, rect.top + rect.height / 2, event.currentTarget);
    }
  };

  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      className={`ripple-btn ripple-btn--${variant}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      {loading && <span className="ripple-btn__spinner" aria-hidden="true" />}
      <span className="ripple-btn__label">{children}</span>
      {waves.map((wave) => (
        <span
          key={wave.id}
          className="ripple-btn__wave"
          aria-hidden="true"
          style={{
            left: wave.x,
            top: wave.y,
            width: wave.size,
            height: wave.size,
            marginLeft: -wave.size / 2,
            marginTop: -wave.size / 2,
          }}
        />
      ))}
    </button>
  );
}
