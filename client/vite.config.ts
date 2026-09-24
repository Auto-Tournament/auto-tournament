import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { moduleShims } from './vite-plugins/moduleShims';

// Read client package.json to get version
const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8')
);

/**
 * CS2 is a catalog module (DESIGN-modules §10): the production bundle carries
 * none of it and loads it at runtime, signed and installed like any code
 * module. The registry's `import { cs2ClientIntegration } from './cs2'` is
 * answered with `null`. The dev server keeps CS2 compiled in (the dev alias,
 * DESIGN-module-client-api §6); AT_CS2_BUILTIN=0 turns that off, and
 * AT_CS2_BUILTIN=1 keeps it in a production build.
 */
function withoutCs2(command: 'build' | 'serve'): Plugin | null {
  const flag = process.env.AT_CS2_BUILTIN;
  const exclude = flag === '0' || (command === 'build' && flag !== '1');
  if (!exclude) return null;
  const registry = resolve(__dirname, 'src/integrations/registry.ts');
  const stub = '\0cs2-not-compiled-in';
  return {
    name: 'without-cs2',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './cs2' && importer === registry) return stub;
      return null;
    },
    load(id) {
      return id === stub ? 'export const cs2ClientIntegration = null;' : null;
    },
  };
}

export default defineConfig(({ command }) => ({
  // moduleShims: the import map and shims that hand runtime-loaded game
  // modules the host's React, MUI, router and i18next (vite-plugins/moduleShims.ts).
  plugins: [withoutCs2(command), react(), moduleShims()],
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
    // Allow local development hosts; production runs behind Caddy/NGINX.
    allowedHosts: ['localhost', '127.0.0.1'],
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
}));


