import type { ThemeConfig } from 'antd';

export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#1677ff',
    colorInfo: '#1677ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    borderRadius: 8,
    fontSize: 14,
    colorBgLayout: '#f5f7fa',
    colorBorderSecondary: '#e6e9f0',
    colorText: '#1f2329',
    colorTextSecondary: '#646a73',
    controlHeight: 32,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  components: {
    Card: { paddingLG: 20 },
    Segmented: { itemSelectedBg: '#ffffff', trackBg: '#f0f2f5' },
    Select: { optionSelectedBg: '#e6f0ff' },
    Button: { primaryShadow: '0 2px 6px rgba(22, 119, 255, 0.25)' },
    Menu: { itemSelectedBg: '#e6f0ff' },
  },
};