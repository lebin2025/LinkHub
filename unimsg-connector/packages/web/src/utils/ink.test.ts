import { describe, expect, it } from 'vitest';
import { contrastRatio, luminance, mixHex, readableInk } from './ink';
import { PLATFORM_META, STATUS_META, intentColor } from './format';

describe('contrastRatio', () => {
  it('黑白为 21:1，同色为 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });
});

describe('readableInk', () => {
  it('本来就达标就不动它（不为了达标而改色）', () => {
    expect(readableInk('#1d1d1f', '#ffffff')).toBe('#1d1d1f');
  });

  it('浅底上压暗（最常见：标签压在自家浅色底上）', () => {
    const ink = readableInk('#3370ff', '#eaf0ff');
    expect(contrastRatio(ink, '#eaf0ff')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(ink)).toBeLessThan(luminance('#3370ff'));
  });

  it('深底上提亮（暗色主题复用同一函数）', () => {
    const ink = readableInk('#1b3a5c', '#0b0b0c');
    expect(contrastRatio(ink, '#0b0b0c')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(ink)).toBeGreaterThan(luminance('#1b3a5c'));
  });

  it('中间亮度的背景：往"天花板更高"的那一端走', () => {
    // 品牌蓝上纯白只有 3.4，纯黑能到 6.2 —— 必须选黑
    const ink = readableInk('#0a2540', '#0a84ff');
    expect(contrastRatio(ink, '#0a84ff')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(ink)).toBeLessThan(luminance('#0a2540'));
  });

  it('非法输入原样返回，不抛错', () => {
    expect(readableInk('not-a-color', '#ffffff')).toBe('not-a-color');
  });
});

/**
 * 回归锁：这些色号一旦被人改回浅色调，标签文字就会重新跌破 AA，
 * 这里让它直接红。
 */
describe('标签墨色在自家浅底上必须 ≥4.5', () => {
  it('四个平台', () => {
    for (const [key, meta] of Object.entries(PLATFORM_META)) {
      const ratio = contrastRatio(meta.ink, meta.soft);
      expect(ratio, `${key} ink=${meta.ink} on ${meta.soft}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('六个状态', () => {
    for (const [key, meta] of Object.entries(STATUS_META)) {
      const ratio = contrastRatio(meta.ink, meta.soft);
      expect(ratio, `${key} ink=${meta.ink} on ${meta.soft}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('四种意图', () => {
    for (const intent of ['待办', '咨询', '通知', '未分类']) {
      const tone = intentColor(intent);
      expect(contrastRatio(tone.ink, tone.soft), intent).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('色点仍用品牌原色（图形对比只需 3:1，保留识别度）', () => {
    expect(PLATFORM_META.feishu.color).toBe('#3370ff');
    expect(PLATFORM_META.wecom.color).toBe('#07c160');
    // 原色当文字是不达标的——这正是要分成两个字段的原因
    expect(contrastRatio(PLATFORM_META.wecom.color, PLATFORM_META.wecom.soft)).toBeLessThan(4.5);
  });
});

/**
 * 暗色那一对也必须自己达标：原来暗色是 CSS 里 `!important` 覆盖成统一灰底，
 * 标签丢掉平台识别度；现在由 tone() 从同一个品牌色推出深底 + 亮墨。
 */
describe('暗色色板同样 ≥4.5，且保留色相', () => {
  it('四个平台', () => {
    for (const [key, meta] of Object.entries(PLATFORM_META)) {
      const ratio = contrastRatio(meta.inkDark, meta.softDark);
      expect(ratio, `${key} inkDark=${meta.inkDark} on ${meta.softDark}`).toBeGreaterThanOrEqual(4.5);
      // 深底必须真的比浅底暗，否则主题切换等于没换
      expect(luminance(meta.softDark)).toBeLessThan(luminance(meta.soft));
    }
  });

  it('六个状态 + 四种意图', () => {
    for (const [key, meta] of Object.entries(STATUS_META)) {
      expect(contrastRatio(meta.inkDark, meta.softDark), key).toBeGreaterThanOrEqual(4.5);
    }
    for (const intent of ['待办', '咨询', '通知', '未分类']) {
      const tone = intentColor(intent);
      expect(contrastRatio(tone.inkDark, tone.softDark), intent).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('mixHex', () => {
  it('权重 0 / 1 取到两端，0.5 取中点', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
