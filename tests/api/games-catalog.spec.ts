import { test, expect, type APIRequestContext, type Playwright } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { wipeDatabase } from '../helpers/database';
import { createTestTeams } from '../helpers/teams';
import { createTournament } from '../helpers/tournaments';

/**
 * "What do you play?": the game catalogue and a player's games.
 *
 * Search runs on Wikidata, which needs no API key, so it works out of the
 * box; IGDB was an earlier, credentialed source and has been removed.
 * `POST /api/test/wikidata` points the Wikidata client at the fake in
 * routes/test.ts, so no test accidentally reaches the real Wikidata.
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
  genres: string[];
  imageUrl: string | null;
}

let counter = 0;
function uniqueSteamId(): string {
  counter += 1;
  return `7656119${String((Date.now() + counter * 7919) % 1e10).padStart(10, '0')}`;
}

async function useFakeWikidata(request: APIRequestContext) {
  const res = await request.post('/api/test/wikidata', { data: { fake: true } });
  expect(res.ok(), `POST /api/test/wikidata: ${await res.text()}`).toBe(true);
}

async function wikidataCounters(request: APIRequestContext) {
  const res = await request.get('/api/test/wikidata');
  expect(res.ok()).toBe(true);
  return (await res.json()) as { searchRequests: number; getEntitiesRequests: number };
}

async function search(request: APIRequestContext, q: string) {
  const res = await request.get(`/api/games/search?q=${encodeURIComponent(q)}`);
  expect(res.ok(), `search ${q}: ${await res.text()}`).toBe(true);
  return (await res.json()) as { games: GameSummary[]; fromWikidata: boolean };
}

async function popularGames(request: APIRequestContext) {
  const res = await request.get('/api/games/popular');
  expect(res.ok(), `popular: ${await res.text()}`).toBe(true);
  return ((await res.json()) as { games: GameSummary[] }).games;
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
    await useFakeWikidata(request);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.post('/api/test/wikidata', { data: { fake: false } });
  });

  test(
    'search works with no keys at all: Wikidata, filtering non-games and mapping year/logo',
    { tag: ['@api', '@games'] },
    async ({ request }) => {
      // The video game enriches the existing built-in row rather than adding
      // a second one.
      const rocket = await search(request, 'rocket league');
      expect(rocket.fromWikidata).toBe(true);
      const rl = rocket.games.find((g) => g.slug === 'rocket-league')!;
      expect(rl).toBeTruthy();
      expect(rl.source).toBe('wikidata');
      expect(rl.releaseYear).toBe(2015);
      expect(rl.coverUrl).toBe(
        'https://commons.wikimedia.org/wiki/Special:FilePath/Rocket%20League%20logo.png?width=128'
      );
      expect(rl.imageUrl).toBe(rl.coverUrl);
      // P136 genre ids, resolved to labels in one extra batched wbgetentities call.
      expect(rl.genres).toEqual(['Sports']);

      // P18 ("image") is used when there is no P154 ("logo image").
      const cs = await search(request, 'counter-strike 2');
      const csGame = cs.games.find((g) => g.slug === 'counter-strike-2')!;
      expect(csGame).toMatchObject({ supported: true, source: 'wikidata' });
      expect(csGame.coverUrl).toBe(
        'https://commons.wikimedia.org/wiki/Special:FilePath/Counter-Strike%202%20key%20art.jpg?width=128'
      );
      expect(csGame.imageUrl).toBe(csGame.coverUrl);
      // Up to 3 genres, in claim order.
      expect(csGame.genres).toEqual(['Shooter', 'Tactical shooter']);

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
    }
  );

  test(
    "a same-named game never takes a built-in's row: Deadlock is Valve's",
    { tag: ['@api', '@games'] },
    async ({ request }) => {
      // The fake answers with a 2016 "Deadlock" first, then Valve's (the
      // built-in's pinned item, Q126042383). Whichever comes first, the
      // `deadlock` row is Valve's game and the other gets a slug of its own.
      for (const q of ['deadlock', 'deadloc']) {
        const { games } = await search(request, q);
        const valve = games.find((g) => g.slug === 'deadlock');
        expect(valve, `${q}: ${JSON.stringify(games)}`).toBeTruthy();
        expect(valve).toMatchObject({ name: 'Deadlock', releaseYear: 2024 });
        expect(valve!.coverUrl).toContain('Deadlock%20Valve%20key%20art.jpg');
        const other = games.find((g) => g.slug === 'deadlock-2016');
        expect(other).toMatchObject({ name: 'Deadlock', releaseYear: 2016 });
        expect(games.filter((g) => g.name === 'Deadlock')).toHaveLength(2);
      }
    }
  );

  test(
    'search caches the query and reuses it, from our own rows',
    { tag: ['@api', '@games'] },
    async ({ request }) => {
      const first = await search(request, 'celeste');
      expect(first.fromWikidata).toBe(false); // no fake item named Celeste
      let counters = await wikidataCounters(request);
      const searchesAfterFirst = counters.searchRequests;
      expect(searchesAfterFirst).toBeGreaterThan(0);

      // Same query again: served from the cache, no new request to Wikidata.
      await search(request, 'CELESTE ');
      counters = await wikidataCounters(request);
      expect(counters.searchRequests).toBe(searchesAfterFirst);

      // A new query reaches Wikidata again.
      await search(request, 'chess');
      counters = await wikidataCounters(request);
      expect(counters.searchRequests).toBe(searchesAfterFirst + 1);
    }
  );

  test(
    'a Wikidata failure falls back to the built-ins',
    { tag: ['@api', '@games'] },
    async ({ request }) => {
      const result = await search(request, 'wderror');
      expect(result.fromWikidata).toBe(false);
      expect(result.games).toEqual([]);
    }
  );

  test(
    'search needs two characters and is rate limited per IP',
    { tag: ['@api', '@games'] },
    async ({ request }) => {
      expect((await request.get('/api/games/search?q=r')).status()).toBe(400);
      expect((await request.get('/api/games/search')).status()).toBe(400);
      expect((await request.get('/api/games/search?q=%20r%20')).status()).toBe(400);

      await useFakeWikidata(request); // resets the limiter
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
      await useFakeWikidata(request);
    }
  );

  test(
    'popular: every built-in, an open tournament\'s game first, never filtered by picks',
    { tag: ['@api', '@games'] },
    async ({ request, playwright, baseURL }) => {
      await request.delete('/api/tournament');

      // `/api/games/popular` (the onboarding grid) never drops a supported
      // game just because no tournament is active for it right now.
      const popular = await popularGames(request);
      expect(popular.map((g) => g.slug)).toContain('counter-strike-2');
      expect(popular.find((g) => g.slug === 'counter-strike-2')).toMatchObject({ supported: true });
      expect(popular.map((g) => g.slug).indexOf('rocket-league')).toBeLessThan(
        popular.map((g) => g.slug).indexOf('valorant')
      );

      // "league-of-legends" is never searched anywhere in this suite, so it is
      // still exactly what `ensureBuiltinGames` seeded: proof that built-in
      // enrichment (gameEnrichmentService, which would give it a real
      // Wikidata image/genres) never ran during tests — it is disabled by
      // NODE_ENV=test (and, belt-and-suspenders, GAMES_ENRICH=off in CI).
      const lol = popular.find((g) => g.slug === 'league-of-legends')!;
      expect(lol).toMatchObject({ source: 'builtin', coverUrl: null, imageUrl: null, genres: [] });

      const teams = await createTestTeams(request, 'games-popular');
      expect(teams).toBeTruthy();
      const tournament = await createTournament(request, {
        name: 'Games popular',
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_dust2'],
        teamIds: teams!.map((t) => t.id),
      });
      expect(tournament).toBeTruthy();

      try {
        const withTournament = await popularGames(request);
        expect(withTournament[0].slug).toBe('counter-strike-2');

        // A game a player already picked still shows (selected, in the UI).
        const { ctx } = await playerContext(playwright, baseURL);
        expect((await ctx.put('/api/me/games', { data: [withTournament[0].id] })).ok()).toBe(true);
        const forPlayer = (await (await ctx.get('/api/games/popular')).json()) as { games: GameSummary[] };
        expect(forPlayer.games.map((g) => g.slug)).toEqual(withTournament.map((g) => g.slug));
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
});
