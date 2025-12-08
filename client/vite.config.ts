import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read client package.json to get version
const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8')
);

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  envPrefix: 'VITE_',
  build: {
    // Build directly into api/public so the API can serve the SPA at /app
    outDir: resolve(__dirname, '../api/public'),
    emptyOutDir: true,
    // Increase chunk size warning limit (in kB) to avoid noisy warnings for our main bundle
    chunkSizeWarningLimit: 3000,
  },
  server: {
    port: 5173,
    allowedHosts: ['cs.sivert.io'],
    // Development proxy: forwards /api/*, /socket.io/*, and /map-images/* to Express server on port 3000
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
      '/map-images': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});


