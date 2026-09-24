import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The game catalog (DESIGN-modules §10): one list of packs and code modules,
 * and one set of operations on them.
 *
 * Code modules install only from signed releases. The spec points the
 * catalog at a fake feed the API serves itself (`POST /api/test/catalog`,
 * see `api/src/routes/testCatalog.ts`), whose releases are signed with a
 * throwaway key the process trusts, and checks each failure mode of §10.8
 * end to end: a tampered archive, a signature by a key nobody trusts, an
 * archive with a `../` entry or a symlink, a module.json that disagrees with
 * what was signed, an incompatible API range, a migration that fails on
 * load (rolled back), a download that times out (installed from the offline
 * snapshot instead) and a feed that is down (served from its cache).
 *
 * And the happy path: install loads the module without a restart, an update
 * of a loaded module waits for one, disable and uninstall keep the data, and
 * purge refuses while the code is still loaded.
 *
 * @tag api
 * @tag modules
 */

const RUN = Date.now().toString(36);

interface Item {
  kind: 'pack' | 'module';
  id: string;
  name: string;
  state: string;
  reason: string | null;
  installed: { version: string | null; source: string; enabled: boolean } | null;
  available: { version: string | null; from: 'remote' | 'snapshot' } | null;
  restartRequired: boolean;
  icon: string | null;
}

interface Listing {
  feed: { from: 'remote' | 'cache' | 'none'; stale: boolean; error: string | null };
  platform: { serverApi: string; clientApi: string };
  items: Item[];
}

type Ids = Record<
  'good' | 'tampered' | 'badsig' | 'traversal' | 'symlink' | 'wrongversion' | 'incompatible' | 'migfail' | 'offline',
  string
>;

async function fakeCatalog(
  request: APIRequestContext,
  options: { goodVersions?: string[]; feed?: 'ok' | 'hang' | 'down'; resetCache?: boolean } = {}
): Promise<Ids> {
  const response = await request.post('/api/test/catalog', { data: { fake: true, run: RUN, ...options } });
  expect(response.status(), `fake catalog: ${await response.text()}`).toBe(200);
  return ((await response.json()) as { ids: Ids }).ids;
}

async function catalog(request: APIRequestContext): Promise<Listing> {
  const response = await request.get('/api/catalog');
  expect(response.status(), `catalog: ${await response.text()}`).toBe(200);
  return response.json();
}

async function item(request: APIRequestContext, kind: Item['kind'], id: string): Promise<Item | undefined> {
  return (await catalog(request)).items.find((row) => row.kind === kind && row.id === id);
}

/** A same-site JSON write, the way the admin's browser sends one. */
function write(request: APIRequestContext, method: 'post' | 'delete', url: string, data: unknown = {}): Promise<APIResponse> {
  return request[method](url, { data, headers: { 'Content-Type': 'application/json' } });
}

async function refused(response: APIResponse, status: number, reason: RegExp): Promise<void> {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  expect((JSON.parse(text) as { error: string }).error).toMatch(reason);
}

test.describe.serial('Game catalog', () => {
  let ids: Ids;

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.post('/api/test/catalog', { data: { fake: false } });
    await request.delete('/api/test/modules/fixtures');
    await request.delete('/api/catalog/packs/index-test-game', { headers: { 'Content-Type': 'application/json' }, data: {} });
  });

  test('lists packs and modules together, from the feed and the snapshot', async ({ request }) => {
    ids = await fakeCatalog(request, { resetCache: true });
    const listing = await catalog(request);
    expect(listing.feed.from).toBe('remote');
    expect(listing.feed.stale).toBe(false);
    expect(listing.platform).toEqual({ serverApi: '0.1.0', clientApi: '0.2.0' });

    const good = listing.items.find((row) => row.id === ids.good);
    expect(good).toMatchObject({ kind: 'module', state: 'available', installed: null, available: { version: '1.0.0', from: 'remote' } });

    // The feed's pack and the image's snapshot packs are in the same list.
    expect(listing.items.find((row) => row.kind === 'pack' && row.id === 'index-test-game')?.available?.from).toBe('remote');
    expect(listing.items.some((row) => row.kind === 'pack' && row.available?.from === 'snapshot')).toBe(true);

    // Incompatible before anything is downloaded, with the ranges in the reason.
    const incompatible = listing.items.find((row) => row.id === ids.incompatible);
    expect(incompatible?.state).toBe('incompatible');
    expect(incompatible?.reason).toMatch(/\^9\.0\.0/);

    // A release the feed points outside our GitHub is dropped, not offered.
    expect(listing.items.some((row) => row.id === `fixture-cat-elsewhere-${RUN}`)).toBe(false);
  });

  test('is admin-only, and writes must be same-site JSON', async ({ request, playwright, baseURL }) => {
    const stranger = await playwright.request.newContext({ baseURL });
    try {
      expect((await stranger.get('/api/catalog')).status()).toBe(401);
      expect((await stranger.post(`/api/catalog/modules/${ids.good}/install`, { data: {} })).status()).toBe(401);
    } finally {
      await stranger.dispose();
    }
    const crossSite = await request.post(`/api/catalog/modules/${ids.good}/install`, {
      data: {},
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    });
    expect(crossSite.status()).toBe(403);
    const notJson = await request.post(`/api/catalog/modules/${ids.good}/install`, {
      form: { a: '1' },
    });
    expect(notJson.status()).toBe(415);
    expect((await item(request, 'module', ids.good))?.installed).toBeNull();
  });

  test('refuses a tampered archive before unpacking it', async ({ request }) => {
    await refused(await write(request, 'post', `/api/catalog/modules/${ids.tampered}/install`), 400, /changed after signing/);
    expect((await item(request, 'module', ids.tampered))?.installed).toBeNull();
  });

  test('refuses a release signed by a key the platform does not trust', async ({ request }) => {
    await refused(await write(request, 'post', `/api/catalog/modules/${ids.badsig}/install`), 400, /does not trust/);
    expect((await item(request, 'module', ids.badsig))?.installed).toBeNull();
  });

  test('refuses a signed archive with a traversal entry or a symlink', async ({ request }) => {
    await refused(await write(request, 'post', `/api/catalog/modules/${ids.traversal}/install`), 400, /climbs out/);
    await refused(await write(request, 'post', `/api/catalog/modules/${ids.symlink}/install`), 400, /symlink/);
    for (const id of [ids.traversal, ids.symlink]) {
      expect((await item(request, 'module', id))?.installed).toBeNull();
    }
  });

  test('refuses a module.json that disagrees with what was signed', async ({ request }) => {
    await refused(await write(request, 'post', `/api/catalog/modules/${ids.wrongversion}/install`), 400, /2\.0\.0.*1\.0\.0 was signed/);
  });

  test('refuses an incompatible release before downloading it', async ({ request }) => {
    await refused(await write(request, 'post', `/api/catalog/modules/${ids.incompatible}/install`), 409, /server API \^9\.0\.0/);
  });

  test('rolls back a module whose migration fails on load', async ({ request }) => {
    const response = await write(request, 'post', `/api/catalog/modules/${ids.migfail}/install`);
    await refused(response, 422, /did not load, so nothing was changed/);
    const row = await item(request, 'module', ids.migfail);
    expect(row?.installed).toBeNull();
    expect(row?.state).toBe('available');
    const migrations = await request.get(`/api/test/modules/${ids.migfail}/migrations`);
    expect(((await migrations.json()) as { probeTableExists: boolean }).probeTableExists).toBe(false);
  });

  test('installs from the offline snapshot when the download times out', async ({ request }) => {
    const response = await write(request, 'post', `/api/catalog/modules/${ids.offline}/install`);
    expect(response.status(), await response.text()).toBe(200);
    const row = await item(request, 'module', ids.offline);
    expect(row?.installed).toMatchObject({ version: '1.0.0', source: 'snapshot', enabled: true });
    expect(row?.state).toBe('installed');
  });

  test('installs a signed module and loads it without a restart', async ({ request }) => {
    const response = await write(request, 'post', `/api/catalog/modules/${ids.good}/install`);
    const text = await response.text();
    expect(response.status(), text).toBe(200);
    const body = JSON.parse(text) as { restartRequired: boolean; item: Item };
    expect(body.restartRequired).toBe(false);
    expect(body.item).toMatchObject({ state: 'installed', installed: { version: '1.0.0', source: 'catalog', enabled: true } });

    // Loaded: the loader lists it as ok, and the public manifest serves its client.
    const modules = (await (await request.get('/api/modules')).json()) as { modules: Array<{ id: string; status: string }> };
    expect(modules.modules.find((m) => m.id === ids.good)?.status).toBe('ok');
    const manifest = (await (await request.get('/api/modules/public')).json()) as { modules: Array<{ id: string }> };
    expect(manifest.modules.some((m) => m.id === ids.good)).toBe(true);

    // Installing it again is not an update.
    await refused(await write(request, 'post', `/api/catalog/modules/${ids.good}/install`), 409, /already installed/);
    await refused(await write(request, 'post', `/api/catalog/modules/${ids.good}/update`), 409, /already the newest/);
  });

  test('an update of a loaded module waits for a restart', async ({ request }) => {
    await fakeCatalog(request, { goodVersions: ['1.0.0', '1.1.0'] });
    expect((await item(request, 'module', ids.good))?.state).toBe('update-available');

    const response = await write(request, 'post', `/api/catalog/modules/${ids.good}/update`);
    const text = await response.text();
    expect(response.status(), text).toBe(200);
    const body = JSON.parse(text) as { restartRequired: boolean; item: Item };
    expect(body.restartRequired).toBe(true);
    expect(body.item.installed?.version).toBe('1.1.0');
    expect(body.item.reason).toMatch(/1\.0\.0 runs until the next restart/);

    // The running version's client keeps being served until then.
    const client = await request.get(`/api/modules/${ids.good}/client/index.js`);
    expect(client.status()).toBe(200);
  });

  test('disable and uninstall keep the data; purge waits for the restart', async ({ request }) => {
    const disabled = await write(request, 'post', `/api/catalog/modules/${ids.good}/disable`);
    expect(disabled.status(), await disabled.text()).toBe(200);
    expect(((await disabled.json()) as { restartRequired: boolean }).restartRequired).toBe(true);
    expect((await request.get(`/api/modules/${ids.good}/client/index.js`)).status()).toBe(404);

    const uninstalled = await write(request, 'delete', `/api/catalog/modules/${ids.good}`);
    expect(uninstalled.status(), await uninstalled.text()).toBe(200);
    const row = await item(request, 'module', ids.good);
    expect(row?.installed).toBeNull();
    expect(row?.restartRequired).toBe(true);

    await refused(await write(request, 'post', `/api/catalog/modules/${ids.good}/purge`, {}), 400, /to confirm/);
    await refused(
      await write(request, 'post', `/api/catalog/modules/${ids.good}/purge`, { confirm: ids.good }),
      409,
      /still loaded/
    );
    // One never loaded can be purged.
    const purged = await write(request, 'post', `/api/catalog/modules/${ids.migfail}/purge`, { confirm: ids.migfail });
    expect(purged.status(), await purged.text()).toBe(200);
  });

  test('installs a pack from the feed, and removes it', async ({ request }) => {
    await request.delete('/api/packs/index-test-game');
    const response = await write(request, 'post', '/api/catalog/packs/index-test-game/install');
    expect(response.status(), await response.text()).toBe(200);
    expect((await item(request, 'pack', 'index-test-game'))).toMatchObject({
      state: 'installed',
      installed: { version: '2.0.0', source: 'index' },
    });
    const icon = await request.get('/api/catalog/packs/index-test-game/icon.svg');
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/svg+xml');

    const removed = await write(request, 'delete', '/api/catalog/packs/index-test-game');
    expect(removed.status(), await removed.text()).toBe(200);
    expect((await item(request, 'pack', 'index-test-game'))?.state).toBe('available');
  });

  test('a feed that is down is served from its cache; one that hangs times out', async ({ request }) => {
    await fakeCatalog(request, { feed: 'down' });
    let listing = await catalog(request);
    expect(listing.feed).toMatchObject({ from: 'cache', stale: true });
    expect(listing.items.some((row) => row.id === ids.tampered)).toBe(true);

    await fakeCatalog(request, { feed: 'hang', resetCache: true });
    const started = Date.now();
    listing = await catalog(request);
    expect(Date.now() - started).toBeLessThan(3500);
    expect(listing.feed).toMatchObject({ from: 'none', stale: true, error: expect.stringMatching(/in time/) });
    // Still offered: the offline snapshot's module and packs.
    expect(listing.items.find((row) => row.id === ids.offline)).toBeTruthy();
    expect(listing.items.some((row) => row.kind === 'pack' && row.available?.from === 'snapshot')).toBe(true);
  });
});
