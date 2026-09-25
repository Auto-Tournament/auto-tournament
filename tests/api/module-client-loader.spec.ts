import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLIENT_API_VERSION } from '../../client/src/module-sdk/version';
import { checkClientApi, validateModuleExport } from '../../client/src/module-loader/contract';
import { isValidRange, satisfies } from '../../client/src/module-loader/semverRange';
import { loadCodeModules, type LoadDeps } from '../../client/src/module-loader/loadCodeModules';
import {
  COMPONENT_SLOTS,
  entryProblem,
  parseModuleListing,
  parsePublicManifest,
  type LoadableModule,
  type ModuleListEntry,
} from '../../client/src/module-loader/manifest';
import {
  SHARED_SPECIFIERS,
  SHARED_SUBSETS,
} from '../../client/src/module-loader/sharedSpecifiers';
import { exportNames, shimSource, type Resolver } from '../../client/vite-plugins/moduleShims';
import {
  MISSING_MODULE_ID,
  missingModuleIntegration,
  resolveIntegration,
  resolveIntegrationWhileLoading,
} from '../../client/src/utils/moduleResolution';
import {
  getModuleState,
  modulesMayArrive,
  resetModuleState,
  setBootStatus,
  setManifestStatus,
  setSafeMode,
  subscribeModuleState,
} from '../../client/src/module-loader/moduleState';
import type { ClientGameIntegration } from '../../client/src/integrations/types';

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

/** A module as the public manifest lists it. */
function listed(overrides: Partial<LoadableModule> = {}): LoadableModule {
  const id = overrides.id ?? 'fixture';
  return {
    id,
    version: '1.0.0',
    clientApi: '^0.2.0',
    client: { entry: `/api/modules/${id}/client/index.js` },
    ...overrides,
  };
}

/** A module as the admin list shows it. */
function adminRow(overrides: Partial<ModuleListEntry> = {}): ModuleListEntry {
  const id = overrides.id ?? 'fixture';
  return {
    id,
    name: 'Fixture',
    version: '1.0.0',
    source: 'disk',
    clientApi: '^0.2.0',
    serverApi: '^0.1.0',
    enabled: true,
    status: 'ok',
    reason: null,
    client: { entry: `/api/modules/${id}/client/index.js` },
    ...overrides,
  };
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
  test('the platform publishes 0.2.8, which a module built for ^0.2.0 loads on and one built for ^0.1.0 does not', () => {
    // 0.2.0 reshaped slots to take ids (item 8b): a break, so the minor moved; 0.2.1 only added SDK exports.
    // 0.2.2 added two optional slots, 0.2.3 to 0.2.5 SDK exports, 0.2.6 one optional slot
    // (`rosterMemberStatus`), 0.2.7 the `ExternalLink` SDK export, 0.2.8 the optional Phosphor nav item
    // icon and `ICON_SIZE`: patches, which ^0.2.0 still matches.
    expect(CLIENT_API_VERSION).toBe('0.2.8');
    expect(checkClientApi('^0.2.0', CLIENT_API_VERSION)).toBeNull();
    expect(checkClientApi('^0.1.0', CLIENT_API_VERSION)?.code).toBe('outOfRange');
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

  test('the range check answers exactly as node-semver does', () => {
    // The client ships its own small checker (semverRange.ts) rather than the
    // semver package; node-semver is the reference it must agree with.
    const semver = createRequire(__filename)('semver') as {
      satisfies: (v: string, r: string) => boolean;
      validRange: (r: string) => string | null;
    };
    const ranges = [
      '^0.1.0', '^0.1', '^0', '^0.0.3', '^1.2.3', '^1', '^1.x', '~0.1.0', '~0.1', '~1', '~>1.2',
      '0.1.x', '0.x', '1.2.*', '*', 'x', '', '0.1.0', '=0.1.0', 'v0.1.0', '>=0.1.0', '>0.1.0',
      '<0.2.0', '<=0.1.0', '>=0.1.0 <0.2.0', '>= 0.1.0 < 0.2.0', '>0.1', '<=0.1', '<0.1',
      '0.0.1 - 0.2.0', '0.1 - 0.2', '0.1.0 - 1', '^0.2.0 || ^0.1.0', '^2.0.0 || >=0.1.5',
      '^1.0.0-beta.1', '>=0.1.0-rc.1 <0.1.0',
    ];
    const versions = [
      '0.0.3', '0.0.4', '0.1.0', '0.1.5', '0.2.0', '0.9.9', '1.0.0', '1.2.3', '1.2.4', '1.3.0',
      '1.9.0', '2.0.0', '0.1.0-rc.1', '0.1.0-rc.2', '1.0.0-beta.2', '1.0.0-alpha',
    ];
    for (const range of ranges) {
      expect(isValidRange(range), `valid ${range}`).toBe(semver.validRange(range) !== null);
      for (const version of versions) {
        expect(satisfies(version, range), `${version} in "${range}"`).toBe(
          semver.satisfies(version, range)
        );
      }
    }
    for (const bad of ['banana', '^^1.0.0', '1.2.3.4', '>=a', '1.0.0 - ', '~>']) {
      expect(isValidRange(bad), bad).toBe(semver.validRange(bad) !== null);
    }
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
  test('the public manifest keeps only the public fields, and drops what cannot be loaded', () => {
    expect(parsePublicManifest(null)).toBeNull();
    expect(parsePublicManifest('<!doctype html>')).toBeNull();
    expect(parsePublicManifest({ success: true })).toBeNull();
    expect(parsePublicManifest({ success: true, modules: [] })).toEqual([]);

    const modules = parsePublicManifest({
      success: true,
      modules: [
        // Whatever else a server sends is not carried into the loader.
        { ...listed({ id: 'good' }), reason: 'leaked', enabled: true, serverApi: '^0.1.0' },
        { ...listed({ id: 'no-range' }), clientApi: undefined },
        { id: 'no-client', version: '1.0.0', clientApi: '^0.1.0', client: null },
        { id: 'bad-entry', version: '1.0.0', clientApi: '^0.1.0', client: { entry: 42 } },
        null,
        { nope: true },
      ],
    });
    expect(modules).toEqual([
      listed({ id: 'good' }),
      listed({ id: 'no-range', clientApi: null }),
    ]);
  });

  test('a manifest is a claim: the loader still refuses a bad entry or range it lists', async () => {
    const imported: string[] = [];
    const manifest = parsePublicManifest({
      modules: [
        listed({ id: 'elsewhere', client: { entry: 'https://example.com/x.js' } }),
        listed({ id: 'future', clientApi: '^9.0.0' }),
        listed({ id: 'no-range', clientApi: null }),
      ],
    });
    const results = await loadCodeModules(manifest!, deps({
      importModule: async (url) => {
        imported.push(url);
        return { default: moduleDef() };
      },
    }));
    expect(results.map((r) => (r.ok ? 'ok' : r.failure.code))).toEqual([
      'badEntry',
      'outOfRange',
      'noClientApi',
    ]);
    expect(imported, 'nothing refused is fetched').toEqual([]);
  });

  test('a body that is not the admin listing is "no modules", not a crash', () => {
    expect(parseModuleListing(null)).toBeNull();
    expect(parseModuleListing('<!doctype html>')).toBeNull();
    expect(parseModuleListing({ success: true })).toBeNull();
    const listing = parseModuleListing({
      success: true,
      platform: { clientApi: '0.1.0', serverApi: '0.1.0' },
      modules: [adminRow(), null, { nope: true }],
    });
    expect(listing?.platform.clientApi).toBe('0.1.0');
    expect(listing?.modules.map((m) => m.id)).toEqual(['fixture']);
  });

  test("code is only loaded from the module's own route under /api/modules", () => {
    expect(entryProblem('fixture', '/api/modules/fixture/client/index.js')).toBeNull();
    expect(entryProblem('fixture', '/api/modules/fixture/1.0.0/client/index.js')).toBeNull();
    expect(entryProblem('fixture', '/api/modules/fixture/client/index.js?v=1.0.0-beta.1')).toBeNull();
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
// While code modules load: nothing waits but a module's own slots
// ---------------------------------------------------------------------------

/** Stand-ins: only what the lookup reads is set (the real ones import React components). */
function stub(id: string, extra: Partial<ClientGameIntegration> = {}): ClientGameIntegration {
  return { ...missingModuleIntegration(id), notInstalled: undefined, id, ...extra };
}
const cs2 = stub('cs2');
const manual = stub('manual-report', { runsAnyCatalogGame: true });
const late = stub('late-module', { catalogGames: ['rocket-league'] });

test.describe('While code modules load', () => {
  test.afterEach(() => resetModuleState());

  test('boot settles the state: pending until the manifest is empty or boot is done', () => {
    resetModuleState();
    expect(getModuleState()).toMatchObject({ boot: 'idle', manifest: 'unknown' });
    expect(modulesMayArrive()).toBe(true);

    let changes = 0;
    const unsubscribe = subscribeModuleState(() => changes++);
    setBootStatus('running');
    setManifestStatus('empty');
    expect(modulesMayArrive(), 'an empty manifest: nothing will arrive').toBe(false);
    unsubscribe();
    expect(changes, 'subscribers hear each step, which is what re-renders a slot').toBe(2);

    resetModuleState();
    setBootStatus('running');
    setManifestStatus('listed');
    expect(modulesMayArrive(), 'listed and still loading').toBe(true);
    setBootStatus('done');
    expect(modulesMayArrive(), 'settled, whatever arrived').toBe(false);

    resetModuleState();
    setSafeMode();
    expect(modulesMayArrive(), '?modules=off loads nothing, so nothing waits').toBe(false);
  });

  test('a built-in that owns the game never waits, in any phase', () => {
    for (const manifest of ['unknown', 'listed'] as const) {
      expect(resolveIntegrationWhileLoading('cs2', [cs2, manual], true, manifest)).toBe(cs2);
      expect(resolveIntegrationWhileLoading(undefined, [cs2, manual], true, manifest)).toBe(cs2);
    }
  });

  test('an empty manifest, or a settled boot, answers exactly what the registry does', () => {
    const installed = [cs2, manual];
    for (const game of ['cs2', 'rocket-league', 'no-such-game', undefined]) {
      expect(resolveIntegrationWhileLoading(game, installed, false, 'empty'), String(game)).toBe(
        resolveIntegration(game, installed)
      );
      expect(resolveIntegrationWhileLoading(game, installed, false, 'listed'), String(game)).toBe(
        resolveIntegration(game, installed)
      );
    }
    // Nothing installed runs it, and nothing will arrive: the not-installed placeholder.
    const missing = resolveIntegrationWhileLoading('rocket-league', [cs2], false, 'empty');
    expect(missing).toMatchObject({ id: MISSING_MODULE_ID, notInstalled: 'rocket-league' });
    expect(missing.modulePending).toBeUndefined();
  });

  test('a game nothing runs yet is pending, not "not installed", while a module may arrive', () => {
    for (const manifest of ['unknown', 'listed'] as const) {
      const answer = resolveIntegrationWhileLoading('rocket-league', [cs2], true, manifest);
      expect(answer.id).toBe(MISSING_MODULE_ID);
      expect(answer.modulePending).toBe('rocket-league');
      expect(answer.notInstalled, 'never both').toBeUndefined();
      // Empty in every slot, like the placeholder it stands in for.
      expect(Object.values(answer.capabilities).every((value) => value === false)).toBe(true);
      expect(answer.routes).toEqual([]);
    }
  });

  test('a catch-all game waits only once the manifest has listed a code module', () => {
    // Not yet answered: the catch-all as before, so a stock install never
    // holds manual reporting back.
    expect(resolveIntegrationWhileLoading('rocket-league', [cs2, manual], true, 'unknown')).toBe(
      manual
    );
    // Listed: a code module may claim it outright, so it waits.
    const pending = resolveIntegrationWhileLoading('rocket-league', [cs2, manual], true, 'listed');
    expect(pending.modulePending).toBe('rocket-league');
    // The catch-all's own id is its own game, not a guess.
    expect(resolveIntegrationWhileLoading('manual-report', [cs2, manual], true, 'listed')).toBe(
      manual
    );
  });

  test('pending goes to the module once it is registered, before boot settles', () => {
    // The module arrived (registered) while other modules still load.
    expect(
      resolveIntegrationWhileLoading('rocket-league', [cs2, manual, late], true, 'listed')
    ).toBe(late);
    // It never arrived, and boot settled: the catch-all, as without code modules.
    expect(resolveIntegrationWhileLoading('rocket-league', [cs2, manual], false, 'listed')).toBe(
      manual
    );
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

  test('a nav item may leave out its icon (client API 0.2.8), and a forwardRef one counts', () => {
    // Phosphor's icons are forwardRef components.
    const phosphorLike = { $$typeof: Symbol.for('react.forward_ref'), render: Component };
    const result = validateModuleExport(
      {
        default: moduleDef({
          navItems: [
            { key: 'bare', path: 'bare' },
            { key: 'drawn', path: 'drawn', icon: phosphorLike },
          ],
        }),
      },
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
      'a callback that is not a function',
      { default: moduleDef({ summarizeAvailability: { waitingMatches: 0 } }) },
      'badExport',
      'summarizeAvailability is not a function',
    ],
    [
      'setup rows given as a list instead of a function',
      { default: moduleDef({ adminHomeSetup: [] }) },
      'badExport',
      'adminHomeSetup is not a function',
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
      'a nav item whose icon is not a component',
      { default: moduleDef({ navItems: [{ key: 'x', path: 'x', icon: 'HardDrives' }] }) },
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
        message: 'built for client API ^0.3.0; this platform provides 0.2.8',
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
    for (const name of [
      'CLIENT_API_VERSION', 'api', 'useAuth', 'ConfirmDialog', 'tokens',
      // 0.1.1
      'links', 'openMatchDetails', 'useSocket', 'SegmentedControl',
      // 0.2.1
      'PageHead', 'SectionHead', 'Panel', 'RowList', 'Row', 'FactGrid', 'radii',
      // 0.2.3
      'pageTitle',
      // 0.2.4
      'useIsDevelopment',
      // 0.2.5
      'LiveChip', 'textSize',
    ]) {
      expect(sdk.has(name), name).toBe(true);
    }
    expect(sdk.has('ModuleAuth')).toBe(false);
    expect(sdk.has('PageHeadProps')).toBe(false);
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
