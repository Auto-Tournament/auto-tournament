import { test, expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Code modules on disk (DESIGN-modules §6, items 7 and 9).
 *
 * A code module is a folder in `DATA_DIR/modules/<id>/`, found at boot. It
 * starts disabled; the API lists modules and switches them on and off, and a
 * switch takes effect on the next restart. Nothing here can add a module: code
 * is installed on disk, never through the API (DESIGN-module-client-api,
 * decision 2).
 *
 * The spec cannot write to the release image's `DATA_DIR` or restart it, so
 * it uses the test-only helpers: `POST /api/test/modules/fixture` writes one
 * of a few fixed fixture modules there, and `POST /api/test/modules/rescan`
 * runs the scan again, which is what a restart does for a module that is not
 * loaded yet.
 *
 * The things worth pinning are the refusals: a module for another server API,
 * a module that throws while it is imported (the platform must keep serving),
 * an id that would be a path, a client path that climbs out of the module's
 * `client/` folder, and a missing client file that must be a real 404 rather
 * than the app's index.html.
 *
 * And the public manifest, `GET /api/modules/public`, which every visitor's
 * browser loads modules from: open to a stranger, listing only enabled,
 * loaded modules with a client half, and only `id`, `version`, `clientApi`
 * and `client.entry` for each. Never a reason or a module an admin has not
 * switched on.
 *
 * @tag api
 * @tag modules
 */

interface ModuleRow {
  id: string;
  name: string;
  version: string;
  source: 'builtin' | 'disk';
  clientApi: string | null;
  serverApi: string | null;
  enabled: boolean;
  status: 'ok' | 'incompatible' | 'broken' | 'disabled';
  reason: string | null;
  client: { entry: string } | null;
}

// Unique per run: a loaded module stays loaded until the server restarts, and
// a retry must not find the previous attempt's fixture.
const RUN = Date.now().toString(36);
const VALID = `fixture-valid-${RUN}`;
const INCOMPATIBLE = `fixture-incompatible-${RUN}`;
const THROWS = `fixture-throws-${RUN}`;
const MISMATCHED = `fixture-mismatched-${RUN}`;
const MIGRATES = `fixture-migrates-${RUN}`;
const BAD_MIGRATION = `fixture-badmig-${RUN}`;
const OFF = `fixture-off-${RUN}`;

async function listModules(request: APIRequestContext): Promise<{
  platform: { clientApi: string; serverApi: string };
  modules: ModuleRow[];
}> {
  const response = await request.get('/api/modules');
  expect(response.status(), `listing modules: ${await response.text()}`).toBe(200);
  return response.json();
}

async function moduleRow(request: APIRequestContext, id: string): Promise<ModuleRow> {
  const row = (await listModules(request)).modules.find((module) => module.id === id);
  expect(row, `module ${id} should be listed`).toBeTruthy();
  return row!;
}

async function writeFixture(request: APIRequestContext, id: string, kind: string): Promise<void> {
  const response = await request.post('/api/test/modules/fixture', { data: { id, kind } });
  expect(response.status(), `writing fixture ${id}: ${await response.text()}`).toBe(200);
}

async function rescan(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/test/modules/rescan');
  expect(response.status(), `rescanning: ${await response.text()}`).toBe(200);
}

/** The only fields the public manifest may carry for a module. */
const PUBLIC_FIELDS = ['client', 'clientApi', 'id', 'version'];

interface PublicManifest {
  success: boolean;
  modules: Array<{ id: string; version: string; clientApi: string; client: { entry: string } }>;
}

/**
 * `GET /api/modules/public` as a stranger: a fresh context with no session,
 * which is what a signed-out visitor's browser is.
 */
async function strangerManifest(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined
): Promise<{ body: PublicManifest; cacheControl: string | undefined; etag: string | undefined }> {
  const stranger = await playwright.request.newContext({ baseURL });
  try {
    const response = await stranger.get('/api/modules/public');
    expect(response.status(), `public manifest: ${await response.text()}`).toBe(200);
    return {
      body: await response.json(),
      cacheControl: response.headers()['cache-control'],
      etag: response.headers()['etag'],
    };
  } finally {
    await stranger.dispose();
  }
}

/** Every key anywhere in a JSON value, however deep. */
function keysDeep(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, into));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysDeep(inner, into);
    }
  }
  return into;
}

test.describe.serial('Code modules on disk', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/test/modules/fixtures');
  });

  test('the built-in modules are listed as builtin and cannot be switched off', {
    tag: ['@api', '@modules'],
  }, async ({ request }) => {
    const { platform, modules } = await listModules(request);
    expect(platform).toEqual({ clientApi: '0.2.6', serverApi: '0.1.0' });

    const builtin = modules.find((module) => module.id === 'manual-report');
    expect(builtin).toMatchObject({
      source: 'builtin',
      enabled: true,
      status: 'ok',
      reason: null,
      client: null,
    });

    const disabled = await request.post('/api/modules/manual-report/disable');
    expect(disabled.status()).toBe(400);
    expect((await moduleRow(request, 'manual-report')).enabled).toBe(true);
  });

  test('CS2 is not compiled in: it runs as a code module installed from the catalog', {
    tag: ['@api', '@modules'],
  }, async ({ request }) => {
    // CI installs it through POST /api/catalog/modules/cs2/install before the
    // suite runs (ci.yml), from the image's signed offline snapshot.
    expect(await moduleRow(request, 'cs2')).toMatchObject({
      source: 'disk',
      enabled: true,
      status: 'ok',
      client: { entry: '/api/modules/cs2/client/index.js' },
    });
    const catalog = await request.get('/api/catalog');
    const items = ((await catalog.json()) as { items: Array<{ kind: string; id: string; installed: { source: string } | null }> }).items;
    expect(items.find((item) => item.kind === 'module' && item.id === 'cs2')?.installed?.source).toBe('snapshot');
  });

  test('a module put on disk starts disabled, and loads once enabled and rescanned', {
    tag: ['@api', '@modules'],
  }, async ({ request }) => {
    await writeFixture(request, VALID, 'valid');

    const found = await moduleRow(request, VALID);
    expect(found).toMatchObject({
      source: 'disk',
      name: `Fixture ${VALID}`,
      version: '1.0.0',
      serverApi: '^0.1.0',
      clientApi: '^0.2.0',
      enabled: false,
      status: 'disabled',
      client: null,
    });
    // Disabled: none of its files are served.
    expect((await request.get(`/api/modules/${VALID}/client/index.js`)).status()).toBe(404);

    const enabled = await request.post(`/api/modules/${VALID}/enable`);
    expect(enabled.status(), await enabled.text()).toBe(200);
    const body = await enabled.json();
    // Honest: nothing is loaded until the next boot.
    expect(body.restartRequired).toBe(true);
    expect(body.module).toMatchObject({ id: VALID, enabled: true, status: 'disabled' });
    expect(body.module.reason).toMatch(/restart/i);

    // What the restart would do.
    await rescan(request);
    const loaded = await moduleRow(request, VALID);
    expect(loaded).toMatchObject({
      enabled: true,
      status: 'ok',
      reason: null,
      client: { entry: `/api/modules/${VALID}/client/index.js` },
    });
  });

  test('a stranger gets the public manifest, listing the loaded module with only the public fields', {
    tag: ['@api', '@modules'],
  }, async ({ playwright }, testInfo) => {
    const { body, cacheControl, etag } = await strangerManifest(
      playwright,
      testInfo.project.use.baseURL
    );
    expect(body.success).toBe(true);
    expect(Array.isArray(body.modules)).toBe(true);
    // Shareable, but revalidated on every page load, so a module switched on
    // or off shows on the next load rather than after a max-age.
    expect(cacheControl).toMatch(/\bpublic\b/);
    expect(cacheControl).toMatch(/\bno-cache\b/);
    expect(cacheControl).not.toMatch(/private|no-store|max-age=[1-9]/);
    // Revalidating is cheap: an unchanged manifest is a 304 with no body.
    expect(etag, 'the manifest carries an ETag').toBeTruthy();
    const again = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      const revalidated = await again.get('/api/modules/public', {
        headers: { 'If-None-Match': etag! },
      });
      expect(revalidated.status()).toBe(304);
    } finally {
      await again.dispose();
    }

    const valid = body.modules.find((module) => module.id === VALID);
    expect(valid, `${VALID} is enabled and loaded, so it is public`).toBeTruthy();
    expect(Object.keys(valid!).sort()).toEqual(PUBLIC_FIELDS);
    expect(Object.keys(valid!.client)).toEqual(['entry']);
    expect(valid).toEqual({
      id: VALID,
      version: '1.0.0',
      clientApi: '^0.2.0',
      client: { entry: `/api/modules/${VALID}/client/index.js` },
    });

    // Built-in modules are compiled into the app: never listed. CS2 is a
    // catalog module, so it is listed like any other code module.
    expect(body.modules.map((module) => module.id)).not.toContain('manual-report');
    expect(body.modules.map((module) => module.id)).toContain('cs2');
  });

  test('client files are served with their content type, and a missing one is a real 404', {
    tag: ['@api', '@modules'],
  }, async ({ request }) => {
    const { client } = await moduleRow(request, VALID);
    expect(client).not.toBeNull();

    const script = await request.get(client!.entry);
    expect(script.status()).toBe(200);
    expect(script.headers()['content-type']).toMatch(/^text\/javascript/);
    expect(await script.text()).toContain(VALID);

    const style = await request.get(`/api/modules/${VALID}/client/style.css`);
    expect(style.status()).toBe(200);
    expect(style.headers()['content-type']).toMatch(/^text\/css/);

    // Not the SPA's index.html with a 200: a 404 the loader can report.
    const missing = await request.get(`/api/modules/${VALID}/client/missing.js`);
    expect(missing.status()).toBe(404);
    expect(missing.headers()['content-type']).toMatch(/application\/json/);
    expect(await missing.text()).not.toMatch(/<html/i);

    // Nothing outside the module's client/ folder, however the path is spelt.
    for (const escape of [
      '..%2Fmodule.json',
      '..%2Fserver%2Findex.js',
      '%2E%2E%2Fmodule.json',
      '..%2F..%2F..%2Fmodules',
    ]) {
      const response = await request.get(`/api/modules/${VALID}/client/${escape}`);
      expect(response.status(), `client/${escape}`).toBe(404);
    }
  });

  test('disabling says a restart is needed and stops serving the client at once', {
    tag: ['@api', '@modules'],
  }, async ({ request }) => {
    const disabled = await request.post(`/api/modules/${VALID}/disable`);
    expect(disabled.status(), await disabled.text()).toBe(200);
    const body = await disabled.json();
    expect(body.restartRequired).toBe(true);
    // Still loaded: a Node module cannot be unloaded.
    expect(body.module).toMatchObject({ id: VALID, enabled: false, status: 'ok', client: null });

    expect((await request.get(`/api/modules/${VALID}/client/index.js`)).status()).toBe(404);
    // And no browser is told to load it any more.
    const publicIds = (await (await request.get('/api/modules/public')).json()).modules.map(
      (module: { id: string }) => module.id
    );
    expect(publicIds).not.toContain(VALID);
  });

  test('a module built for another server API is incompatible, with the reason', {
    tag: ['@api', '@modules'],
  }, async ({ request }) => {
    await writeFixture(request, INCOMPATIBLE, 'incompatible');
    const row = await moduleRow(request, INCOMPATIBLE);
    expect(row.status).toBe('incompatible');
    expect(row.serverApi).toBe('^0.3.0');
    expect(row.reason).toContain('^0.3.0');
    expect(row.reason).toContain('0.1.0');

    // Enabling it does not make it load.
    expect((await request.post(`/api/modules/${INCOMPATIBLE}/enable`)).status()).toBe(200);
    await rescan(request);
    expect((await moduleRow(request, INCOMPATIBLE)).status).toBe('incompatible');
  });

  test('a module brings its own schema: its migrations run as it loads', {
    tag: ['@api', '@modules'],
  }, async ({ request }) => {
    await writeFixture(request, MIGRATES, 'migrates');

    // Disabled and never loaded: nothing may have touched the database yet.
    const before = await (await request.get(`/api/test/modules/${MIGRATES}/migrations`)).json();
    expect(before.probeTableExists, 'a disabled module gets no schema').toBe(false);

    expect((await request.post(`/api/modules/${MIGRATES}/enable`)).status()).toBe(200);
    await rescan(request);

    expect((await moduleRow(request, MIGRATES)).status).toBe('ok');
    const after = await (await request.get(`/api/test/modules/${MIGRATES}/migrations`)).json();
    expect(after.state?.status).toBe('ok');
    expect(after.state?.applied).toEqual(['001-probe']);
    expect(after.probeTableExists, 'the module should have its own table').toBe(true);
  });

  test('a module whose migrations reach outside its own names is broken, and gets no schema at all', {
    tag: ['@api', '@modules'],
  }, async ({ request }) => {
    await writeFixture(request, BAD_MIGRATION, 'bad-migration');
    expect((await request.post(`/api/modules/${BAD_MIGRATION}/enable`)).status()).toBe(200);
    await rescan(request);

    const row = await moduleRow(request, BAD_MIGRATION);
    expect(row.status).toBe('broken');
    expect(row.reason).toContain('migrations did not apply');
    expect(row.reason).toContain('matches');
    expect(row.client).toBeNull();

    // Refused before anything ran: not even its own, perfectly legal first
    // migration may have been applied.
    const state = await (await request.get(`/api/test/modules/${BAD_MIGRATION}/migrations`)).json();
    expect(state.probeTableExists, 'a refused module must leave no table behind').toBe(false);

    const health = await request.get('/health');
    expect(health.status()).toBe(200);
  });

  test('a module that throws while it is imported is broken, and the platform keeps serving', {
    tag: ['@api', '@modules'],
  }, async ({ request }) => {
    await writeFixture(request, THROWS, 'throws');
    expect((await request.post(`/api/modules/${THROWS}/enable`)).status()).toBe(200);
    await rescan(request);

    const row = await moduleRow(request, THROWS);
    expect(row.status).toBe('broken');
    expect(row.reason).toContain('exploded at import');
    expect(row.client).toBeNull();

    const health = await request.get('/health');
    expect(health.status()).toBe(200);
    expect((await health.json()).status).toBe('ok');
    // And the other modules are where they were.
    expect((await moduleRow(request, 'cs2')).status).toBe('ok');
    expect((await moduleRow(request, VALID)).status).toBe('ok');
  });

  test('an id with .. or / is refused', { tag: ['@api', '@modules'] }, async ({ request }) => {
    for (const id of ['a..b', '..%2Fetc', 'a%2Fb', '..']) {
      const response = await request.post(`/api/modules/${id}/enable`);
      expect([400, 404], `enable ${id}`).toContain(response.status());
    }
    expect((await request.post('/api/modules/a..b/enable')).status()).toBe(400);
    expect((await request.post('/api/modules/..%2Fetc/disable')).status()).toBe(400);
    expect((await request.post('/api/modules/not-on-this-disk/enable')).status()).toBe(404);

    // A manifest whose id would be a path is broken, and none of its code runs.
    await writeFixture(request, MISMATCHED, 'mismatched-id');
    const row = await moduleRow(request, MISMATCHED);
    expect(row.status).toBe('broken');
    expect(row.reason).toContain('not a valid module id');

    // The fixture helper refuses one too, before it writes anything.
    for (const id of ['fixture-../x', 'fixture-a/b', '../fixture-x']) {
      const response = await request.post('/api/test/modules/fixture', {
        data: { id, kind: 'valid' },
      });
      expect(response.status(), `fixture ${id}`).toBe(400);
    }
  });

  test('the public manifest lists no disabled, broken or incompatible module, and no reason', {
    tag: ['@api', '@modules'],
  }, async ({ request, playwright }, testInfo) => {
    // A valid module that was never enabled.
    await writeFixture(request, OFF, 'valid');
    expect((await moduleRow(request, OFF)).status).toBe('disabled');

    // What the admin list says about each, so the test cannot pass by
    // accident: every one of these is on disk and listed there.
    const admin = new Map((await listModules(request)).modules.map((module) => [module.id, module]));
    expect(admin.get(MIGRATES)).toMatchObject({ status: 'ok', enabled: true });
    const hidden: Array<[string, string]> = [
      [OFF, 'disabled'],
      [VALID, 'ok'], // loaded, then disabled: stays loaded until a restart
      [INCOMPATIBLE, 'incompatible'],
      [THROWS, 'broken'],
      [BAD_MIGRATION, 'broken'],
      [MISMATCHED, 'broken'],
    ];
    for (const [id, status] of hidden) {
      expect(admin.get(id)?.status, `${id} in the admin list`).toBe(status);
    }
    expect(admin.get(VALID)?.enabled).toBe(false);

    const { body } = await strangerManifest(playwright, testInfo.project.use.baseURL);
    const ids = body.modules.map((module) => module.id);
    // An enabled, loaded module with a client half is listed ...
    expect(ids).toContain(MIGRATES);
    // ... and nothing that is not.
    for (const [id] of hidden) expect(ids, id).not.toContain(id);

    for (const module of body.modules) {
      expect(Object.keys(module).sort(), module.id).toEqual(PUBLIC_FIELDS);
      expect(module.client.entry.startsWith(`/api/modules/${module.id}/`), module.id).toBe(true);
    }
    // Nothing an admin would keep to themselves, at any depth.
    const keys = keysDeep(body);
    for (const secret of ['reason', 'enabled', 'status', 'serverApi', 'source', 'platform']) {
      expect(keys.has(secret), `the public manifest must not carry '${secret}'`).toBe(false);
    }
  });

  test('a stranger gets 401 or 403 on every admin endpoint', {
    tag: ['@api', '@modules'],
  }, async ({ playwright }, testInfo) => {
    const stranger = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    try {
      const calls: Array<[string, () => Promise<{ status(): number }>]> = [
        ['GET /api/modules', () => stranger.get('/api/modules')],
        ['POST enable', () => stranger.post(`/api/modules/${VALID}/enable`)],
        ['POST disable', () => stranger.post(`/api/modules/${VALID}/disable`)],
        ['POST builtin disable', () => stranger.post('/api/modules/manual-report/disable')],
        [
          'POST test fixture',
          () =>
            stranger.post('/api/test/modules/fixture', {
              data: { id: `fixture-stranger-${RUN}`, kind: 'valid' },
            }),
        ],
        ['POST test rescan', () => stranger.post('/api/test/modules/rescan')],
        ['DELETE test fixtures', () => stranger.delete('/api/test/modules/fixtures')],
      ];
      for (const [label, call] of calls) {
        expect([401, 403], label).toContain((await call()).status());
      }
    } finally {
      await stranger.dispose();
    }
  });
});
