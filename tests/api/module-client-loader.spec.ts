import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLIENT_API_VERSION } from '../../client/src/module-sdk/version';
import { checkClientApi, validateModuleExport } from '../../client/src/module-loader/contract';
import { loadCodeModules, type LoadDeps } from '../../client/src/module-loader/loadCodeModules';
import {
  COMPONENT_SLOTS,
  entryProblem,
  modulesToLoad,
  parseModuleListing,
  type LoadableModule,
  type ModuleListEntry,
} from '../../client/src/module-loader/manifest';
import {
  SHARED_SPECIFIERS,
  SHARED_SUBSETS,
} from '../../client/src/module-loader/sharedSpecifiers';
import { exportNames, shimSource, type Resolver } from '../../client/vite-plugins/moduleShims';

/**
 * The client half of loading a game module's code at runtime
 * (DESIGN-module-client-api.md, part 8a): the client API range check, the
 * default-export validation, every "this module is broken" reason the loader
 * can give, and the import-map shims.
 *
 * All of it runs in this process. `import()` and `fetch` are handed to the
 * loader as functions, so a 404, an HTML page served as a module, a
 * top-level throw and a module that never answers are each a stub here. The
 * shims are generated from the real packages in node_modules, and one is
 * linked by Node's own ESM loader to show that a name the host lacks fails at
 * link time. No server, no browser, no database.
 *
 * What this cannot show: a module rendering on the host's React inside the
 * app, and a slot's error boundary catching a render crash. Those need the
 * server's /api/modules and a built module fixture, and are the end-to-end
 * test to add once the server half lands.
 *
 * @tag api
 */

const ROOT = resolve(__dirname, '../..');
const CLIENT = join(ROOT, 'client');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const Component = () => null;

/** The smallest valid ClientGameIntegration. */
function moduleDef(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fixture',
    capabilities: { servers: false, veto: false, liveEvents: false, demos: false, playerStats: false },
    matchPanels: { reportView: Component },
    tournamentSetupSteps: {},
    standaloneMatchSteps: {},
    resourceDialogs: {},
    dashboardWidgets: {},
    routes: [
      {
        path: 'fixture',
        scope: 'admin',
        element: { $$typeof: Symbol.for('react.element'), type: Component, props: {} },
      },
    ],
    navItems: [],
    ...overrides,
  };
}

function listed(overrides: Partial<ModuleListEntry> = {}): LoadableModule {
  const id = overrides.id ?? 'fixture';
  return {
    id,
    name: 'Fixture',
    version: '1.0.0',
    source: 'disk',
    clientApi: '^0.1.0',
    serverApi: '^0.1.0',
    enabled: true,
    status: 'ok',
    reason: null,
    client: { entry: `/api/modules/${id}/client/index.js` },
    ...overrides,
  } as LoadableModule;
}

const js = (body = 'export default {}') =>
  new globalThis.Response(body, { status: 200, headers: { 'Content-Type': 'text/javascript' } });

function deps(overrides: Partial<LoadDeps> = {}): LoadDeps {
  return {
    platformClientApi: CLIENT_API_VERSION,
    takenIds: ['cs2', 'manual-report'],
    importModule: async () => ({ default: moduleDef() }),
    fetchImpl: async () => js(),
    timeoutMs: 1_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The client API version and range
// ---------------------------------------------------------------------------

test.describe('Client API range', () => {
  test('the platform publishes 0.1.0', () => {
    expect(CLIENT_API_VERSION).toBe('0.1.0');
    // Re-exported from the SDK barrel, where a module reads it.
    const sdk = readFileSync(join(CLIENT, 'src/module-sdk/index.ts'), 'utf8');
    expect(sdk).toContain("export { CLIENT_API_VERSION } from './version';");
  });

  test('a range this platform satisfies passes', () => {
    for (const range of ['^0.1.0', '~0.1.0', '0.1.x', '>=0.1.0 <0.2.0', '*', '0.1.0']) {
      expect(checkClientApi(range, '0.1.0'), range).toBeNull();
    }
  });

  test('under 0.x a caret is "this minor only", with no special case', () => {
    expect(checkClientApi('^0.1.0', '0.2.0')?.code).toBe('outOfRange');
    expect(checkClientApi('^0.2.0', '0.1.0')?.code).toBe('outOfRange');
    expect(checkClientApi('^1.1.0', '1.4.0')).toBeNull();
    expect(checkClientApi('^1.1.0', '2.0.0')?.code).toBe('outOfRange');
  });

  test('out of range says what the module was built for and what this platform is', () => {
    const refused = checkClientApi('^0.3.0', '0.1.0');
    expect(refused).toMatchObject({
      stage: 'contract',
      code: 'outOfRange',
      params: { range: '^0.3.0', platform: '0.1.0' },
      message: 'built for client API ^0.3.0; this platform provides 0.1.0',
    });
  });

  test('no range, or one that is not semver, is refused as such', () => {
    expect(checkClientApi(null, '0.1.0')?.code).toBe('noClientApi');
    expect(checkClientApi('  ', '0.1.0')?.code).toBe('noClientApi');
    expect(checkClientApi('banana', '0.1.0')).toMatchObject({
      code: 'badClientApi',
      params: { range: 'banana' },
    });
  });
});

// ---------------------------------------------------------------------------
// The list, and where code may come from
// ---------------------------------------------------------------------------

test.describe('Module list', () => {
  test('only enabled disk modules the server is fine with, with client code, are loaded', () => {
    const modules: ModuleListEntry[] = [
      listed({ id: 'good' }),
      { ...listed({ id: 'cs2' }), source: 'builtin', client: null },
      listed({ id: 'off', enabled: false, status: 'disabled' }),
      listed({ id: 'old', status: 'incompatible', reason: 'built for ^0.3' }),
      listed({ id: 'bad', status: 'broken', reason: 'module.json is not JSON' }),
      { ...listed({ id: 'server-only' }), client: null },
    ];
    expect(modulesToLoad(modules).map((m) => m.id)).toEqual(['good']);
  });

  test('a body that is not the listing is "no modules", not a crash', () => {
    expect(parseModuleListing(null)).toBeNull();
    expect(parseModuleListing('<!doctype html>')).toBeNull();
    expect(parseModuleListing({ success: true })).toBeNull();
    const listing = parseModuleListing({
      success: true,
      platform: { clientApi: '0.1.0', serverApi: '0.1.0' },
      modules: [listed(), null, { nope: true }],
    });
    expect(listing?.platform.clientApi).toBe('0.1.0');
    expect(listing?.modules.map((m) => m.id)).toEqual(['fixture']);
  });

  test("code is only loaded from the module's own route under /api/modules", () => {
    expect(entryProblem('fixture', '/api/modules/fixture/client/index.js')).toBeNull();
    expect(entryProblem('fixture', '/api/modules/fixture/1.0.0/client/index.js')).toBeNull();
    for (const entry of [
      // The SPA falls back on these with 200 and index.html.
      '/modules/fixture/client/index.js',
      '/app/modules/fixture/client.js',
      // Another module's route, or out of this one.
      '/api/modules/other/client/index.js',
      '/api/modules/fixture/../other/client/index.js',
      '/api/modules/fixture/',
      // Another origin.
      'https://example.com/api/modules/fixture/client/index.js',
      '//example.com/api/modules/fixture/client/index.js',
    ]) {
      expect(entryProblem('fixture', entry)?.code, entry).toBe('badEntry');
    }
  });
});

// ---------------------------------------------------------------------------
// The default export
// ---------------------------------------------------------------------------

test.describe('Module export validation', () => {
  test('a well-formed module passes as is', () => {
    const def = moduleDef();
    const result = validateModuleExport({ default: def }, 'fixture', ['cs2']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.integration).toBe(def);
  });

  test('memo and forwardRef components count as components', () => {
    const memo = { $$typeof: Symbol.for('react.memo'), type: Component };
    const result = validateModuleExport(
      { default: moduleDef({ matchPanels: { teamView: memo } }) },
      'fixture',
      []
    );
    expect(result.ok).toBe(true);
  });

  const refusals: Array<[string, unknown, string, string]> = [
    ['no default export', {}, 'badExport', 'default export is not an object'],
    ['a default that is a function', { default: Component }, 'badExport', 'default export is not an object'],
    ['no capabilities', { default: moduleDef({ capabilities: undefined }) }, 'badExport', 'capabilities is missing'],
    [
      'a capability that is not a boolean',
      { default: moduleDef({ capabilities: { servers: 'yes' } }) },
      'badExport',
      'capabilities.servers is not a boolean',
    ],
    ['a missing slot group', { default: moduleDef({ dashboardWidgets: undefined }) }, 'badExport', 'dashboardWidgets is not an object'],
    [
      'a slot that is not a component',
      { default: moduleDef({ matchPanels: { teamView: 'Connect' } }) },
      'badExport',
      'matchPanels.teamView is not a component',
    ],
    [
      'a route whose element is not an element',
      { default: moduleDef({ routes: [{ path: 'x', scope: 'admin', element: Component }] }) },
      'badExport',
      'routes[0].element is not a React element',
    ],
    [
      'a route with an unknown scope',
      {
        default: moduleDef({
          routes: [{ path: 'x', scope: 'public', element: { $$typeof: Symbol.for('react.element') } }],
        }),
      },
      'badExport',
      "routes[0].scope is not 'admin' or 'admin-standalone'",
    ],
    [
      'a nav item without an icon',
      { default: moduleDef({ navItems: [{ key: 'x', path: 'x' }] }) },
      'badExport',
      'navItems[0].icon is not a component',
    ],
    [
      'a start slot without its confirm view',
      { default: moduleDef({ tournamentStart: { confirmLabel: 'Go', cancelLabel: 'No' } }) },
      'badExport',
      'tournamentStart.confirmView is missing',
    ],
    [
      'a module claiming to be the placeholder',
      { default: moduleDef({ notInstalled: 'cs2' }) },
      'badExport',
      'notInstalled is reserved for the platform',
    ],
  ];

  for (const [what, namespace, code, detail] of refusals) {
    test(`refuses ${what}`, () => {
      const result = validateModuleExport(namespace, 'fixture', []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.stage).toBe('contract');
        expect(result.failure.code).toBe(code);
        expect(result.failure.params.detail).toBe(detail);
      }
    });
  }

  test('refuses a module whose code names another id than it is installed as', () => {
    const result = validateModuleExport({ default: moduleDef({ id: 'other' }) }, 'fixture', []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toMatchObject({
        code: 'idMismatch',
        params: { id: 'other', expected: 'fixture' },
      });
    }
  });

  test('refuses a code module that takes a built-in id', () => {
    const result = validateModuleExport({ default: moduleDef({ id: 'cs2' }) }, 'cs2', [
      'cs2',
      'manual-report',
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('idTaken');
  });

  test('the slot list is every component slot of ClientGameIntegration', () => {
    // integrations/types.ts is the contract. Every `name?: ComponentType<…>`
    // in it must be a slot the validator checks and the adapter wraps in an
    // error boundary, or a new slot would render a code module unguarded.
    const types = readFileSync(join(CLIENT, 'src/integrations/types.ts'), 'utf8');
    const declared = [...types.matchAll(/(\w+)\??:\s*ComponentType</g)].map((m) => m[1]).sort();
    const listedSlots = COMPONENT_SLOTS.map((path) => path.split('.').pop()!).sort();
    expect(listedSlots).toEqual(declared);
  });
});

// ---------------------------------------------------------------------------
// Loading: every way a module breaks, and that it breaks alone
// ---------------------------------------------------------------------------

test.describe('Loading code modules', () => {
  test('a good module loads, after the shared packages are provided once', async () => {
    let shared = 0;
    const imported: string[] = [];
    const results = await loadCodeModules([listed(), listed({ id: 'second' })], deps({
      prepareShared: async () => {
        shared += 1;
      },
      importModule: async (url) => {
        imported.push(url);
        return { default: moduleDef({ id: url.split('/')[3] }) };
      },
    }));
    expect(results.map((r) => [r.id, r.ok])).toEqual([
      ['fixture', true],
      ['second', true],
    ]);
    expect(shared).toBe(1);
    expect(imported).toEqual([
      '/api/modules/fixture/client/index.js',
      '/api/modules/second/client/index.js',
    ]);
  });

  test('out of range is refused before any code is fetched, and nothing is shared', async () => {
    let imported = 0;
    let shared = 0;
    const [result] = await loadCodeModules([listed({ clientApi: '^0.3.0' })], deps({
      importModule: async () => {
        imported += 1;
        return {};
      },
      prepareShared: async () => {
        shared += 1;
      },
    }));
    expect(imported).toBe(0);
    expect(shared).toBe(0);
    expect(result).toMatchObject({
      ok: false,
      failure: {
        stage: 'contract',
        code: 'outOfRange',
        message: 'built for client API ^0.3.0; this platform provides 0.1.0',
      },
    });
  });

  test('a 404 says the code is missing', async () => {
    const [result] = await loadCodeModules([listed()], deps({
      importModule: async () => {
        throw new TypeError('Failed to fetch dynamically imported module');
      },
      fetchImpl: async () => new globalThis.Response('{"error":"Not found"}', { status: 404 }),
    }));
    expect(result).toMatchObject({ ok: false, failure: { stage: 'import', code: 'notFound' } });
  });

  test('HTML served where the code should be says so, not "failed to fetch"', async () => {
    const [result] = await loadCodeModules([listed()], deps({
      importModule: async () => {
        throw new TypeError('Failed to fetch dynamically imported module');
      },
      fetchImpl: async () =>
        new globalThis.Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    }));
    expect(result).toMatchObject({
      ok: false,
      failure: { code: 'notJavaScript', params: { contentType: 'text/html' } },
    });
  });

  test('another HTTP error carries its status', async () => {
    const [result] = await loadCodeModules([listed()], deps({
      importModule: async () => {
        throw new TypeError('Failed to fetch dynamically imported module');
      },
      fetchImpl: async () => new globalThis.Response('', { status: 503 }),
    }));
    expect(result).toMatchObject({ ok: false, failure: { code: 'httpError', params: { status: 503 } } });
  });

  test("a throw at import time, or a link error, keeps the module's own message", async () => {
    const [thrown, link] = await loadCodeModules([listed(), listed({ id: 'skew' })], deps({
      importModule: async (url) => {
        if (url.includes('/skew/')) {
          throw new SyntaxError("The requested module 'react' does not provide an export named 'use'");
        }
        throw new Error('module exploded');
      },
    }));
    expect(thrown).toMatchObject({
      ok: false,
      failure: { stage: 'import', code: 'importFailed', params: { error: 'Error: module exploded' } },
    });
    expect(link).toMatchObject({ ok: false, failure: { code: 'importFailed' } });
    if (!link.ok) expect(link.failure.message).toContain("does not provide an export named 'use'");
  });

  test('a module that never answers times out instead of holding the app', async () => {
    const started = Date.now();
    const [hung, fine] = await loadCodeModules([listed({ id: 'hung' }), listed()], deps({
      timeoutMs: 100,
      importModule: (url) =>
        url.includes('/hung/') ? new Promise(() => undefined) : Promise.resolve({ default: moduleDef() }),
    }));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(hung).toMatchObject({ ok: false, failure: { stage: 'import', code: 'timeout' } });
    expect(fine.ok).toBe(true);
  });

  test('a failure to share the packages breaks every module that got that far, and says why', async () => {
    const results = await loadCodeModules([listed(), listed({ id: 'old', clientApi: '^9.0.0' })], deps({
      prepareShared: async () => {
        throw new Error('chunk failed');
      },
    }));
    expect(results[0]).toMatchObject({ ok: false, failure: { code: 'sharedFailed' } });
    // Refused on its range first: that is still the reason it gives.
    expect(results[1]).toMatchObject({ ok: false, failure: { code: 'outOfRange' } });
  });

  test('one broken module never stops another from loading', async () => {
    const results = await loadCodeModules(
      [
        listed({ id: 'missing' }),
        listed({ id: 'future', clientApi: '^2.0.0' }),
        listed({ id: 'elsewhere', client: { entry: '/modules/elsewhere/client.js' } }),
        listed({ id: 'wrong-shape' }),
        listed({ id: 'fixture' }),
      ],
      deps({
        importModule: async (url) => {
          if (url.includes('/missing/')) throw new TypeError('Failed to fetch dynamically imported module');
          if (url.includes('/wrong-shape/')) return { default: { id: 'wrong-shape' } };
          return { default: moduleDef() };
        },
        fetchImpl: async () => new globalThis.Response('', { status: 404 }),
      })
    );
    expect(results.map((r) => [r.id, r.ok ? 'ok' : r.failure.code])).toEqual([
      ['missing', 'notFound'],
      ['future', 'outOfRange'],
      ['elsewhere', 'badEntry'],
      ['wrong-shape', 'badExport'],
      ['fixture', 'ok'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The import-map shims
// ---------------------------------------------------------------------------

test.describe('Shared-package shims', () => {
  const nodeResolve: Resolver = async (specifier, importer) => {
    try {
      return createRequire(importer).resolve(specifier);
    } catch {
      return null;
    }
  };
  const fromClient = (specifier: string) => createRequire(join(CLIENT, 'index.html')).resolve(specifier);

  test('every shared specifier has a loader in the registry', () => {
    const registry = readFileSync(join(CLIENT, 'src/module-loader/sharedRegistry.ts'), 'utf8');
    for (const specifier of SHARED_SPECIFIERS) {
      const key = /^[a-z]\w*$/.test(specifier) ? `${specifier}:` : `'${specifier}':`;
      expect(registry, specifier).toContain(key);
    }
  });

  test("React's names come from its CommonJS build, and React 19's `use` is not one", async () => {
    const names = await exportNames(fromClient('react'), nodeResolve);
    for (const name of ['useState', 'useEffect', 'createContext', 'Component', 'Fragment']) {
      expect(names.has(name), name).toBe(true);
    }
    expect(names.has('use')).toBe(false);
    expect(names.has('__esModule')).toBe(false);
  });

  test("MUI's names come from its ESM build, following export *", async () => {
    const esm = join(ROOT, 'node_modules/@mui/material/esm/index.js');
    const names = await exportNames(esm, nodeResolve);
    for (const name of ['Button', 'Alert', 'useTheme', 'ThemeProvider', 'createTheme', 'Box']) {
      expect(names.has(name), name).toBe(true);
    }
    expect(names.size).toBeGreaterThan(300);
    expect(names.has('default')).toBe(false);
  });

  test('the router is shared as a subset, and the SDK by its source, types left out', async () => {
    const router = await exportNames(join(CLIENT, SHARED_SUBSETS['react-router-dom']!), nodeResolve);
    expect(router.has('useNavigate')).toBe(true);
    expect(router.has('Link')).toBe(true);
    expect(router.has('createBrowserRouter')).toBe(false);
    expect(router.has('useFetcher')).toBe(false);

    const sdk = await exportNames(join(CLIENT, 'src/module-sdk/index.ts'), nodeResolve);
    for (const name of ['CLIENT_API_VERSION', 'api', 'useAuth', 'ConfirmDialog', 'tokens']) {
      expect(sdk.has(name), name).toBe(true);
    }
    expect(sdk.has('ModuleAuth')).toBe(false);
  });

  test("a shim hands out the host's instance, and a name the host lacks fails to link", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'module-shims-'));
    const host = { useState: () => 'host useState', version: '18.3.1' };
    const g = globalThis as { __AT_SHARED__?: Record<string, unknown> };
    const previous = g.__AT_SHARED__;
    g.__AT_SHARED__ = { react: host };
    try {
      writeFileSync(join(dir, 'react.mjs'), shimSource('react', ['useState', 'version']));
      writeFileSync(
        join(dir, 'good.mjs'),
        "import React, { useState } from './react.mjs'; export default { same: React, answer: useState() };"
      );
      writeFileSync(join(dir, 'skew.mjs'), "import { use } from './react.mjs'; export default use;");

      const good = await import(pathToFileURL(join(dir, 'good.mjs')).href);
      expect(good.default.same).toBe(host);
      expect(good.default.answer).toBe('host useState');

      await expect(import(pathToFileURL(join(dir, 'skew.mjs')).href)).rejects.toThrow(
        /does not provide an export named 'use'/
      );
    } finally {
      g.__AT_SHARED__ = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
