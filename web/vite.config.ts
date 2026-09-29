/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps every asset URL relative, so the build works from any
// sub-path (e.g. /play/ai-summary/) and inside an iframe.
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1600,
    sourcemap: false,
  },
  server: { port: 5302, strictPort: true },
  preview: { port: 8812, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
