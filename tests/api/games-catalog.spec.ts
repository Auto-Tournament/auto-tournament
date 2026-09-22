import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { wipeDatabase } from '../helpers/database';
import { createTestTeams } from '../helpers/teams';
import { createTournament } from '../helpers/tournaments';

/**
 * "What do you play?": the game catalogue and a player's games.
 *
 * Neither external source is ever called for real. `POST /api/test/igdb`
 * points the IGDB client at the fake IGDB + Twitch token endpoint in
 * routes/test.ts, and `POST /api/test/wikidata` does the same for Wikidata;
 * credentials are saved through the admin settings endpoint like an operator
 * would. Both fakes are on by default (`beforeEach`) so no test accidentally
 * reaches the real IGDB or Wikidata.
 *
 * @tag api
 * @tag games
 */

interface GameSummary {
  id: number;
  slug: string;
  name: string;
  coverUrl: string | null;
  releaseYear: number | null;
  supported: boolean;
  source: 'igdb' | 'wikidata' | 'builtin';
}

const FAKE_SECRET = 'fake-igdb-secret-never-returned-4711';

let counter = 0;
function uniqueSteamId(): string {
  counter += 1;
  return `7656119${String((Date.now() + counter * 7919) % 1e10).padStart(10, '0')}`;
}

async function setCredentials(
  request: APIRequestContext,
  data: { clientId: string | null; clientSecret?: string | null }
) {
  const res = await request.put('/api/settings/igdb', { data });
  expect(res.ok(), `PUT /api/settings/igdb: ${await res.text()}`).toBe(true);
  return res;
}

async function useFakeIgdb(request: APIRequestContext) {
  const res = await request.post('/api/test/igdb', { data: { fake: true } });
  expect(res.ok(), `POST /api/test/igdb: ${await res.text()}`).toBe(true);
}

async function useFakeWikidata(request: APIRequestContext) {
  const res = await request.post('/api/test/wikidata', { data: { fake: true } });
  expect(res.ok(), `POST /api/test/wikidata: ${await res.text()}`).toBe(true);
}

async function igdbCounters(request: APIRequestContext) {
  const res = await request.get('/api/test/igdb');
  expect(res.ok()).toBe(true);
  return (await res.json()) as { tokenRequests: number; searchRequests: number };
}

async function wikidataCounters(request: APIRequestContext) {
  const res = await request.get('/api/test/wikidata');
  expect(res.ok()).toBe(true);
  return (await res.json()) as { searchRequests: number; getEntitiesRequests: number };
}

async function search(request: APIRequestContext, q: string) {
  const res = await request.get(`/api/games/search?q=${encodeURIComponent(q)}`);
  expect(res.ok(), `search ${q}: ${await res.text()}`).toBe(true);
  return (await res.json()) as { games: GameSummary[]; fromIgdb: boolean; fromWikidata: boolean };
}

/** A signed-in player on their own cookie jar. */
async function playerContext(
  playwright: Playwright,
  baseURL: string | undefined,
  { gamesPrompt = false }: { gamesPrompt?: boolean } = {}
) {
  const ctx = await playwright.request.newContext({ baseURL });
  const steamId = uniqueSteamId();
  const res = await ctx.post('/api/test/login-player', { data: { steamId, gamesPrompt } });
  expect(res.ok(), `login-player: ${await res.text()}`).toBe(true);
  return { ctx, steamId };
}

test.describe.serial('Game catalogue', () => {
  test.beforeAll(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    expect(await wipeDatabase(request)).toBe(true);
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    await useFakeIgdb(request);
    await useFakeWikidata(request);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.put('/api/settings/igdb', { data: { clientId: null } });
    await request.post('/api/test/igdb', { data: { fake: false } });
    await request.post('/api/test/wikidata', { data: { fake: false } });
  });

  test(
    'without IGDB credentials, search hits Wikidata, filters non-games, and maps year/logo',
    { tag: ['@api', '@games'] },
    async ({ request }) => {
      await setCredentials(request, { clientId: null });

      // The video game enriches the existing built-in row rather than adding
      // a second one; "rocket league" (not the bare "rocket") so this does
      // not share a query-cache key with the "IGDB failure" spec below.
      const rocket = await search(request, 'rocket league');
      expect(rocket.fromWikidata).toBe(true);
      expect(rocket.fromIgdb).toBe(false);
      const rl = rocket.games.find((g) => g.slug === 'rocket-league')!;
      expect(rl).toBeTruthy();
      expect(rl.source).toBe('wikidata');
      expect(rl.releaseYear).toBe(2015);
      expect(rl.coverUrl).toBe(
        'https://commons.wikimedia.org/wiki/Special:FilePath/Rocket%20League%20logo.png?width=128'
      );

      // P18 ("image") is used when there is no P154 ("logo image").
      const cs = await search(request, 'counter-strike 2');
      const csGame = cs.games.find((g) => g.slug === 'counter-strike-2')!;
      expect(csGame).toMatchObject({ supported: true, source: 'wikidata' });
      expect(csGame.coverUrl).toBe(
        'https://commons.wikimedia.org/wiki/Special:FilePath/Counter-Strike%202%20key%20art.jpg?width=128'
      );

      // A business ("Hollow Corp", not instance-of video game) is filtered
      // out of a query it would otherwise match; the earliest of several
      // P577 values wins, in whatever order Wikidata sent them.
      const hollow = await search(request, 'hollow');
      expect(hollow.games.some((g) => g.name === 'Hollow Corp')).toBe(false);
      const hk = hollow.games.find((g) => g.slug === 'hollow-knight')!;
      expect(hk).toMatchObject({ source: 'wikidata', releaseYear: 2017, coverUrl: null });

      // A video game series (Q1150710) is only kept when nothing instance-of
      // "video game" (Q7889) matched.
      const mario = await search(request, 'mario');
      expect(mario.games.some((g) => g.name === 'Mario (franchise)')).toBe(true);

      // Installed game modules are built-ins too, found by alias.
      const cs2Alias = await search(request, 'cs2');
      expect(cs2Alias.games[0]).toMatchObject({ slug: 'counter-strike-2', supported: true });

      expect((await igdbCounters(request)).searchRequests).toBe(0);
    }
  );

  test(
    'a Wikidata failure falls back to the built-ins',
    { tag: ['@api', '@games'] },
    async ({ request }) => {
      await setCredentials(request, { clientId: null });

      const result = await search(request, 'wderror');
      expect(result.fromWikidata).toBe(false);
      expect(result.games).toEqual([]);
    }
  );

  test(
    'search goes to IGDB, upserts results, and caches the token and the query',
    { tag: ['@api', '@games'] },
    async ({ request }) => {
      const builtinRocketLeague = (await search(request, 'rocket league')).games[0];
      expect(builtinRocketLeague.slug).toBe('rocket-league');

      await setCredentials(request, { clientId: 'fake-client', clientSecret: FAKE_SECRET });
      await useFakeIgdb(request);
      // Reset Wikidata's counters here (the "wikidata not called" check below
      // covers only what happens once IGDB is configured — the lookup above,
      // with no credentials yet, legitimately went to Wikidata).
      await useFakeWikidata(request);

      const rock = await search(request, 'rock');
      expect(rock.fromIgdb).toBe(true);
      const names = rock.games.map((g) => g.name);
      expect(names).toContain('Rocket League');
      expect(names).toContain('Rocket Knight Adventures');

      // The IGDB result updated the built-in row rather than adding a second one.
      const rl = rock.games.find((g) => g.slug === 'rocket-league')!;
      expect(rl.id).toBe(builtinRocketLeague.id);
      expect(rl.coverUrl).toBe('https://images.igdb.com/igdb/image/upload/t_cover_small/fakerl.jpg');
      expect(rl.releaseYear).toBe(2015);
      expect(rock.games.find((g) => g.name === 'Rocket Knight Adventures')!.coverUrl).toBeNull();

      // Installed modules come first and are marked supported.
      const counterStrike = await search(request, 'counter');
      expect(counterStrike.games[0]).toMatchObject({ slug: 'counter-strike-2', supported: true });
      expect(counterStrike.games[0].coverUrl).toContain('fakecs2');

      let counters = await igdbCounters(request);
      expect(counters.tokenRequests).toBe(1);
      expect(counters.searchRequests).toBe(2);

      // Same query again: served from the cache, from our own rows.
      const again = await search(request, 'ROCK ');
      expect(again.games.map((g) => g.id)).toEqual(rock.games.map((g) => g.id));
      expect(again.fromIgdb).toBe(true);
      counters = await igdbCounters(request);
      expect(counters.searchRequests).toBe(2);

      // A new query reuses the cached token.
      await search(request, 'celeste');
      counters = await igdbCounters(request);
      expect(counters.tokenRequests).toBe(1);
      expect(counters.searchRequests).toBe(3);

      // IGDB is configured: Wikidata is never consulted.
      const wdCounters = await wikidataCounters(request);
      expect(wdCounters.searchRequests).toBe(0);
      expect(wdCounters.getEntitiesRequests).toBe(0);
    }
  );

  test(
    'an IGDB failure falls back to the built-ins',
    { tag: ['@api', '@games'] },
    async ({ request }) => {
      await setCredentials(request, { clientId: 'fake-client', clientSecret: FAKE_SECRET });
      await useFakeIgdb(request);

      const result = await search(request, 'explode');
      expect(result.fromIgdb).toBe(false);
      expect(result.games).toEqual([]);

      // Bad credentials: the token request fails, built-ins still answer.
      await setCredentials(request, { clientId: 'bad-client', clientSecret: FAKE_SECRET });
      const rl = await search(request, 'rocket');
      expect(rl.fromIgdb).toBe(false);
      expect(rl.games.map((g) => g.slug)).toEqual(['rocket-league']);
    }
  );

  test(
    'search needs two characters and is rate limited per IP',
    { tag: ['@api', '@games'] },
    async ({ request }) => {
      await setCredentials(request, { clientId: null });

      expect((await request.get('/api/games/search?q=r')).status()).toBe(400);
      expect((await request.get('/api/games/search')).status()).toBe(400);
      expect((await request.get('/api/games/search?q=%20r%20')).status()).toBe(400);

      await useFakeIgdb(request); // resets the limiter
      let limited = 0;
      for (let i = 0; i < 65; i++) {
        const res = await request.get('/api/games/search?q=dota');
        if (res.status() === 429) {
          limited += 1;
          expect(res.headers()['retry-after']).toBeTruthy();
        } else {
          expect(res.status()).toBe(200);
        }
      }
      expect(limited).toBe(5);
      await useFakeIgdb(request);
    }
  );

  test(
    "suggestions: an open tournament's game first, picked games left out",
    { tag: ['@api', '@games'] },
    async ({ request, playwright, baseURL }) => {
      await setCredentials(request, { clientId: null });
      await request.delete('/api/tournament');

      const before = await request.get('/api/games/suggestions');
      expect(before.ok()).toBe(true);
      const beforeGames = ((await before.json()) as { games: GameSummary[] }).games;
      expect(beforeGames).toHaveLength(3);
      expect(beforeGames.map((g) => g.slug)).not.toContain('counter-strike-2');
      expect(beforeGames[0].slug).toBe('rocket-league');

      const teams = await createTestTeams(request, 'games-suggest');
      expect(teams).toBeTruthy();
      const tournament = await createTournament(request, {
        name: 'Games suggestions',
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_dust2'],
        teamIds: teams!.map((t) => t.id),
      });
      expect(tournament).toBeTruthy();

      try {
        const withTournament = (await (await request.get('/api/games/suggestions')).json()) as {
          games: GameSummary[];
        };
        expect(withTournament.games.map((g) => g.slug)).toEqual([
          'counter-strike-2',
          'rocket-league',
          'valorant',
        ]);

        // A player who already plays CS2 and Rocket League gets the next ones.
        const { ctx } = await playerContext(playwright, baseURL);
        const ids = withTournament.games.slice(0, 2).map((g) => g.id);
        expect((await ctx.put('/api/me/games', { data: ids })).ok()).toBe(true);
        const forPlayer = (await (await ctx.get('/api/games/suggestions')).json()) as {
          games: GameSummary[];
        };
        expect(forPlayer.games.map((g) => g.slug)).toEqual([
          'valorant',
          'league-of-legends',
          'dota-2',
        ]);
        await ctx.dispose();
      } finally {
        await request.delete('/api/tournament');
      }
    }
  );

  test(
    'me/games: PUT and GET round-trip, validation, and 401 when anonymous',
    { tag: ['@api', '@games'] },
    async ({ request, playwright, baseURL }) => {
      const anon = await playwright.request.newContext({ baseURL });
      expect((await anon.get('/api/me/games')).status()).toBe(401);
      expect((await anon.put('/api/me/games', { data: [1] })).status()).toBe(401);
      expect((await anon.post('/api/me/games/prompt/dismiss')).status()).toBe(401);
      await anon.dispose();

      await setCredentials(request, { clientId: null });
      const catalogue = [
        ...(await search(request, 'rocket')).games,
        ...(await search(request, 'dota')).games,
        ...(await search(request, 'chess')).games,
      ];
      const ids = catalogue.map((g) => g.id);
      expect(ids).toHaveLength(3);

      const { ctx } = await playerContext(playwright, baseURL, { gamesPrompt: true });
      const initial = await ctx.get('/api/me/games');
      expect(initial.ok()).toBe(true);
      expect(await initial.json()).toMatchObject({ games: [], showPrompt: true });

      const put = await ctx.put('/api/me/games', { data: ids });
      expect(put.ok(), await put.text()).toBe(true);
      const saved = (await put.json()) as { games: GameSummary[]; showPrompt: boolean };
      expect(saved.games.map((g) => g.id)).toEqual(ids);
      expect(saved.showPrompt).toBe(false);

      const got = (await (await ctx.get('/api/me/games')).json()) as {
        games: GameSummary[];
        showPrompt: boolean;
      };
      expect(got.games.map((g) => g.slug)).toEqual(['rocket-league', 'dota-2', 'chess']);
      expect(got.showPrompt).toBe(false);

      // Remove one.
      const trimmed = await ctx.put('/api/me/games', { data: [ids[0], ids[2]] });
      expect(((await trimmed.json()) as { games: GameSummary[] }).games.map((g) => g.id)).toEqual([
        ids[0],
        ids[2],
      ]);

      // Clearing the list does not bring the prompt back.
      const cleared = (await (await ctx.put('/api/me/games', { data: [] })).json()) as {
        games: GameSummary[];
        showPrompt: boolean;
      };
      expect(cleared).toMatchObject({ games: [], showPrompt: false });

      expect((await ctx.put('/api/me/games', { data: { ids } })).status()).toBe(400);
      expect((await ctx.put('/api/me/games', { data: ['1'] })).status()).toBe(400);
      expect((await ctx.put('/api/me/games', { data: [99999999] })).status()).toBe(400);
      const tooMany = Array.from({ length: 31 }, (_, i) => i + 1);
      expect((await ctx.put('/api/me/games', { data: tooMany })).status()).toBe(400);
      await ctx.dispose();
    }
  );

  test(
    'skipping the prompt is remembered per account',
    { tag: ['@api', '@games'] },
    async ({ playwright, baseURL }) => {
      const { ctx } = await playerContext(playwright, baseURL, { gamesPrompt: true });
      const showPrompt = async (c: APIRequestContext) =>
        ((await (await c.get('/api/me/games')).json()) as { showPrompt: boolean }).showPrompt;
      expect(await showPrompt(ctx)).toBe(true);
      expect((await ctx.post('/api/me/games/prompt/dismiss')).ok()).toBe(true);
      const storageState = await ctx.storageState();
      await ctx.dispose();

      // Another client for the same account (same signed cookie, no local
      // state): the skip is stored server-side.
      const again = await playwright.request.newContext({ baseURL, storageState });
      const body = { showPrompt: await showPrompt(again) };
      expect(body.showPrompt).toBe(false);
      await again.dispose();
    }
  );

  test(
    'IGDB settings: admin only, and the secret is never returned',
    { tag: ['@api', '@games', '@security'] },
    async ({ request, playwright, baseURL }) => {
      const put = await setCredentials(request, {
        clientId: 'fake-client',
        clientSecret: FAKE_SECRET,
      });
      expect(await put.text()).not.toContain(FAKE_SECRET);

      const status = await request.get('/api/settings/igdb');
      const statusText = await status.text();
      expect(statusText).not.toContain(FAKE_SECRET);
      expect(JSON.parse(statusText).igdb).toMatchObject({
        configured: true,
        source: 'settings',
        clientId: 'fake-client',
        clientSecretSet: true,
      });

      const all = await request.get('/api/settings');
      expect(all.ok()).toBe(true);
      expect(await all.text()).not.toContain(FAKE_SECRET);

      // Saving only the id keeps the stored secret.
      await setCredentials(request, { clientId: 'fake-client', clientSecret: '' });
      expect(
        ((await (await request.get('/api/settings/igdb')).json()) as { igdb: { clientSecretSet: boolean } })
          .igdb.clientSecretSet
      ).toBe(true);

      await useFakeIgdb(request);
      const ok = await request.post('/api/settings/igdb/test');
      expect(await ok.json()).toMatchObject({ ok: true, source: 'settings' });

      await setCredentials(request, { clientId: 'bad-client' });
      const bad = (await (await request.post('/api/settings/igdb/test')).json()) as {
        ok: boolean;
        error: string;
      };
      expect(bad.ok).toBe(false);
      expect(bad.error).not.toContain(FAKE_SECRET);

      const { ctx } = await playerContext(playwright, baseURL);
      expect([401, 403]).toContain((await ctx.get('/api/settings/igdb')).status());
      expect([401, 403]).toContain(
        (await ctx.put('/api/settings/igdb', { data: { clientId: 'x' } })).status()
      );
      await ctx.dispose();

      await setCredentials(request, { clientId: null });
      expect(
        ((await (await request.get('/api/settings/igdb')).json()) as { igdb: { configured: boolean } })
          .igdb.configured
      ).toBe(false);
    }
  );
});
