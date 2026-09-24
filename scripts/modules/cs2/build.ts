#!/usr/bin/env tsx
/**
 * Build the CS2 game module as an installable folder (DESIGN-modules §10.3;
 * item 11 / 8d of the module notes):
 *
 *   <out>/module.json
 *   <out>/server/index.mjs   api/src/integrations/cs2, one ESM bundle
 *   <out>/client/index.js    client/src/integrations/cs2, ESM with the shared packages left bare
 *   <out>/client/*.js         its chunks
 *
 * usage: tsx scripts/modules/cs2/build.ts <out-dir>
 *
 * Then `scripts/module-release.ts pack` signs it.
 *
 * ## The server half reaches core through the host bridge
 *
 * CS2's server code imports core modules (the database, the logger, the
 * settings service, the socket service, …). Bundled as they are, those would
 * be second copies: a pool nobody initialised, a socket server nobody
 * started. So every import that resolves into `api/src` outside the module's
 * own folder becomes `globalThis.__AT_HOST__.module('<path>')` — the live
 * instance the platform registered (`api/src/modules/hostBridge.ts`). The
 * build fails if the module needs a core module the bridge does not export.
 * npm packages are bundled in; the image has no node_modules.
 *
 * ## The client half is built like any code module's
 *
 * Vite library mode, with every shared specifier (React, MUI, the router,
 * i18next, the SDK) external, so the browser links them to the host's own
 * instances through the import map (DESIGN-module-client-api §3). CS2 reaches
 * the SDK by a relative path in the source tree; the build turns that into
 * the bare `@auto-tournament/module-sdk`.
 */

import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import { build as viteBuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { HOST_MODULES } from '../../../api/src/modules/hostModules';
import { SHARED_SPECIFIERS, SDK_SPECIFIER } from '../../../client/src/module-loader/sharedSpecifiers';
import { CLIENT_API_VERSION, SERVER_API_VERSION } from '../../../api/src/modules/version';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const API_SRC = path.join(ROOT, 'api', 'src');
const MODULE_API = path.join(API_SRC, 'integrations', 'cs2');
const CLIENT_SRC = path.join(ROOT, 'client', 'src');
const MODULE_CLIENT = path.join(CLIENT_SRC, 'integrations', 'cs2');
const SDK_INDEX = path.join(CLIENT_SRC, 'module-sdk', 'index.ts');

function fail(message: string): never {
  console.error(`build cs2: ${message}`);
  process.exit(1);
}

/** The file a relative TypeScript import names, or null. */
function resolveSource(base: string): string | null {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Imports into core become reads of the live instance the platform registered. */
function hostBridge(used: Set<string>): esbuild.Plugin {
  return {
    name: 'at-host-bridge',
    setup(build) {
      build.onResolve({ filter: /^\./ }, (args) => {
        if (!args.importer || args.namespace !== 'file') return undefined;
        const file = resolveSource(path.resolve(args.resolveDir, args.path));
        if (!file || !file.startsWith(API_SRC + path.sep)) return undefined;
        if (file.startsWith(MODULE_API + path.sep)) return undefined;
        const name = path
          .relative(API_SRC, file)
          .split(path.sep)
          .join('/')
          .replace(/\.tsx?$/, '');
        used.add(name);
        return { path: name, namespace: 'at-host' };
      });
      build.onLoad({ filter: /.*/, namespace: 'at-host' }, (args) => ({
        // CommonJS, so the bundler reads each name off the object when it is
        // used rather than needing the list of names at build time.
        contents: `module.exports = globalThis.__AT_HOST__.module(${JSON.stringify(args.path)});`,
        loader: 'js',
      }));
    },
  };
}

async function buildServer(out: string): Promise<void> {
  const used = new Set<string>();
  const result = await esbuild.build({
    entryPoints: [path.join(MODULE_API, 'module.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: path.join(out, 'server', 'index.mjs'),
    // Bundled CommonJS packages call require and read __dirname; an ES
    // module has neither until it makes them.
    banner: {
      js: [
        "import { createRequire as __atCreateRequire } from 'node:module';",
        "import { fileURLToPath as __atFileURLToPath } from 'node:url';",
        "import { dirname as __atDirname } from 'node:path';",
        'const require = __atCreateRequire(import.meta.url);',
        'const __filename = __atFileURLToPath(import.meta.url);',
        'const __dirname = __atDirname(__filename);',
      ].join('\n'),
    },
    external: ['pg-native', 'better-sqlite3'],
    plugins: [hostBridge(used)],
    legalComments: 'none',
    minify: false,
    sourcemap: false,
    logLevel: 'warning',
  });
  if (result.errors.length > 0) fail('the server build failed');

  const missing = [...used].filter((name) => !HOST_MODULES.includes(name)).sort();
  if (missing.length > 0) {
    fail(
      `the server half imports core modules the host bridge does not export: ${missing.join(', ')}. ` +
        'Add them to api/src/modules/hostModules.ts and hostBridge.ts.'
    );
  }
  console.log(`server: ${path.relative(ROOT, path.join(out, 'server', 'index.mjs'))} (${used.size} core modules through the bridge)`);
}

/** The SDK by its package name, and every shared package left for the host. */
function sdkExternal(): Plugin {
  return {
    name: 'at-module-sdk-external',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null;
      const file = resolveSource(path.resolve(path.dirname(importer), source));
      if (file === SDK_INDEX) return { id: SDK_SPECIFIER, external: true };
      if (file && file.startsWith(path.join(CLIENT_SRC, 'module-sdk') + path.sep)) {
        throw new Error(`${path.relative(ROOT, importer)} imports ${source}; a module reaches the SDK through its index only`);
      }
      return null;
    },
  };
}

async function buildClient(out: string): Promise<void> {
  const shared = new Set<string>(SHARED_SPECIFIERS);
  await viteBuild({
    configFile: false,
    root: path.join(ROOT, 'client'),
    logLevel: 'warn',
    publicDir: false,
    plugins: [sdkExternal(), react()],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: path.join(out, 'client'),
      emptyOutDir: true,
      minify: true,
      sourcemap: false,
      target: 'es2020',
      lib: {
        entry: path.join(MODULE_CLIENT, 'module.ts'),
        formats: ['es'],
        fileName: () => 'index.js',
      },
      rollupOptions: {
        external: (id) => shared.has(id),
        output: { chunkFileNames: '[name]-[hash].js' },
      },
    },
  });
  const files = fs.readdirSync(path.join(out, 'client'));
  if (!files.includes('index.js')) fail('the client build wrote no index.js');
  console.log(`client: ${files.length} file(s) in ${path.relative(ROOT, path.join(out, 'client'))}`);
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) fail('usage: tsx scripts/modules/cs2/build.ts <out-dir>');
  const out = path.resolve(target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };

  await buildServer(out);
  await buildClient(out);

  const manifest = {
    id: 'cs2',
    name: 'Counter-Strike 2',
    // Built in lockstep with the platform while the module APIs are 0.x.
    version: pkg.version,
    serverApi: `^${SERVER_API_VERSION}`,
    clientApi: `^${CLIENT_API_VERSION}`,
    server: 'server/index.mjs',
    client: 'client/index.js',
  };
  fs.writeFileSync(path.join(out, 'module.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`cs2 ${manifest.version} built in ${out}`);
}

void main().catch((error: unknown) => fail(error instanceof Error ? error.stack ?? error.message : String(error)));
