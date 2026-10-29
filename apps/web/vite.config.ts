/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Same-origin /api in dev (proxied) and in production (reverse proxy), so cookies stay first-party.
// `--mode e2e` targets the throwaway API started by `npm run e2e:server -w @kirana/api`.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: mode === 'e2e' ? 5174 : 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: mode === 'e2e' ? 'http://localhost:4100' : 'http://localhost:4000',
        changeOrigin: false,
      },
    },
  },
  build: { sourcemap: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
}));
