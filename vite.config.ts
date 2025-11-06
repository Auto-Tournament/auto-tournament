import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: './client',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    allowedHosts: ['cs.sivert.io'],
    // Development proxy: forwards /api/* and /socket.io/* to Express server on port 3000
    // Production: Caddy proxies both to Express on same port (no proxy needed)
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true, // Enable WebSocket proxying
      },
    },
  },
});
