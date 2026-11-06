/**
 * 迷你折线（sparkline）的路径计算。
 *
 * 刻意做成纯函数：没有 DOM、没有时间，输入一串采样值就出 `polyline points` 和闭合的 `area` 路径，
 * 这样画出来的东西能被单测逐点验证，而不是"看着像是条线"。
 *
 * 边界处理（真实数据一定会遇到）：
 *  - 少于 2 个点 → 返回 null，前端就不画（不拿一个点硬凑成一条线）；
 *  - 所有值相同（没有流量）→ 画在中线上，如实表现"平的"，而不是除以 0 得到 NaN。
 */

export interface SparklineGeometry {
  /** polyline 用的 "x,y x,y" 串 */
  line: string;
  /** 面积填充用的闭合路径 */
  area: string;
  /** 最后一个点，用来画端点圆 */
  lastX: number;
  lastY: number;
  /** 采样区间的最小/最大值（用于文案） */
  min: number;
  max: number;
}

const round = (n: number): string => (Math.round(n * 100) / 100).toString();

export function buildSparkline(
  values: number[],
  width: number,
  height: number,
  pad = 3,
): SparklineGeometry | null {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);

  const xAt = (i: number) => pad + (i / (values.length - 1)) * innerW;
  // 值越大 y 越小（SVG 原点在左上）
  const yAt = (v: number) =>
    span === 0 ? pad + innerH / 2 : pad + innerH - ((v - min) / span) * innerH;

  const points = values.map((v, i) => `${round(xAt(i))},${round(yAt(v))}`);
  const line = points.join(' ');

  const baseline = height - pad;
  const area = `M${points[0]} L${points.slice(1).join(' L')} L${round(xAt(values.length - 1))},${round(
    baseline,
  )} L${round(xAt(0))},${round(baseline)} Z`;

  return {
    line,
    area,
    lastX: Number(round(xAt(values.length - 1))),
    lastY: Number(round(yAt(values[values.length - 1]))),
    min,
    max,
  };
}

/** 追加一个采样点并保持固定长度（旧点从头部丢掉） */
export function appendSample(series: number[], value: number, size: number): number[] {
  const next = [...series, value];
  return next.length > size ? next.slice(next.length - size) : next;
}
