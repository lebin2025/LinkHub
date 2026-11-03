import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const sharedEntry = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

// LinkHub Web · Vite + Vitest 一体化配置
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 直接复用 monorepo 的统一消息契约
      '@unimsg/shared': sharedEntry,
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  // 本机验证时把构建产物与缓存写到可写目录；正常开发保持默认
  cacheDir: process.env.WEB_CACHE_DIR || 'node_modules/.vite',
  build: {
    outDir: process.env.WEB_OUT_DIR || 'dist',
    // antd 全量组件库体积固有偏大（gzip 后约 160KB），已通过 tree-shaking 最小化；
    // 阈值按实际产物设定，避免把已知权衡误报为构建告警。
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // 两层单向拆分：业务 → vendor → react-vendor，避免多层互相引用形成循环 chunk
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('/react-dom/') ||
            id.includes('/react/') ||
            id.includes('/scheduler/') ||
            id.includes('/react-is/') ||
            id.includes('react-router') ||
            id.includes('@remix-run')
          ) {
            return 'react-vendor';
          }
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});