import fs from 'fs';
import path from 'path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  MAX_APP_ICON_BYTES,
  checkAppIcon,
  checkAppIconPath,
  validatePack,
} from '../../api/src/services/gamePackService';
import { pickIgdbMatch } from '../../api/src/services/gameEnrichmentService';

/**
 * App icons: the square picture a player knows their game by, drawn in the
 * 20 px game pills instead of a sliver of the game's wide wordmark.
 *
 * A pack names the file (`appIcon`); the bytes are checked when the pack is
 * imported, like a tile, and refused rather than fixed up when they are not a
 * small square PNG or WebP.
 *
 * @tag api
 * @tag packs
 */

const FIXTURES = path.join(__dirname, '../fixtures/app-icons');
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name));
const BUNDLED_ICONS = path.join(__dirname, '../../api/bundled-packs/app-icons');

function pack(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    slug: 'app-icon-test-game',
    name: 'App Icon Test Game',
    engine: 'manual-report',
    version: '1.0.0',
    appIcon: '../app-icons/app-icon-test-game.webp',
    ...overrides,
  };
}

test.describe('App icon checks', () => {
  test('a small square PNG or WebP is accepted, whatever its header flavour', {
    tag: ['@api', '@packs'],
  }, () => {
    for (const [name, type] of [
      ['square-128.webp', 'image/webp'], // lossy (VP8)
      ['square-128-lossless.webp', 'image/webp'], // lossless (VP8L)
      ['square-64.png', 'image/png'],
    ] as const) {
      const checked = checkAppIcon(fixture(name));
      expect(typeof checked, `${name} should pass`).toBe('object');
      expect((checked as { type: string }).type).toBe(type);
    }
  });

  test('every app icon in the bundled snapshot passes', { tag: ['@api', '@packs'] }, () => {
    const files = fs.readdirSync(BUNDLED_ICONS);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(BUNDLED_ICONS, file));
      expect(checkAppIcon(bytes), `${file} should pass the import check`).toHaveProperty('type');
    }
    // CS2's ships with the client, next to its tile.
    const cs2 = fs.readFileSync(
      path.join(__dirname, '../../client/public/games/counter-strike-2-app-icon.webp')
    );
    expect(checkAppIcon(cs2)).toHaveProperty('type', 'image/webp');
  });

  test('anything else is refused with the reason', { tag: ['@api', '@packs'] }, () => {
    const cases: Array<[string, Buffer, string]> = [
      ['an oversized file', fixture('noisy-100.png'), 'larger than 25 KB'],
      ['a GIF', fixture('square-64.gif'), 'PNG or WebP'],
      ['SVG markup', Buffer.from('<svg viewBox="0 0 1 1"/>'), 'PNG or WebP'],
      ['a wide image', fixture('wide-128x64.png'), 'square'],
      ['nothing', Buffer.alloc(0), 'empty'],
    ];
    expect(fixture('noisy-100.png').length).toBeGreaterThan(MAX_APP_ICON_BYTES);
    for (const [what, bytes, reason] of cases) {
      const checked = checkAppIcon(bytes);
      expect(typeof checked, `${what} should be refused`).toBe('string');
      expect(checked as string).toContain(reason);
    }
  });

  test('a pack names its app icon as a relative PNG or WebP path', {
    tag: ['@api', '@packs'],
  }, () => {
    const ok = validatePack(pack());
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.pack.appIcon).toBe('../app-icons/app-icon-test-game.webp');
    expect(checkAppIconPath('../app-icons/x.png')).toBeNull();

    for (const [value, reason] of [
      ['https://example.com/x.webp', 'not a URL'],
      ['/etc/x.webp', 'relative path'],
      ['../app-icons/x.svg', '.png or .webp'],
      ['../app-icons/x..webp', 'malformed'],
    ]) {
      const result = validatePack(pack({ appIcon: value }));
      expect(result.ok, `${value} should be refused`).toBe(false);
      expect(!result.ok && result.error).toContain(reason);
    }
  });

  test('a stored game only takes an IGDB match that is really the same game', {
    tag: ['@api'],
  }, () => {
    const igdb = (slug: string, name: string) => ({
      igdbId: slug.length,
      slug,
      name,
      coverUrl: null,
      logoUrl: null,
      releaseYear: null,
      genres: [],
    });
    const results = [igdb('valorant-mobile', 'Valorant Mobile'), igdb('valorant', 'VALORANT')];
    // Same slug, or the same name once case and punctuation are gone.
    expect(pickIgdbMatch({ slug: 'valorant', name: 'Valorant' }, results)?.slug).toBe('valorant');
    expect(
      pickIgdbMatch({ slug: 'cs-2', name: 'Counter Strike 2' }, [
        igdb('counter-strike-2', 'Counter-Strike 2'),
      ])?.slug
    ).toBe('counter-strike-2');
    // A near miss is never attached.
    expect(pickIgdbMatch({ slug: 'dota', name: 'Dota' }, [igdb('dota-2', 'Dota 2')])).toBeNull();
  });
});

async function removeIfPresent(admin: APIRequestContext, slug: string): Promise<void> {
  await admin.delete(`/api/packs/${slug}`);
}

test.describe.serial('App icons over HTTP', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await removeIfPresent(request, 'app-icon-test-game');
  });

  test('an imported app icon is served and named on the game', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const created = await request.post('/api/packs', {
      data: { pack: pack(), appIcon: fixture('square-128.webp').toString('base64') },
    });
    expect(created.status(), `importing: ${await created.text()}`).toBe(200);

    const icon = await request.get('/api/packs/app-icon-test-game/app-icon');
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toBe('image/webp');
    expect(icon.headers()['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(await icon.body(), fixture('square-128.webp'))).toBe(0);

    const playable = await request.get('/api/games/playable');
    const game = ((await playable.json()).games as Array<Record<string, unknown>>).find(
      (row) => row.slug === 'app-icon-test-game'
    );
    expect(game!.appIconUrl).toBe('/api/packs/app-icon-test-game/app-icon');
  });

  test('an oversized or wrong-type app icon is refused on import', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    for (const [what, name, reason] of [
      ['an oversized icon', 'noisy-100.png', 'larger than 25 KB'],
      ['a GIF', 'square-64.gif', 'PNG or WebP'],
      ['a wide icon', 'wide-128x64.png', 'square'],
    ]) {
      const response = await request.post('/api/packs', {
        data: { pack: pack(), appIcon: fixture(name).toString('base64') },
      });
      expect(response.status(), `${what} should be refused`).toBe(400);
      expect((await response.json()).error).toContain(reason);
    }
    // Nothing was installed on the way.
    expect((await request.get('/api/packs/app-icon-test-game/app-icon')).status()).toBe(404);
  });

  test('built-in games carry their app icon; a game with none carries null', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const popular = await request.get('/api/games/popular');
    expect(popular.ok()).toBe(true);
    const games = (await popular.json()).games as Array<{ slug: string; appIconUrl: string | null }>;
    const bySlug = new Map(games.map((g) => [g.slug, g.appIconUrl]));

    expect(bySlug.get('counter-strike-2')).toBe('/games/counter-strike-2-app-icon.webp');
    expect(bySlug.get('rocket-league')).toBe('/api/packs/rocket-league/app-icon');
    // No square icon exists for it from a source we can use.
    expect(bySlug.get('league-of-legends')).toBeNull();

    const icon = await request.get('/api/packs/rocket-league/app-icon');
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toBe('image/webp');
  });
});
