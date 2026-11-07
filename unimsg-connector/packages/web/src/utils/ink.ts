/**
 * 按背景算一个"读得清的墨色"。
 *
 * 起因：平台/状态标签把同一个 `color` 既当**色点**（图形，只需 3:1）又当**文字色**，
 * 而它压在自家的浅色底上时对比度只有 2.0–3.8（企微 2.18、邮箱 2.02），远低于 AA 的 4.5。
 *
 * 做法不是换一套色板（那会丢掉平台识别度），而是**保留色相、只压明度**：
 * 以 4% 为步长往黑（或往白）走，直到达标。这样"飞书还是飞书蓝"，只是更沉一点。
 */

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const raw = m[1];
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

const toHex = ([r, g, b]: [number, number, number]): string =>
  '#' +
  [r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');

/**
 * 两色线性混合：`weight` 是**朝 `b` 走的比例**（0 = 纯 a，1 = 纯 b）。
 *
 * 派生色板用它把「一个作者值」摊成整套底/墨对——浅底 = 品牌色往白走到 90%，
 * 暗底 = 从纯黑往浅底走 16%。调平台色只需改一个十六进制，其余四个自动跟上，
 * 不会出现"色点改了、文字色忘了改"的两份真相。
 */
export function mixHex(a: string, b: string, weight: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const t = Math.max(0, Math.min(1, weight));
  return toHex([
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
  ]);
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度 */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 对比度（1–21） */
export function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * 返回一个在 `bg` 上达到 `target` 对比度的同色相墨色。
 *
 * - 背景偏亮 → 往黑压；背景偏暗 → 往白提（暗色主题复用同一个函数）
 * - 走到头仍不达标就退化成纯黑 / 纯白，保证可读性优先于色相
 */
export function readableInk(fg: string, bg: string, target = 4.6): string {
  const base = parseHex(fg);
  const back = parseHex(bg);
  if (!base || !back) return fg;
  if (contrastRatio(fg, bg) >= target) return fg;

  // 方向不能拍脑袋按"背景亮暗"判断：中间亮度的背景（比如品牌蓝）两头都够不着 4.5，
  // 得先比一比"纯白"和"纯黑"哪个能给你更高的天花板，再往那边走。
  const towardsWhite = contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg);
  const dest: [number, number, number] = towardsWhite ? [255, 255, 255] : [0, 0, 0];

  let best = towardsWhite ? '#ffffff' : '#000000';
  for (let step = 1; step <= 25; step += 1) {
    const t = (step / 25) * 0.9; // 最多混合 90%，留一点色相
    const mixed: [number, number, number] = [
      base[0] + (dest[0] - base[0]) * t,
      base[1] + (dest[1] - base[1]) * t,
      base[2] + (dest[2] - base[2]) * t,
    ];
    const hex = toHex(mixed);
    if (contrastRatio(hex, bg) >= target) return hex;
    best = hex;
  }
  return best;
}
