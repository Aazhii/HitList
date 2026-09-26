import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001';

export default defineConfig({
  // The repo root, not this folder, holds the one .env.local shared by Vite
  // (VITE_API_BASE_URL) and Docker Compose (DATABASE_URL, SERVER_PORT,
  // OWNER_COOKIE_SECRET) — without this, Vite would look for web/.env.local
  // and silently see none of those variables.
  envDir: '..',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 9000,
    // Allow Vite to pick the next available port if 9000 is already in use
    // (e.g. when the notes server or a previous Vite instance holds the port).
    strictPort: false,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', () => { /* server offline — app handles fallback */ });
        },
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 9000,
    strictPort: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['test/setup.ts'],
    css: false,
  },
});
