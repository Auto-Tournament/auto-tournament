const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

// Node.js built-in modules that should not be bundled
const nodeBuiltins = [
  'fs', 'path', 'http', 'https', 'url', 'util', 'events', 'stream',
  'crypto', 'os', 'net', 'tls', 'dns', 'zlib', 'buffer', 'querystring',
  'child_process', 'cluster', 'dgram', 'readline', 'repl', 'string_decoder',
  'tty', 'vm', 'worker_threads', 'diagnostics_channel', 'async_hooks',
  'perf_hooks', 'trace_events', 'v8', 'assert', 'console', 'process',
  'module', 'punycode', 'timers', 'domain', 'constants'
].map((m) => `node:${m}`);

/**
 * Some transitive dependencies (notably `openid@2.0.14`, pulled in via
 * `passport-steam` → `@passport-next/passport-openid`) use `arguments.callee`,
 * which throws in strict mode (and our bundled output runs strict).
 *
 * Patch those references at bundle time so the runtime doesn't crash on Node 20.
 */
const strictModeDependencyPatches = {
  name: 'strict-mode-dependency-patches',
  setup(build) {
    // Patch JS sources in dependencies (node_modules) that use
    // `Error.captureStackTrace(this, arguments.callee)` which throws in strict mode.
    // This is known to occur in `openid@2.0.14` (Steam auth path) and can occur in
    // other legacy deps.
    build.onLoad({ filter: /\/node_modules\/.*\.(js|cjs|mjs)$/ }, async (args) => {
      const contents = await fs.promises.readFile(args.path, 'utf8');

      if (!contents.includes('Error.captureStackTrace') || !contents.includes('arguments.callee')) {
        return { contents, loader: 'js' };
      }

      const patched = contents.replace(
        /Error\.captureStackTrace\(\s*this\s*,\s*arguments\.callee\s*\)\s*;/g,
        'Error.captureStackTrace(this);'
      );

      return { contents: patched, loader: 'js' };
    });
  },
};

async function build() {
  const outfile = path.join(__dirname, 'dist', 'index.js');

  // Ensure output directory exists (we write outputs ourselves below)
  await fs.promises.mkdir(path.dirname(outfile), { recursive: true });

  const result = await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs', // CommonJS for Node.js compatibility
  outfile,
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
  // esbuild automatically handles __dirname and __filename for platform: 'node'
  plugins: [strictModeDependencyPatches],
  // Write files ourselves so we can fail the build before producing artifacts.
  write: false,
  });

  // Regression guard: the actual Node 20+ crash comes from passing
  // `arguments.callee` as the second parameter to captureStackTrace.
  // (Some dependencies intentionally *probe* `arguments.callee` inside try/catch;
  // that's noisy but not a runtime crash.)
  const jsFile =
    (result.outputFiles || []).find((f) => f.path === outfile) ||
    (result.outputFiles || []).find((f) => f.path.endsWith(`${path.sep}dist${path.sep}index.js`));

  if (!jsFile) {
    const files = (result.outputFiles || []).map((f) => f.path);
    throw new Error(`esbuild returned no JS output file at ${outfile}. Files: ${files.join(', ')}`);
  }

  const output = jsFile.text;
  const crashPattern = /captureStackTrace\(\s*this\s*,\s*arguments\.callee\s*\)/;
  const match = output.match(crashPattern);
  if (match && typeof match.index === 'number') {
    const idx = match.index;
    const start = Math.max(0, idx - 140);
    const end = Math.min(output.length, idx + 140);
    const snippet = output.slice(start, end);
    throw new Error(
      `Build produced a bundle containing "${match[0]}" (strict-mode crash risk).\nSnippet:\n${snippet}`
    );
  }

  // Only write artifacts after passing the guard.
  await Promise.all(
    (result.outputFiles || []).map(async (f) => {
      await fs.promises.mkdir(path.dirname(f.path), { recursive: true });
      await fs.promises.writeFile(f.path, f.contents);
    })
  );
}

build().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

