import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { wipeDatabase } from '../helpers/database';
import { validatePack } from '../../api/src/services/gamePackService';
import {
  buildGameLinks,
  gameAppIconUrl,
  linkBuiltin,
  type BuiltinGame,
} from '../../api/src/services/gameCatalogService';
import { wikidataSteamAppId } from '../../api/src/services/wikidataService';
import { clientIconHash } from '../../api/src/services/gameIconService';
import {
  GAME_ICON_SIZE,
  encodePng,
  icoFrames,
  toGameIconPng,
} from '../../api/src/utils/iconImage';

/**
 * App icons in the game pills, for every game a player can pick.
 *
 * A game a Wikidata search finds is linked to the module or pack for the
 * same game — by IGDB id (a row stored while IGDB search still existed),
 * then slug, then a slug alias, then the name — and draws that one's app
 * icon. A game no module or pack covers gets its Steam client icon, fetched
 * in the background and cached on the data volume. A game with neither has
 * no icon, and the pill draws a monogram: never a cropped cover.
 *
 * Nothing here reaches the real Wikidata or Steam: the fakes in
 * routes/test.ts answer for both.
 *
 * @tag api
 * @tag games
 */

// ---------------------------------------------------------------------------
// Pictures built in the test, so every byte is known
// ---------------------------------------------------------------------------

function solid(size: number, rgba: [number, number, number, number]) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) data.set(rgba, i * 4);
  return { width: size, height: size, data };
}

/** A 32-bit BMP frame as an `.ico` stores it: header, bottom-up BGRA rows, AND mask. */
function bmpFrame(size: number, rgba: [number, number, number, number]): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    pixels.set([rgba[2], rgba[1], rgba[0], rgba[3]], i * 4);
  }
  const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
  return Buffer.concat([header, pixels, mask]);
}

/** An `.ico` of the given frames, in the order given. */
function ico(frames: Array<{ size: number; bytes: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = 6 + frames.length * 16;
  const entries = frames.map(({ size, bytes }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(bytes.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += bytes.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.bytes)]);
}

function pixelAt(png: Buffer, x: number, y: number) {
  const image = PNG.sync.read(png);
  const i = (y * image.width + x) * 4;
  return { width: image.width, height: image.height, rgba: [...image.data.subarray(i, i + 4)] };
}

// ---------------------------------------------------------------------------
// Linking a stored game to a module or pack
// ---------------------------------------------------------------------------

function builtin(overrides: Partial<BuiltinGame> & { slug: string; name: string }): BuiltinGame {
  return {
    aliases: [],
    integrationId: 'manual-report',
    viaCatchAll: true,
    own: false,
    icon: null,
    appIcon: `/api/packs/${overrides.slug}/app-icon`,
    igdbId: null,
    ...overrides,
  };
}

const BUILTINS: BuiltinGame[] = [
  builtin({
    slug: 'counter-strike-2',
    name: 'Counter-Strike 2',
    aliases: ['cs2', 'cs'],
    igdbId: 242408,
    appIcon: '/games/counter-strike-2-app-icon.webp',
  }),
  builtin({ slug: 'deadlock', name: 'Deadlock', igdbId: 301298 }),
  builtin({ slug: 'dota-2', name: 'Dota 2', aliases: ['dota'], igdbId: 2963 }),
  builtin({ slug: 'chess', name: 'Chess' }),
];

test.describe('Linking a stored game to its module or pack', () => {
  const links = buildGameLinks(BUILTINS);
  const link = (row: { igdb_id: number | null; slug: string; name: string }) =>
    linkBuiltin(row, links)?.slug ?? null;

  test('by IGDB id first, whatever the slug and name', { tag: ['@api', '@games'] }, () => {
    expect(link({ igdb_id: 242408, slug: 'cs2-something', name: 'Something' })).toBe('counter-strike-2');
    expect(link({ igdb_id: 2963, slug: 'dota-2--1', name: 'DOTA 2' })).toBe('dota-2');
  });

  test('then its own slug, then a slug alias, then the name', { tag: ['@api', '@games'] }, () => {
    // The built-in's own row, even when IGDB filled it with another game.
    expect(link({ igdb_id: 31699, slug: 'deadlock', name: 'Deadlock' })).toBe('deadlock');
    expect(link({ igdb_id: null, slug: 'cs2', name: 'CS2' })).toBe('counter-strike-2');
    expect(link({ igdb_id: null, slug: 'dota-2-wikidata', name: 'Dota 2' })).toBe('dota-2');
    // No IGDB id on the pack: a name is enough.
    expect(link({ igdb_id: 4711, slug: 'chess-deluxe', name: 'Chess' })).toBe('chess');
  });

  test('never a name or alias match that is a different game by IGDB id', {
    tag: ['@api', '@games'],
  }, () => {
    // "DeadLock (2021)" is not Valve's Deadlock.
    expect(link({ igdb_id: 157000, slug: 'deadlock--1', name: 'DeadLock' })).toBeNull();
    expect(link({ igdb_id: 555, slug: 'cs2', name: 'Cs2' })).toBeNull();
    expect(link({ igdb_id: null, slug: 'hollow-knight', name: 'Hollow Knight' })).toBeNull();
  });

  test("the pill's icon: the linked one, else the cached one, else none", {
    tag: ['@api', '@games'],
  }, () => {
    const cached = '/api/games/icons/0123456789abcdef.png';
    expect(gameAppIconUrl({ igdb_id: 2963, slug: 'x', name: 'x', icon_url: cached }, links)).toBe(
      '/api/packs/dota-2/app-icon'
    );
    expect(gameAppIconUrl({ igdb_id: 1, slug: 'celeste', name: 'Celeste', icon_url: cached }, links)).toBe(
      cached
    );
    expect(gameAppIconUrl({ igdb_id: 1, slug: 'celeste', name: 'Celeste', icon_url: null }, links)).toBeNull();
  });

  test('a pack may name its IGDB id, as a positive whole number', { tag: ['@api', '@packs'] }, () => {
    const pack = (igdbId: unknown) => ({
      schema: 1,
      slug: 'igdb-id-test-game',
      name: 'IGDB Id Test Game',
      engine: 'manual-report',
      igdbId,
    });
    const ok = validatePack(pack(2963));
    expect(ok.ok && ok.pack.igdbId).toBe(2963);
    for (const bad of [0, -1, 1.5, '2963', null]) {
      const result = validatePack(pack(bad));
      expect(result.ok, `${JSON.stringify(bad)} should be refused`).toBe(false);
      expect(!result.ok && result.error).toContain('igdbId');
    }
  });

  test('every bundled pack names a real IGDB id, or none on purpose', { tag: ['@api', '@packs'] }, () => {
    const index = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../api/bundled-packs/index.json'), 'utf8')
    ) as { packs: Array<{ slug: string; file: string; igdbId?: number }> };
    const ids = new Set<number>();
    for (const entry of index.packs) {
      const file = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../../api/bundled-packs', entry.file), 'utf8')
      ) as { igdbId?: number };
      // The index repeats the pack's own id, so a pack not yet installed links too.
      expect(entry.igdbId, `${entry.slug}: index and pack disagree`).toBe(file.igdbId);
      if (entry.igdbId === undefined) continue;
      expect(ids.has(entry.igdbId), `${entry.slug}: IGDB id used twice`).toBe(false);
      ids.add(entry.igdbId);
    }
    // A franchise and a board game have no single IGDB entry.
    expect(index.packs.filter((entry) => entry.igdbId === undefined).map((entry) => entry.slug)).toEqual([
      'call-of-duty',
      'chess',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Steam ids and Steam icons
// ---------------------------------------------------------------------------

test.describe('Steam app ids and client icons', () => {
  test("a game's Steam app id from Wikidata", { tag: ['@api', '@games'] }, () => {
    const claim = (value: unknown) => ({ mainsnak: { datavalue: { value } } });
    expect(wikidataSteamAppId({ claims: { P1733: [claim('252950')] } })).toBe(252950);
    expect(wikidataSteamAppId({ claims: { P1733: [claim('not-a-number')] } })).toBeNull();
    expect(wikidataSteamAppId({ claims: {} })).toBeNull();

    expect(clientIconHash({ data: { '570': { common: { clienticon: 'A'.repeat(40) } } } }, 570)).toBe(
      'a'.repeat(40)
    );
    expect(clientIconHash({ data: { '570': { common: {} } } }, 570)).toBeNull();
    expect(clientIconHash({ data: { '570': { common: { clienticon: '../x' } } } }, 570)).toBeNull();
  });

  test('the largest frame of an .ico becomes a 128 px PNG', { tag: ['@api', '@games'] }, () => {
    const icon = ico([
      { size: 32, bytes: bmpFrame(32, [0, 0, 255, 255]) },
      { size: 256, bytes: encodePng(solid(256, [255, 70, 85, 255])) },
      { size: 64, bytes: bmpFrame(64, [0, 255, 0, 255]) },
    ]);
    expect(icoFrames(icon)?.map((frame) => [frame.width, frame.png])).toEqual([
      [32, false],
      [256, true],
      [64, false],
    ]);
    const png = toGameIconPng(icon)!;
    const { width, height, rgba } = pixelAt(png, 64, 64);
    expect([width, height]).toEqual([GAME_ICON_SIZE, GAME_ICON_SIZE]);
    expect(rgba).toEqual([255, 70, 85, 255]);
  });

  test('a BMP frame is read, and a small one is never scaled up', { tag: ['@api', '@games'] }, () => {
    const png = toGameIconPng(ico([{ size: 64, bytes: bmpFrame(64, [10, 200, 30, 255]) }]))!;
    const { width, rgba } = pixelAt(png, 10, 10);
    expect(width).toBe(64);
    expect(rgba).toEqual([10, 200, 30, 255]);
  });

  test('anything else is no icon: too small, not square, not an image', { tag: ['@api', '@games'] }, () => {
    expect(toGameIconPng(ico([{ size: 32, bytes: encodePng(solid(32, [1, 2, 3, 255])) }]))).toBeNull();
    expect(
      toGameIconPng(encodePng({ width: 128, height: 64, data: Buffer.alloc(128 * 64 * 4, 255) }))
    ).toBeNull();
    expect(toGameIconPng(Buffer.from('<html>404</html>'))).toBeNull();
    expect(toGameIconPng(Buffer.alloc(0))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Over HTTP
// ---------------------------------------------------------------------------

interface GameSummary {
  id: number;
  slug: string;
  name: string;
  coverUrl: string | null;
  appIconUrl: string | null;
}

const CACHED_ICON = /^\/api\/games\/icons\/[a-f0-9]{16}\.png$/;

async function post(request: APIRequestContext, url: string, data: unknown = {}) {
  const res = await request.post(url, { data });
  expect(res.ok(), `POST ${url}: ${await res.text()}`).toBe(true);
  return res.json();
}

async function search(request: APIRequestContext, q: string): Promise<GameSummary[]> {
  const res = await request.get(`/api/games/search?q=${encodeURIComponent(q)}`);
  expect(res.ok(), `search ${q}: ${await res.text()}`).toBe(true);
  return ((await res.json()) as { games: GameSummary[] }).games;
}

async function runIconPass(request: APIRequestContext): Promise<number> {
  return ((await post(request, '/api/test/game-icons/run')) as { stored: number }).stored;
}

async function playerPicks(playwright: Playwright, baseURL: string | undefined, ids: number[]) {
  const ctx = await playwright.request.newContext({ baseURL });
  const steamId = `7656119${String(Date.now() % 1e10).padStart(10, '0')}`;
  await post(ctx, '/api/test/login-player', { steamId });
  const put = await ctx.put('/api/me/games', { data: ids });
  expect(put.ok(), await put.text()).toBe(true);
  const games = ((await (await ctx.get('/api/me/games')).json()) as { games: GameSummary[] }).games;
  await ctx.dispose();
  return games;
}

test.describe.serial('Game icons over HTTP', () => {
  test.beforeAll(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    expect(await wipeDatabase(request)).toBe(true);
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    await post(request, '/api/test/wikidata', { fake: true });
    await post(request, '/api/test/game-icons', { fake: true });
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.post('/api/test/wikidata', { data: { fake: false } });
    await request.post('/api/test/game-icons', { data: { fake: false } });
  });

  test('a Wikidata result linked to a module by slug alias draws that module\'s icon', {
    tag: ['@api', '@games'],
  }, async ({ request, playwright, baseURL }) => {
    // Installed modules are built-ins too, found by alias — proof that the
    // module's own app icon, not a catalogue picture, draws for its pill.
    const [cs2] = await search(request, 'cs2');
    expect(cs2).toMatchObject({ slug: 'counter-strike-2' });
    expect(cs2.appIconUrl).toBe('/games/counter-strike-2-app-icon.webp');

    // A game an installed pack ships (Dota 2), found by its Wikidata name.
    const [dota] = await search(request, 'dota 2');
    expect(dota).toMatchObject({ slug: 'dota-2' });
    expect(dota.appIconUrl).toBe('/api/packs/dota-2/app-icon');

    // And so in a player's own games.
    const games = await playerPicks(playwright, baseURL, [cs2.id, dota.id]);
    expect(games.map((game) => game.appIconUrl)).toEqual([
      '/games/counter-strike-2-app-icon.webp',
      '/api/packs/dota-2/app-icon',
    ]);
  });

  test('an installed pack without its own icon still shows its game icon', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const slug = 'dota-2';
    try {
      // What an instance that installed Dota 2 from the catalog before its
      // pack had an icon holds: the game, and no picture.
      const created = await request.post('/api/packs', {
        data: { pack: { schema: 1, slug, name: 'Dota 2', engine: 'manual-report', version: '0.0.1' } },
      });
      expect(created.status(), await created.text()).toBe(200);

      const popular = ((await (await request.get('/api/games/popular')).json()) as {
        games: GameSummary[];
      }).games;
      expect(popular.find((game) => game.slug === slug)?.appIconUrl).toBe(`/api/packs/${slug}/app-icon`);

      const icon = await request.get(`/api/packs/${slug}/app-icon`);
      expect(icon.status()).toBe(200);
      const bundled = fs.readFileSync(path.join(__dirname, `../../api/bundled-packs/app-icons/${slug}.webp`));
      expect(Buffer.compare(await icon.body(), bundled)).toBe(0);
    } finally {
      // Back exactly as a fresh install has it: bundled.
      await request.delete(`/api/packs/${slug}`);
      await post(request, '/api/test/packs/reseed', { forget: [slug], preinstall: [slug] });
    }
  });

  test('a game no pack covers gets its Steam client icon, cached', {
    tag: ['@api', '@games'],
  }, async ({ request }) => {
    const before = await search(request, 'icon quest');
    expect(before.map((game) => game.slug).sort()).toEqual([
      'icon-quest',
      'icon-quest-legacy',
      'icon-quest-offline',
      'icon-quest-tiny',
    ]);
    // Nothing yet: the lookup runs in the background, never in the request.
    expect(before.every((game) => game.appIconUrl === null)).toBe(true);

    expect(await runIconPass(request)).toBeGreaterThanOrEqual(1);

    const after = new Map((await search(request, 'icon quest')).map((game) => [game.slug, game]));
    const quest = after.get('icon-quest')!.appIconUrl!;
    expect(quest).toMatch(CACHED_ICON);
    // Only on the older CDN path: found by the fallback. Same picture, same
    // file — a cached icon is named by its bytes.
    expect(after.get('icon-quest-legacy')!.appIconUrl).toBe(quest);
    // A 32 px icon is not worth more than a monogram; no Steam id, no lookup.
    expect(after.get('icon-quest-tiny')!.appIconUrl).toBeNull();
    expect(after.get('icon-quest-offline')!.appIconUrl).toBeNull();

    const served = await request.get(quest);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/png');
    expect(served.headers()['cache-control']).toContain('immutable');
    expect(served.headers()['x-content-type-options']).toBe('nosniff');
    const { width, height, rgba } = pixelAt(await served.body(), 0, GAME_ICON_SIZE - 1);
    expect([width, height]).toEqual([GAME_ICON_SIZE, GAME_ICON_SIZE]);
    expect(rgba).toEqual([250, 99, 42, 255]);
  });

  test('a Wikidata game gets its Steam icon too', {
    tag: ['@api', '@games'],
  }, async ({ request }) => {
    const [voyage] = await search(request, 'icon voyage');
    expect(voyage).toMatchObject({ slug: 'icon-voyage', appIconUrl: null });

    await runIconPass(request);

    const [after] = await search(request, 'icon voyage');
    expect(after.appIconUrl).toMatch(CACHED_ICON);
  });

  test('every popular game has an icon', { tag: ['@api', '@games'] }, async ({ request }) => {
    const popular = ((await (await request.get('/api/games/popular')).json()) as {
      games: GameSummary[];
    }).games;
    expect(popular.length).toBeGreaterThan(20);
    const missing = popular.filter((game) => !game.appIconUrl).map((game) => game.slug);
    expect(missing, 'popular games without an app icon').toEqual([]);
  });

  test('the icon route serves cached icons and nothing else', { tag: ['@api', '@games'] }, async ({ request }) => {
    expect((await request.get('/api/games/icons/0123456789abcdef.png')).status()).toBe(404);
    expect((await request.get('/api/games/icons/..%2F..%2Fpackage.json')).status()).toBe(404);
    expect((await request.get('/api/games/icons/0123456789abcdef.svg')).status()).toBe(404);
  });
});
