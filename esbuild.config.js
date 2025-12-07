const esbuild = require('esbuild');

const isProduction = process.env.NODE_ENV === 'production';

// Node.js built-in modules that should not be bundled
const nodeBuiltins = [
  'fs', 'path', 'http', 'https', 'url', 'util', 'events', 'stream',
  'crypto', 'os', 'net', 'tls', 'dns', 'zlib', 'buffer', 'querystring',
  'child_process', 'cluster', 'dgram', 'readline', 'repl', 'string_decoder',
  'tty', 'vm', 'worker_threads', 'diagnostics_channel', 'async_hooks',
  'perf_hooks', 'trace_events', 'v8', 'assert', 'console', 'process',
  'module', 'punycode', 'timers', 'domain', 'constants'
].map(m => `node:${m}`);

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs', // CommonJS for Node.js compatibility
  outfile: 'dist/index.js',
  external: [
    // Node.js built-ins (with and without node: prefix)
    ...nodeBuiltins,
    ...nodeBuiltins.map(m => m.replace('node:', '')),
    // Keep native modules external - they can't be bundled
    'pg-native',
    'better-sqlite3',
  ],
  minify: isProduction,
  sourcemap: !isProduction,
  treeShaking: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  // esbuild automatically handles __dirname and __filename for platform: 'node'
}).catch(() => process.exit(1));

