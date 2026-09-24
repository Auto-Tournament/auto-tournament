import { test, expect, type APIRequestContext } from '@playwright/test';
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
    expect(platform).toEqual({ clientApi: '0.1.0', serverApi: '0.1.0' });

    for (const id of ['cs2', 'manual-report']) {
      const row = modules.find((module) => module.id === id);
      expect(row, `${id} should be listed`).toBeTruthy();
      expect(row).toMatchObject({
        source: 'builtin',
        enabled: true,
        status: 'ok',
        reason: null,
        client: null,
      });
    }

    const disabled = await request.post('/api/modules/cs2/disable');
    expect(disabled.status()).toBe(400);
    expect((await moduleRow(request, 'cs2')).enabled).toBe(true);
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
      clientApi: '^0.1.0',
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
        ['POST builtin disable', () => stranger.post('/api/modules/cs2/disable')],
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
