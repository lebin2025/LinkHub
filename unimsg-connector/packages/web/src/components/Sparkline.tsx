import { useId } from 'react';
import { buildSparkline } from '../utils/sparkline';

/**
 * 迷你折线：只画"形状"，不放坐标轴。
 * 数据不足（<2 点）时返回 null —— 宁可不画，也不画一条假线。
 */
export function Sparkline({
  values,
  width = 148,
  height = 36,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  label: string;
}) {
  const gradientId = useId();
  const geo = buildSparkline(values, width, height);
  if (!geo) return null;

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="sparkline__stop sparkline__stop--top" />
          <stop offset="100%" className="sparkline__stop sparkline__stop--bottom" />
        </linearGradient>
      </defs>
      <path className="sparkline__area" d={geo.area} fill={`url(#${gradientId})`} />
      <polyline className="sparkline__line" points={geo.line} />
      <circle className="sparkline__dot" cx={geo.lastX} cy={geo.lastY} r={2.6} />
    </svg>
  );
}
