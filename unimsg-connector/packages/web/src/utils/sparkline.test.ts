import { describe, expect, it } from 'vitest';
import { appendSample, buildSparkline } from './sparkline';

const W = 100;
const H = 40;
const PAD = 3;

describe('buildSparkline', () => {
  it('少于两点不画（一个点连不成趋势）', () => {
    expect(buildSparkline([], W, H)).toBeNull();
    expect(buildSparkline([7], W, H)).toBeNull();
  });

  it('点数量与采样数一致，首末点贴住左右内边距', () => {
    const geo = buildSparkline([0, 5, 9], W, H, PAD)!;
    const pts = geo.line.split(' ');
    expect(pts).toHaveLength(3);
    expect(pts[0].startsWith(`${PAD},`)).toBe(true);
    expect(pts[2].startsWith(`${W - PAD},`)).toBe(true);
  });

  it('值越大 y 越小（SVG 原点在左上）', () => {
    const geo = buildSparkline([1, 10], W, H, PAD)!;
    const [first, last] = geo.line.split(' ');
    const y1 = Number(first.split(',')[1]);
    const y2 = Number(last.split(',')[1]);
    expect(y2).toBeLessThan(y1);
  });

  it('全部相同 → 画在中线，不出现 NaN', () => {
    const geo = buildSparkline([4, 4, 4], W, H, PAD)!;
    const ys = geo.line.split(' ').map((p) => Number(p.split(',')[1]));
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBeCloseTo(PAD + (H - PAD * 2) / 2, 5);
    expect(geo.line).not.toContain('NaN');
  });

  it('面积路径闭合回到底边', () => {
    const geo = buildSparkline([2, 6, 4], W, H, PAD)!;
    expect(geo.area.startsWith('M')).toBe(true);
    expect(geo.area.endsWith('Z')).toBe(true);
    // 闭合前两个点是底边的左右两端
    expect(geo.area).toContain(`${W - PAD},${H - PAD}`);
    expect(geo.area).toContain(`${PAD},${H - PAD}`);
  });

  it('给出 min/max 与端点坐标（用于文案与端点圆）', () => {
    const geo = buildSparkline([3, 8, 5], W, H, PAD)!;
    expect(geo.min).toBe(3);
    expect(geo.max).toBe(8);
    expect(geo.lastX).toBe(W - PAD);
    expect(Number.isFinite(geo.lastY)).toBe(true);
  });
});

describe('appendSample', () => {
  it('追加并保持固定长度（旧点从头部丢弃）', () => {
    expect(appendSample([1, 2], 3, 3)).toEqual([1, 2, 3]);
    expect(appendSample([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });
});
