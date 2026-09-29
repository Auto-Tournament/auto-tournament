#!/usr/bin/env node
/**
 * Which E2E spec files a change can affect, so a pull request runs only those.
 *
 *   node tests/ci-affected.mjs <changed-file>...     # prints JSON: { all, specs, reason }
 *   node tests/ci-affected.mjs --explain <file>      # which specs reach one source file, and how
 *
 * A spec is affected by a changed file when:
 *   - it is the spec itself;
 *   - the file is in the spec's import closure (helpers, fixtures, and the
 *     api/src modules many specs import directly);
 *   - the spec calls an API route (`'/api/...'`, in the spec or its helpers)
 *     whose router's import closure has the file. Routers come from the route
 *     tables (api/src/routes/routeTable.ts and each integration's routes/index.ts);
 *   - the file is under client/src and the spec is a UI spec (tests/ui/).
 *
 * The whole suite runs instead when a shared file changed (dependencies, the
 * Docker build, the Playwright config, the CI scripts) or a server file no
 * spec reaches (index.ts wiring, a route table, anything the graph can't see):
 * over-running is slower, under-running misses a regression. Pushes to main
 * always run the whole suite, so anything this misses is caught on merge.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(testsDir);
const rel = (abs) => relative(repoRoot, abs).split('\\').join('/');

/** Changes that can affect everything: run the whole suite. */
const GLOBAL = [
  /^package\.json$/,
  /^yarn\.lock$/,
  /^(api|client)\/package\.json$/,
  /^(api|client)\/tsconfig[^/]*\.json$/,
  /^tsconfig[^/]*\.json$/,
  /^api\/esbuild\.config\.js$/,
  /^client\/vite\.config\.ts$/,
  /^client\/index\.html$/,
  /^docker\//,
  /^example\.env$/,
  /^\.github\/workflows\/ci\.yml$/,
  /^tests\/playwright\.config\.ts$/,
  /^tests\/ci-[^/]*$/,
  /^tests\/setup\.spec\.ts$/,
  /^scripts\/build-module-snapshot\.sh$/,
  /^api\/bundled-(packs|modules)\//,
  /^api\/src\/index\.ts$/,
  /^api\/src\/routes\/routeTable\.ts$/,
  /^api\/src\/integrations\/[^/]+\/routes\/index\.ts$/,
  /^api\/src\/config\/database[^/]*\.ts$/,
];

/** Never affects the suite (same list the workflow skipped on before). */
const IGNORED = [/^docs\/(?!openapi\.json$)/, /^examples\//, /^\.github\/ISSUE_TEMPLATE\//, /^LICENSE$/, /\.md$/];

const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.json'];

function listSpecs(dir = testsDir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSpecs(full));
    else if (SPEC.test(entry.name)) out.push(full);
  }
  return out;
}

const sourceCache = new Map();
function read(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, readFileSync(file, 'utf8'));
  return sourceCache.get(file);
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;

/** A relative specifier as a file on disk, or null (packages, missing files). */
function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  // `./x.js` in TypeScript sources means `./x.ts`.
  const stripped = base.replace(/\.(js|mjs|jsx)$/, '');
  const candidates = [base, ...EXTENSIONS.map((e) => stripped + e), ...EXTENSIONS.map((e) => join(base, 'index' + e))];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function directImports(file) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) return [];
  const out = [];
  for (const m of read(file).matchAll(IMPORT_RE)) {
    const target = resolveImport(file, m[1] ?? m[2] ?? m[3]);
    if (target) out.push(target);
  }
  return out;
}

const closureCache = new Map();
/** Every local file `file` reaches through imports, itself included. */
function closure(file) {
  if (closureCache.has(file)) return closureCache.get(file);
  const seen = new Set();
  const stack = [file];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...directImports(f));
  }
  closureCache.set(file, seen);
  return seen;
}

/** Mounted API routers: prefix -> the router's source files. */
function routeMounts() {
  const tables = [join(repoRoot, 'api/src/routes/routeTable.ts')];
  const integrations = join(repoRoot, 'api/src/integrations');
  if (existsSync(integrations)) {
    for (const d of readdirSync(integrations, { withFileTypes: true })) {
      const f = join(integrations, d.name, 'routes/index.ts');
      if (d.isDirectory() && existsSync(f)) tables.push(f);
    }
  }
  const mounts = [];
  for (const table of tables) {
    const src = read(table);
    // Imported router names -> files.
    const names = new Map();
    for (const m of src.matchAll(/import\s+(?:(\w+)|\{([^}]+)\})(?:\s*,\s*\{([^}]+)\})?\s+from\s+['"]([^'"]+)['"]/g)) {
      const file = resolveImport(table, m[4]);
      if (!file) continue;
      if (m[1]) names.set(m[1], file);
      for (const group of [m[2], m[3]]) {
        for (const part of (group ?? '').split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop();
          if (name) names.set(name, file);
        }
      }
    }
    for (const m of src.matchAll(/prefix:\s*['"](\/api[^'"]*)['"][\s\S]*?router:\s*(\w+)/g)) {
      const file = names.get(m[2]);
      if (file) mounts.push({ prefix: m[1], file });
    }
  }
  return mounts;
}

const TEST_ROUTERS = /^api\/src\/(routes\/test|routes\/testHelpers|integrations\/[^/]+\/routes\/testHelpers)\.ts$/;

const API_PATH_RE = /['"`](\/api\/[A-Za-z0-9_\-/]*)/g;

/** Router files a spec reaches over HTTP: `'/api/...'` strings in the spec and its helpers. */
function routedFiles(specClosure, mounts) {
  const paths = new Set();
  for (const f of specClosure) {
    if (!f.startsWith(testsDir)) continue;
    for (const m of read(f).matchAll(API_PATH_RE)) paths.add(m[1]);
  }
  const files = new Set();
  for (const p of paths) {
    for (const mount of mounts) {
      if (p === mount.prefix || p.startsWith(mount.prefix + '/') || mount.prefix.startsWith(p.replace(/\/$/, '') + '/')) {
        files.add(mount.file);
      }
    }
  }
  return files;
}

/** Per spec: every repo file it depends on, and why. */
function specGraph() {
  const mounts = routeMounts();
  return listSpecs().map((spec) => {
    const imports = closure(spec);
    const reach = new Map();
    for (const f of imports) reach.set(rel(f), 'import');
    for (const router of routedFiles(imports, mounts)) {
      // Test-only routers (reset, seed) are used by nearly every spec and
      // import half the server; what they reach is not what the spec tests.
      const deps = TEST_ROUTERS.test(rel(router)) ? [router] : closure(router);
      for (const f of deps) if (!reach.has(rel(f))) reach.set(rel(f), `route ${rel(router)}`);
    }
    return { spec: rel(spec), ui: rel(spec).startsWith('tests/ui/'), reach };
  });
}

export function affected(changed) {
  const files = changed.map((f) => f.split('\\').join('/')).filter(Boolean);
  const relevant = files.filter((f) => !IGNORED.some((re) => re.test(f)));
  if (relevant.length === 0) return { all: false, specs: [], reason: 'only docs/markdown/examples changed' };

  const global = relevant.find((f) => GLOBAL.some((re) => re.test(f)));
  if (global) return { all: true, specs: [], reason: `shared file changed: ${global}` };

  const graph = specGraph();
  const selected = new Set();
  for (const f of relevant) {
    const hits = graph.filter((g) => g.spec === f || g.reach.has(f) || (f.startsWith('client/src/') && g.ui));
    for (const h of hits) selected.add(h.spec);
    // A server or test file that no spec reaches: the graph can't see its
    // effect (wiring, a new route, a background job), so run everything.
    if (hits.length === 0 && (f.startsWith('api/') || f.startsWith('tests/'))) {
      return { all: true, specs: [], reason: `no spec reaches ${f}; running everything` };
    }
  }
  return { all: false, specs: [...selected].sort(), reason: `${selected.size} spec file(s) reach the change` };
}

const args = process.argv.slice(2);
if (args[0] === '--explain') {
  const target = args[1];
  for (const g of specGraph()) {
    const why = g.spec === target ? 'is the spec' : g.reach.get(target) ?? (target.startsWith('client/src/') && g.ui ? 'UI spec' : null);
    if (why) console.log(`${g.spec}\t${why}`);
  }
} else if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(JSON.stringify(affected(args)));
}
