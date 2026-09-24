import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The games an instance ships with are packs, seeded once — and after that
 * they belong to the admin.
 *
 * The platform carries no list of games in its source any more. A fresh
 * install gets `api/bundled-packs` (a committed snapshot of
 * `Auto-Tournament/packs`) installed on first boot. What matters is what
 * happens *after* that, because the seed runs again on every restart:
 *
 * - a game an admin removed must **stay** removed. A game that comes back on
 *   every restart is a game nobody can get rid of.
 * - a game an admin replaced with their own pack of the same slug must stay
 *   theirs, whatever the image carries.
 *
 * Restarting the process is not something a spec can do, so
 * `POST /api/test/packs/reseed` runs exactly the seeding a restart runs.
 *
 * @tag api
 * @tag packs
 */

const BUNDLED = (
  JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../api/bundled-packs/index.json'), 'utf8')
  ) as { packs: Array<{ slug: string; name: string; version: string }> }
).packs;

/** A bundled game no other spec builds a tournament on. */
const VICTIM = 'age-of-empires-ii';

type Listed = { slug: string; name: string; source: string; version: string | null; hasIcon: boolean };

async function listPacks(request: APIRequestContext): Promise<Listed[]> {
  const response = await request.get('/api/packs');
  expect(response.ok(), `listing packs: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { packs: Listed[] }).packs;
}

async function reseed(request: APIRequestContext) {
  const response = await request.post('/api/test/packs/reseed');
  expect(response.ok(), `reseeding: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { report: Record<string, string[]> }).report;
}

/** Put the victim back exactly as a fresh install has it: bundled. */
async function restore(request: APIRequestContext): Promise<void> {
  await request.delete(`/api/packs/${VICTIM}`);
  const response = await request.post('/api/test/packs/reseed', { data: { forget: [VICTIM] } });
  expect(response.ok(), `restoring ${VICTIM}: ${await response.text()}`).toBe(true);
  const back = (await listPacks(request)).find((pack) => pack.slug === VICTIM);
  expect(back?.source, `${VICTIM} should be bundled again`).toBe('bundled');
}

test.describe.serial('Bundled game packs', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('every game the image ships is installed, with its tile, as bundled', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const packs = await listPacks(request);
    const bySlug = new Map(packs.map((pack) => [pack.slug, pack]));

    for (const entry of BUNDLED) {
      const installed = bySlug.get(entry.slug);
      expect(installed, `${entry.slug} should be installed on a fresh instance`).toBeTruthy();
      expect(installed!.source, entry.slug).toBe('bundled');
      expect(installed!.version, entry.slug).toBe(entry.version);
      expect(installed!.hasIcon, `${entry.slug} should have its tile`).toBe(true);
    }

    // And each is a game a tournament can be created for, drawn with its own
    // tile served from this instance — not `/games/<slug>.svg`, which is
    // where two of them used to point at a file no build contained.
    const playable = await request.get('/api/games/playable');
    const games = (await playable.json()).games as Array<{
      slug: string;
      integrationId: string | null;
      moduleIcon: string | null;
    }>;
    for (const entry of BUNDLED) {
      const game = games.find((row) => row.slug === entry.slug);
      expect(game, `${entry.slug} should be playable`).toBeTruthy();
      expect(game!.integrationId, entry.slug).toBe('manual-report');
      expect(game!.moduleIcon, entry.slug).toBe(`/api/packs/${entry.slug}/icon.svg`);
    }

    // Spot-check that a tile really is served, and is an SVG.
    const tile = await request.get(`/api/packs/${BUNDLED[0].slug}/icon.svg`);
    expect(tile.ok()).toBe(true);
    expect(tile.headers()['content-type']).toContain('image/svg+xml');
  });

  test('seeding again changes nothing on an instance nobody touched', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const report = await reseed(request);
    expect(report.installed, 'nothing new to install').toEqual([]);
    expect(report.updated, 'nothing new to update').toEqual([]);
    expect(report.skipped, 'every bundled pack validates').toEqual([]);
  });

  test('a bundled game an admin removed stays removed', { tag: ['@api', '@packs'] }, async ({
    request,
  }) => {
    try {
      const removed = await request.delete(`/api/packs/${VICTIM}`);
      expect(removed.status(), `removing: ${await removed.text()}`).toBe(200);

      // What a restart does.
      const report = await reseed(request);
      expect(report.installed, 'the removed game must not be reinstalled').not.toContain(VICTIM);
      expect(report.keptRemoved).toContain(VICTIM);

      const packs = await listPacks(request);
      expect(packs.find((pack) => pack.slug === VICTIM)).toBeUndefined();

      // Which also means the wizard stops offering it as a pack.
      const playable = await request.get('/api/games/playable');
      const games = (await playable.json()).games as Array<{ slug: string; moduleIcon: string | null }>;
      const row = games.find((game) => game.slug === VICTIM);
      expect(row?.moduleIcon ?? null, 'no pack tile for a removed pack').toBeNull();
    } finally {
      await restore(request);
    }
  });

  test("a bundled game an admin replaced stays the admin's", { tag: ['@api', '@packs'] }, async ({
    request,
  }) => {
    try {
      const file = path.join(__dirname, `../../api/bundled-packs/packs/${VICTIM}.json`);
      const pack = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;

      const replaced = await request.post('/api/packs', {
        data: { pack: { ...pack, name: 'Age of Empires II (our house rules)', version: '9.9.9' } },
      });
      expect(replaced.status(), `replacing: ${await replaced.text()}`).toBe(200);

      const report = await reseed(request);
      expect(report.keptOverridden).toContain(VICTIM);
      expect(report.updated).not.toContain(VICTIM);

      const mine = (await listPacks(request)).find((row) => row.slug === VICTIM);
      expect(mine?.name).toBe('Age of Empires II (our house rules)');
      expect(mine?.source).toBe('uploaded');
    } finally {
      await restore(request);
    }
  });
});
