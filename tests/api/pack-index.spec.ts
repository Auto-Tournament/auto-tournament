import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The community pack index: adding a game without writing the file yourself.
 *
 * Every request here goes to the fake index in `routes/test.ts`, pointed at
 * by `POST /api/test/pack-index`, the same way the fake IGDB works. No test
 * reaches the real repository.
 *
 * The claim worth pinning hardest is the one an index cannot be trusted for.
 * `index.json` is a file in a repo anyone may open a pull request against,
 * so an entry naming `https://example.com/evil.json` must be dropped, not
 * fetched: otherwise a merged pull request turns every instance that opens
 * Browse into a client for whatever URL was in it.
 *
 * @tag api
 * @tag packs
 */

const SLUG = 'index-test-game';

test.describe.serial('The pack index', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const fake = await request.post('/api/test/pack-index', { data: { fake: true } });
    expect(fake.ok(), `pointing at the fake index: ${await fake.text()}`).toBe(true);
    await request.delete(`/api/packs/${SLUG}`);
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete(`/api/packs/${SLUG}`);
    await request.post('/api/test/pack-index', { data: { fake: false } });
  });

  test('lists what can be added, and never an entry pointing elsewhere', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const response = await request.get('/api/packs/index');
    expect(response.ok(), `reading the index: ${await response.text()}`).toBe(true);
    const body = (await response.json()) as {
      stale: boolean;
      entries: Array<Record<string, unknown>>;
    };
    expect(body.stale).toBe(false);

    const entry = body.entries.find((row) => row.slug === SLUG);
    expect(entry, 'the fixture game should be listed').toBeTruthy();
    expect(entry!.installed).toBe(false);
    expect(entry!.version).toBe('2.0.0');

    // The entry whose `file` is an absolute URL to another host is dropped
    // while it is being read, so nothing downstream can ever fetch it.
    expect(
      body.entries.find((row) => row.slug === 'elsewhere'),
      'an entry pointing outside the index must not be listed'
    ).toBeUndefined();
  });

  test('a listed game can be added, and is then shown as installed', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const added = await request.post(`/api/packs/index/${SLUG}`);
    expect(added.status(), `adding: ${await added.text()}`).toBe(200);
    expect((await added.json()).updated).toBe(false);

    // It is a game a tournament can be created for, exactly like an uploaded
    // pack: the index is a way of getting the file, not a second code path.
    const playable = await request.get('/api/games/playable');
    const games = (await playable.json()).games as Array<Record<string, unknown>>;
    const game = games.find((row) => row.slug === SLUG);
    expect(game, 'the added game should be playable').toBeTruthy();
    expect(game!.integrationId).toBe('manual-report');
    expect(game!.moduleIcon).toBe(`/api/packs/${SLUG}/icon.svg`);

    const index = await request.get('/api/packs/index');
    const entry = ((await index.json()).entries as Array<Record<string, unknown>>).find(
      (row) => row.slug === SLUG
    );
    expect(entry!.installed).toBe(true);
    expect(entry!.updatable, 'installed at the version the index lists').toBe(false);
  });

  test('a game the index does not list cannot be added', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const refused = await request.post('/api/packs/index/elsewhere');
    expect(refused.status()).toBe(400);
    expect((await refused.json()).error).toContain('does not list');

    const missing = await request.post('/api/packs/index/no-such-game');
    expect(missing.status()).toBe(400);
  });

  test('reading and adding need an admin', { tag: ['@api', '@packs'] }, async ({
    playwright,
  }, testInfo) => {
    const stranger = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    try {
      expect([401, 403]).toContain((await stranger.get('/api/packs/index')).status());
      expect([401, 403]).toContain((await stranger.post(`/api/packs/index/${SLUG}`)).status());
    } finally {
      await stranger.dispose();
    }
  });
});
