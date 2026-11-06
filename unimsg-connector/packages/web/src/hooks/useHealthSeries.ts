/**
 * 健康指标的采样序列（给 sparkline 用）。
 *
 * 诚实性约束：后端没有时序接口，所以这里给的是**本次会话的实时采样**，
 * 不是"最近 24 小时"。因此：
 *  - 只在抽屉真的打开时采样（不做后台轮询）；
 *  - 每次采样前先拉一次 /api/health，拿的是当下真实值，不是缓存；
 *  - 采样点不足 3 个就不画（一个点连不成趋势）。
 */
import { useEffect, useRef, useState } from 'react';
import { store } from '../store';
import { appendSample } from '../utils/sparkline';

/** 采样间隔：10s × 48 点 ≈ 最近 8 分钟 */
export const HEALTH_SAMPLE_MS = 10_000;
export const HEALTH_SERIES_SIZE = 48;

export function useHealthSeries(value: number | undefined, active: boolean): number[] {
  const [series, setSeries] = useState<number[]>([]);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!active) return;

    // 打开瞬间先落一个点，再接节奏
    setSeries((prev) => (prev.length ? prev : appendSample(prev, latest.current ?? 0, HEALTH_SERIES_SIZE)));

    const id = window.setInterval(() => {
      // 先拉最新值，再落点；点取的是"刚刚问到的数"（直接读 store，避免读到上一次渲染的旧值）
      void store.refreshHealth().then(() => {
        const current = store.getSnapshot().health?.received ?? 0;
        setSeries((prev) => appendSample(prev, current, HEALTH_SERIES_SIZE));
      });
    }, HEALTH_SAMPLE_MS);

    return () => window.clearInterval(id);
  }, [active]);

  return series;
}
