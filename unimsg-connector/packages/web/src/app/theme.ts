import { theme as antdTheme, type ThemeConfig } from 'antd';

/**
 * LinkHub 设计令牌（Art Direction: Quiet Precision 静奢秩序）
 *
 * 主风格：精致与克制（静奢）
 * 辅助：信息设计（高密度但有序）+ 瑞士国际主义排版（网格/字阶/留白）
 * 视觉母题：Confluence 汇流 —— 多条支流汇成一条主干，对应"多平台汇入统一收件箱"
 *
 * 约定：AntD 只负责组件行为，视觉气质由这里的 token 与 app.css 的 CSS 变量共同约束。
 */

export type ThemeMode = 'light' | 'dark';

/**
 * 字体三元组：正文 / 标题 / 数字与代码。
 *
 * 没有引入 web font（离线可用优先），但把变量字体版本提到最前：
 * Windows 上 'Segoe UI Variable Display' 在大字号下的字形与字距明显好于静态版；
 * 中文优先 'Microsoft YaHei UI'（比 YaHei 的 hinting 更稳）。
 */
export const FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";
export const FONT_DISPLAY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";
/** 兼容旧引用 */
export const FONT_SERIF = FONT_DISPLAY;
export const FONT_MONO =
  "'SF Mono', ui-monospace, 'JetBrains Mono', 'Cascadia Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

/** 明暗两套语义色（与 app.css 的 [data-theme] 变量保持一致，避免两处漂移） */
const PALETTE = {
  light: {
    brand: '#0071E3',
    brandSoft: '#EAF3FF',
    copper: '#FF9500',
    bg: '#FFFFFF',
    surface: '#FFFFFF',
    surface2: '#F5F5F7',
    text: '#1D1D1F',
    text2: '#6E6E73',
    text3: '#86868B',
    border: '#D2D2D7',
    border2: '#E8E8ED',
    success: '#248A3D',
    warning: '#B25000',
    error: '#D70015',
  },
  dark: {
    brand: '#0A84FF',
    brandSoft: '#0A2540',
    copper: '#FF9F0A',
    bg: '#000000',
    surface: '#000000',
    surface2: '#1D1D1F',
    text: '#F5F5F7',
    text2: '#B0B0B5',
    text3: '#8E8E93',
    border: '#38383A',
    border2: '#2C2C2E',
    success: '#30D158',
    warning: '#FF9F0A',
    error: '#FF453A',
  },
} as const;

export function buildTheme(mode: ThemeMode): ThemeConfig {
  const p = PALETTE[mode];
  const dark = mode === 'dark';

  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: p.brand,
      colorInfo: p.brand,
      colorSuccess: p.success,
      colorWarning: p.warning,
      colorError: p.error,

      colorBgLayout: p.bg,
      colorBgContainer: p.surface,
      colorBgElevated: dark ? '#1D1D1F' : '#FFFFFF',

      colorText: p.text,
      colorTextSecondary: p.text2,
      colorTextTertiary: p.text3,
      colorTextQuaternary: p.text3,
      colorTextLightSolid: '#F5F5F7',

      colorBorder: p.border,
      colorBorderSecondary: p.border2,
      colorSplit: p.border,

      // Apple 式：软角、细边、极轻阴影
      borderRadius: 10,
      borderRadiusLG: 14,
      borderRadiusSM: 8,
      fontSize: 14,
      lineHeight: 1.6,
      controlHeight: 34,
      fontFamily: FONT_SANS,
      wireframe: false,
      boxShadow: dark
        ? '0 1px 3px rgba(0,0,0,.5), 0 16px 40px -16px rgba(0,0,0,.55)'
        : '0 1px 3px rgba(0,0,0,.04), 0 12px 32px -12px rgba(0,0,0,.10)',
      boxShadowSecondary: dark
        ? '0 1px 3px rgba(0,0,0,.5), 0 8px 24px -10px rgba(0,0,0,.5)'
        : '0 1px 3px rgba(0,0,0,.04), 0 8px 24px -10px rgba(0,0,0,.08)',
    },
    components: {
      Card: { paddingLG: 20 },
      Button: { primaryShadow: 'none', fontWeight: 500, defaultShadow: 'none' },
      Segmented: {
        itemSelectedBg: dark ? '#000000' : '#FFFFFF',
        trackBg: dark ? '#2C2C2E' : '#EFEFF2',
      },
      Select: { optionSelectedBg: p.brandSoft },
      Menu: { itemSelectedBg: p.brandSoft },
      Input: { activeShadow: 'none' },
      /* Tooltip 明暗两种模式都用深色气泡 + 浅色文字：暗色下若用浅底会与浅字撞色，直接看不清 */
      Tooltip: {
        colorBgSpotlight: dark ? '#3A3A3C' : '#1D1D1F',
        colorTextLightSolid: '#F7F7F8',
      },
    },
  };
}

/** 向后兼容旧引用（如需静态浅色主题） */
export const theme = buildTheme('light');
