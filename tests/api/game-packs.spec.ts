import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Game packs: a game an admin imported as a file, rather than one a module
 * shipped.
 *
 * A pack is data — no code — so the things worth pinning are the refusals.
 * An import that quietly half-works is the failure mode that matters: a pack
 * written for a newer schema, a slug a module already owns, an engine that
 * cannot run someone else's game, and above all a tile carrying a script.
 * Pack tiles are served from our own origin and inlined into the admin's
 * page, so a tile that gets through the allowlist is a stored cross-site
 * script.
 *
 * @tag api
 * @tag packs
 */

const TILE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="var(--at-ember, #ff6a3d)"/><path d="M2 2h12v12H2z" fill="var(--at-ink-900, #121213)"/></svg>';

function pack(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    slug: 'packs-test-game',
    name: 'Packs Test Game',
    engine: 'manual-report',
    aliases: ['ptg'],
    version: '1.0.0',
    description: 'A game that exists only in this test.',
    icon: TILE,
    report: { confirmation: 'opponent', confirmTimeoutMin: 30 },
    stats: [{ key: 'goals', label: 'Goals', type: 'integer', scope: 'player' }],
    ...overrides,
  };
}

async function removeIfPresent(admin: APIRequestContext, slug: string): Promise<void> {
  await admin.delete(`/api/packs/${slug}`);
}

test.describe.serial('Game packs', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await removeIfPresent(request, 'packs-test-game');
  });

  test('an imported pack becomes a supported game with its own tile', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const created = await request.post('/api/packs', { data: pack() });
    expect(created.status(), `importing: ${await created.text()}`).toBe(200);
    expect((await created.json()).updated).toBe(false);

    // It is listed, with the engine that will run it.
    const list = await request.get('/api/packs');
    expect(list.ok()).toBe(true);
    const listed = ((await list.json()).packs as Array<Record<string, unknown>>).find(
      (row) => row.slug === 'packs-test-game'
    );
    expect(listed).toBeTruthy();
    expect(listed!.engine).toBe('manual-report');
    expect(listed!.statFieldCount).toBe(1);

    // And a tournament can be created for it: the setup wizard lists it as
    // playable, run by the module named in the pack.
    const playable = await request.get('/api/games/playable');
    expect(playable.ok()).toBe(true);
    const game = ((await playable.json()).games as Array<Record<string, unknown>>).find(
      (row) => row.slug === 'packs-test-game'
    );
    expect(game, 'the imported game should be playable').toBeTruthy();
    expect(game!.integrationId).toBe('manual-report');
    expect(game!.moduleIcon).toBe('/api/packs/packs-test-game/icon.svg');

    // The tile is served as SVG, from our own origin, so the client can inline
    // it and let it follow the theme.
    const icon = await request.get('/api/packs/packs-test-game/icon.svg');
    expect(icon.ok()).toBe(true);
    expect(icon.headers()['content-type']).toContain('image/svg+xml');
    expect(await icon.text()).toContain('var(--at-ember');
  });

  test('re-importing the same slug updates it in place', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    expect((await request.post('/api/packs', { data: pack() })).status()).toBe(200);

    const again = await request.post('/api/packs', {
      data: pack({ name: 'Packs Test Game 2', version: '2.0.0' }),
    });
    expect(again.status(), `re-importing: ${await again.text()}`).toBe(200);
    expect((await again.json()).updated).toBe(true);

    const list = await request.get('/api/packs');
    const rows = (await list.json()).packs as Array<Record<string, unknown>>;
    expect(rows.filter((row) => row.slug === 'packs-test-game')).toHaveLength(1);
    expect(rows.find((row) => row.slug === 'packs-test-game')!.version).toBe('2.0.0');
  });

  test('a tile carrying anything that runs is refused', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const refused: Array<[string, string]> = [
      ['a script element', '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>'],
      ['an event handler', '<svg viewBox="0 0 1 1"><path d="M0 0" onload="alert(1)"/></svg>'],
      [
        'a foreignObject',
        '<svg viewBox="0 0 1 1"><foreignObject><div>hi</div></foreignObject></svg>',
      ],
      [
        'an external reference',
        '<svg viewBox="0 0 1 1"><use href="https://example.com/x.svg#a"/></svg>',
      ],
      [
        'a style that loads',
        '<svg viewBox="0 0 1 1"><path d="M0 0" style="fill:url(https://example.com/x)"/></svg>',
      ],
      ['an entity declaration', '<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>'],
      ['no viewBox', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'],
    ];

    for (const [what, icon] of refused) {
      const response = await request.post('/api/packs', { data: pack({ icon }) });
      expect(response.status(), `a tile with ${what} should be refused`).toBe(400);
      expect(await response.text()).toContain('error');
    }

    // None of them left anything behind.
    const list = await request.get('/api/packs');
    const rows = (await list.json()).packs as Array<Record<string, unknown>>;
    expect(rows.find((row) => row.slug === 'packs-test-game')).toBeUndefined();
  });

  test('a pack that is wrong in any other way is refused with the reason', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['a newer schema', pack({ schema: 2 }), 'schema'],
      ['a slug a module ships', pack({ slug: 'rocket-league' }), 'manual-report'],
      ['CS2 as the engine', pack({ engine: 'cs2' }), 'only runs the games it ships'],
      ['an engine that is not installed', pack({ engine: 'halo' }), 'not installed'],
      ['an unknown field', { ...pack(), wat: true }, 'unknown field'],
      ['a slug with spaces', pack({ slug: 'not a slug' }), 'slug'],
      ['no name', pack({ name: '   ' }), 'name is required'],
      [
        'a stat field with no label',
        pack({ stats: [{ key: 'goals', label: '', type: 'integer', scope: 'player' }] }),
        'label',
      ],
      [
        'a stat field with a made-up type',
        pack({ stats: [{ key: 'goals', label: 'Goals', type: 'vector', scope: 'player' }] }),
        'integer, decimal or text',
      ],
    ];

    for (const [what, body, expected] of cases) {
      const response = await request.post('/api/packs', { data: body });
      expect(response.status(), `${what} should be refused`).toBe(400);
      expect((await response.json()).error, `${what} should say why`).toContain(expected);
    }
  });

  test('importing and removing need an admin', { tag: ['@api', '@packs'] }, async ({
    request,
    playwright,
  }, testInfo) => {
    expect((await request.post('/api/packs', { data: pack() })).status()).toBe(200);

    // A context with no session cookie at all, against the same server.
    const stranger = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
    });
    try {
      const imported = await stranger.post('/api/packs', {
        data: pack({ slug: 'packs-test-stranger' }),
      });
      expect([401, 403], 'a stranger should not be able to import').toContain(imported.status());

      const removed = await stranger.delete('/api/packs/packs-test-game');
      expect([401, 403], 'a stranger should not be able to remove').toContain(removed.status());

      // The tile stays readable without signing in: the setup wizard's game
      // step fetches it for anyone who can see the step.
      const icon = await stranger.get('/api/packs/packs-test-game/icon.svg');
      expect(icon.ok(), 'the tile is public').toBe(true);
    } finally {
      await stranger.dispose();
    }
  });

  test('a pack a tournament is running cannot be removed', {
    tag: ['@api', '@packs'],
  }, async ({ request }) => {
    expect((await request.post('/api/packs', { data: pack() })).status()).toBe(200);

    const teams: string[] = [];
    const stamp = `${Date.now()}`.slice(-7);
    for (let index = 0; index < 2; index++) {
      const id = `packs-${stamp}-${index}`;
      const created = await request.post('/api/teams', {
        data: {
          id,
          name: `Packs ${stamp} ${index}`,
          players: [{ steamId: `76561199${stamp}${index}0`, name: `Packs ${index}` }],
        },
      });
      expect(created.ok(), `creating team ${id}: ${await created.text()}`).toBe(true);
      teams.push(id);
    }

    // Through the real endpoint, not the module's test helper: a pack's slug
    // reaching `resolveGameRef` is the whole claim being made here — an
    // imported game is a game a tournament can be created for.
    const tournament = await request.post('/api/tournament', {
      data: {
        name: 'Packs test tournament',
        type: 'single_elimination',
        format: 'bo1',
        game: 'packs-test-game',
        teamIds: teams,
        maps: [],
      },
    });
    expect(tournament.status(), `creating tournament: ${await tournament.text()}`).toBe(200);

    try {
      const refused = await request.delete('/api/packs/packs-test-game');
      expect(refused.status(), 'a pack in use should not be removable').toBe(409);
    } finally {
      await request.delete('/api/tournament');
    }

    const removed = await request.delete('/api/packs/packs-test-game');
    expect(removed.status(), `removing: ${await removed.text()}`).toBe(200);

    const list = await request.get('/api/packs');
    const rows = (await list.json()).packs as Array<Record<string, unknown>>;
    expect(rows.find((row) => row.slug === 'packs-test-game')).toBeUndefined();
  });
});
