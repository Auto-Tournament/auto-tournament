import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * `POST /api/catalog/update-all` (DESIGN-modules §10): update every installed
 * pack and code module that has a compatible newer version, one after
 * another, through the same path a single Update uses.
 *
 * Reuses the fake catalog `POST /api/test/catalog` sets up (see
 * `api/src/routes/testCatalog.ts`): `good` and `hop` are seeded as installed
 * at 1.0.0 with a newer, validly signed release on offer, and `autobadsig` is
 * seeded the same way but its only offered release is signed by a key this
 * platform does not trust — the offline-snapshot fixture the boot-time
 * auto-update spec also uses for that failure mode.
 *
 * @tag api
 * @tag modules
 */

const RUN = `ua${Date.now().toString(36)}`;

type Ids = Record<'good' | 'hop' | 'autobadsig', string>;

interface UpdateAllResult {
  success: boolean;
  updated: Array<{ kind: 'pack' | 'module'; id: string; from: string | null; to: string | null }>;
  skipped: Array<{ kind: 'pack' | 'module'; id: string; reason: string }>;
  failed: Array<{ kind: 'pack' | 'module'; id: string; error: string }>;
  restartRequired: boolean;
}

async function fakeCatalog(request: APIRequestContext, goodVersions: string[]): Promise<Ids> {
  const response = await request.post('/api/test/catalog', { data: { fake: true, run: RUN, goodVersions, resetCache: true } });
  expect(response.status(), `fake catalog: ${await response.text()}`).toBe(200);
  return ((await response.json()) as { ids: Ids }).ids;
}

/** A fixture module on disk as an older image would have left it: 1.0.0, switched on, not loaded. */
async function seedInstalled(request: APIRequestContext, id: string): Promise<void> {
  const response = await request.post(`/api/test/modules/${id}/seed-installed`, { data: {} });
  expect(response.status(), await response.text()).toBe(200);
}

async function item(request: APIRequestContext, id: string): Promise<{ installed: { version: string | null } | null; state: string } | undefined> {
  const response = await request.get('/api/catalog');
  const listing = (await response.json()) as { items: Array<{ id: string; installed: { version: string | null } | null; state: string }> };
  return listing.items.find((row) => row.id === id);
}

test.describe.serial('Catalog update-all', () => {
  let ids: Ids;

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.post('/api/test/catalog', { data: { fake: false } });
    await request.delete('/api/test/modules/fixtures');
  });

  test('updates every updatable module in one pass; a bad signature fails without stopping the rest', async ({ request }) => {
    ids = await fakeCatalog(request, ['1.0.0', '1.1.0']);
    await seedInstalled(request, ids.good);
    await seedInstalled(request, ids.hop);
    await seedInstalled(request, ids.autobadsig);

    expect((await item(request, ids.good))?.state).toBe('update-available');
    expect((await item(request, ids.hop))?.state).toBe('update-available');
    expect((await item(request, ids.autobadsig))?.state).toBe('update-available');

    const response = await request.post('/api/catalog/update-all', { data: {}, headers: { 'Content-Type': 'application/json' } });
    const text = await response.text();
    expect(response.status(), text).toBe(200);
    const body = JSON.parse(text) as UpdateAllResult;

    expect(body.updated).toEqual([
      { kind: 'module', id: ids.good, from: '1.0.0', to: '1.1.0' },
      { kind: 'module', id: ids.hop, from: '1.0.0', to: '1.1.0' },
    ]);
    expect(body.failed).toEqual([{ kind: 'module', id: ids.autobadsig, error: expect.stringMatching(/does not trust/) }]);
    expect(body.skipped).toEqual([]);
    expect(body.restartRequired).toBe(false);

    // The two good releases really moved; the badly signed one stayed put.
    expect((await item(request, ids.good))?.installed).toMatchObject({ version: '1.1.0' });
    expect((await item(request, ids.hop))?.installed).toMatchObject({ version: '1.1.0' });
    expect((await item(request, ids.autobadsig))?.installed).toMatchObject({ version: '1.0.0' });

    // Nothing left to update: a second pass touches nothing.
    const again = await request.post('/api/catalog/update-all', { data: {}, headers: { 'Content-Type': 'application/json' } });
    expect(again.status(), await again.text()).toBe(200);
    const bodyAgain = JSON.parse(await again.text()) as UpdateAllResult;
    expect(bodyAgain.updated).toEqual([]);
    expect(bodyAgain.failed).toEqual([{ kind: 'module', id: ids.autobadsig, error: expect.stringMatching(/does not trust/) }]);
  });

  test('is admin-only, and refuses a cross-site or non-JSON request', async ({ request, playwright, baseURL }) => {
    const stranger = await playwright.request.newContext({ baseURL });
    try {
      expect((await stranger.post('/api/catalog/update-all', { data: {} })).status()).toBe(401);
    } finally {
      await stranger.dispose();
    }
    const crossSite = await request.post('/api/catalog/update-all', {
      data: {},
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    });
    expect(crossSite.status()).toBe(403);
    const notJson = await request.post('/api/catalog/update-all', { form: { a: '1' } });
    expect(notJson.status()).toBe(415);
  });
});
