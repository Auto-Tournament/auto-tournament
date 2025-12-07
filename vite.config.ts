import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read package.json to get version
const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  root: './client',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  envPrefix: 'VITE_',
  build: {
    outDir: '../public',
    emptyOutDir: true,
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
