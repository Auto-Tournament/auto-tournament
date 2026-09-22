import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  getIntegration,
  hasIntegration,
  integrationForGameRef,
  integrationForMatch,
} from '../../api/src/integrations/registry';
import {
  MANUAL_REPORT_CATALOG,
  MANUAL_REPORT_GAME_ID,
  catalogNameFor,
} from '../../api/src/integrations/manual-report/catalog';
import {
  DEFAULT_CONFIRM_TIMEOUT_MIN,
  readSetup,
  validateSetup,
} from '../../api/src/integrations/manual-report/setup';

/**
 * The manual-report game module (3.0 phase D, PR D2).
 *
 * A game module for games MAT cannot watch: no servers, no veto, no live
 * events. The match goes live the moment it is allocated, and the result is
 * typed in later (the state machine is PR D3, `manual-report-reports.spec.ts`).
 *
 * This spec covers the module itself — what it declares, how the registry and
 * the game catalogue see it, and one tournament run through to a live match
 * against a live API. The shared contract every module must honour is
 * `integration-contract.spec.ts`, which picks this one up from the registry.
 *
 * @tag api
 */

const TEST = '/api/test/integration/manual-report';

type ListedMatch = {
  slug: string;
  game: string;
  round: number;
  status: string;
  serverId?: string | null;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

async function createTeams(request: APIRequestContext, prefix: string, count: number) {
  const stamp = `${Date.now()}`.slice(-7);
  const ids: string[] = [];
  for (let t = 0; t < count; t++) {
    const id = `${prefix}-${stamp}-${t}`;
    const players = Array.from({ length: 2 }, (_, p) => ({
      steamId: `76561199${stamp}${t}${p}`,
      name: `${prefix} ${t}.${p}`,
    }));
    const res = await request.post('/api/teams', {
      data: { id, name: `${prefix} ${stamp} ${t}`, players },
    });
    expect(res.ok(), `creating team ${id}: ${await res.text()}`).toBe(true);
    ids.push(id);
  }
  return ids;
}

async function listMatches(request: APIRequestContext): Promise<ListedMatch[]> {
  const res = await request.get('/api/matches');
  expect(res.ok(), `listing matches: ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { matches?: ListedMatch[] };
  return (body.matches ?? []).filter((m) => m.round >= 1);
}

// ---------------------------------------------------------------------------
// What the module declares (no database, no API)
// ---------------------------------------------------------------------------

test.describe('Manual-report module: what it declares', () => {
  test('is registered, with no servers and no veto', () => {
    expect(hasIntegration(MANUAL_REPORT_GAME_ID)).toBe(true);
    const module = getIntegration(MANUAL_REPORT_GAME_ID);
    expect(module.displayName).toBe('Manual reporting');
    expect(module.capabilities).toEqual({
      servers: false,
      veto: false,
      liveEvents: false,
      demos: false,
      playerStats: false,
    });
    // No servers means no resource to wait for: the scheduler reads null as
    // "never runs out" and allocates straight away.
    expect(module.accountProvider).toBeUndefined();
  });

  test('is not itself a game: no catalogue row of its own, but it ships titles', () => {
    const module = getIntegration(MANUAL_REPORT_GAME_ID);
    expect(module.catalog).toBeNull();
    expect(module.catalogEntries?.length).toBeGreaterThan(0);
    expect(module.runsAnyCatalogGame).toBe(true);

    // Slugs are unique and IGDB-shaped, so an IGDB result enriches the row
    // rather than adding a second one.
    const slugs = MANUAL_REPORT_CATALOG.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const entry of MANUAL_REPORT_CATALOG) {
      expect(entry.slug, entry.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(entry.name?.trim(), entry.slug).toBeTruthy();
    }
    // Never another module's game.
    expect(slugs).not.toContain('counter-strike-2');
  });

  test('exactly one module may claim every catalogue game', () => {
    const catchAll = [getIntegration('cs2'), getIntegration(MANUAL_REPORT_GAME_ID)].filter(
      (i) => i.runsAnyCatalogGame
    );
    expect(catchAll.map((i) => i.id)).toEqual([MANUAL_REPORT_GAME_ID]);
  });

  test('the registry resolves its games, and leaves CS2 alone', () => {
    // A title it ships.
    expect(integrationForGameRef('rocket-league')?.id).toBe(MANUAL_REPORT_GAME_ID);
    expect(integrationForGameRef('chess')?.id).toBe(MANUAL_REPORT_GAME_ID);
    // An alias of one.
    expect(integrationForGameRef('rl')?.id).toBe(MANUAL_REPORT_GAME_ID);
    // Its own id, which means "a game with no catalogue row here".
    expect(integrationForGameRef(MANUAL_REPORT_GAME_ID)?.id).toBe(MANUAL_REPORT_GAME_ID);
    // Anything else, through runsAnyCatalogGame.
    expect(integrationForGameRef('some-indie-fighter')?.id).toBe(MANUAL_REPORT_GAME_ID);

    // CS2 rows are untouched: its id, its slug and its aliases still answer cs2.
    for (const ref of ['cs2', 'counter-strike-2', 'csgo', 'CS2']) {
      expect(integrationForGameRef(ref)?.id, ref).toBe('cs2');
    }
    expect(integrationForMatch({}).id).toBe('cs2');
    expect(integrationForMatch({ game: null }).id).toBe('cs2');
  });

  test('catalogNameFor labels a game it ships, and nothing else', () => {
    expect(catalogNameFor('rocket-league')).toBe('Rocket League');
    expect(catalogNameFor('ROCKET-LEAGUE')).toBe('Rocket League');
    expect(catalogNameFor('counter-strike-2')).toBeNull();
    expect(catalogNameFor('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.describe('Manual-report module: tournament setup', () => {
  const tournamentWith = (manualReport: unknown, format = 'bo3') => ({
    id: 1,
    type: 'single_elimination',
    format,
    settings: { settings: { manualReport } },
  });

  test('a tournament with no manualReport object is still a valid one', () => {
    const setup = readSetup(tournamentWith(undefined), 'rocket-league');
    expect(setup).toEqual({
      gameLabel: 'Rocket League',
      bestOf: 3, // from the tournament format
      allowDraw: false,
      confirmation: 'opponent',
      confirmTimeoutMin: DEFAULT_CONFIRM_TIMEOUT_MIN,
      timeoutAction: 'auto_confirm',
    });
  });

  test('a game with no catalogue row of ours gets a neutral label', () => {
    expect(readSetup(tournamentWith({}), 'some-indie-fighter').gameLabel).toBe('the game');
    expect(readSetup(null, null).gameLabel).toBe('the game');
    expect(readSetup(tournamentWith({ gameLabel: '  Darts  ' }), 'chess').gameLabel).toBe('Darts');
  });

  test('every field is read back, and bestOf wins over the format', () => {
    const setup = readSetup(
      tournamentWith(
        {
          gameLabel: 'Chess',
          bestOf: 5,
          allowDraw: true,
          confirmation: 'none',
          confirmTimeoutMin: 0,
          timeoutAction: 'escalate',
        },
        'bo1'
      ),
      'chess'
    );
    expect(setup).toEqual({
      gameLabel: 'Chess',
      bestOf: 5,
      allowDraw: true,
      confirmation: 'none',
      confirmTimeoutMin: 0,
      timeoutAction: 'escalate',
    });
  });

  test('junk in a stored setting falls back to the default, never throws', () => {
    const setup = readSetup(
      tournamentWith({
        gameLabel: 42,
        bestOf: 'lots',
        allowDraw: 'yes',
        confirmation: 'whoever',
        confirmTimeoutMin: -5,
        timeoutAction: 'explode',
      }),
      'chess'
    );
    expect(setup).toMatchObject({
      gameLabel: 'Chess',
      bestOf: 3,
      allowDraw: false,
      confirmation: 'opponent',
      confirmTimeoutMin: DEFAULT_CONFIRM_TIMEOUT_MIN,
      timeoutAction: 'auto_confirm',
    });
  });

  test('validation: absent is valid, present is checked', () => {
    expect(validateSetup({ settings: {} })).toEqual({ valid: true, errors: [] });
    expect(
      validateSetup({
        settings: {
          manualReport: {
            gameLabel: 'Chess',
            bestOf: 3,
            allowDraw: true,
            confirmation: 'none',
            confirmTimeoutMin: 30,
            timeoutAction: 'escalate',
          },
        },
      })
    ).toEqual({ valid: true, errors: [] });

    const bad = validateSetup({
      settings: {
        manualReport: {
          bestOf: 2,
          allowDraw: 'yes',
          confirmation: 'maybe',
          confirmTimeoutMin: -1,
          timeoutAction: 'explode',
        },
      },
    });
    expect(bad.valid).toBe(false);
    expect(bad.errors).toHaveLength(5);
  });

  test('the setup schema declares exactly the fields the setup has', () => {
    const schema = getIntegration(MANUAL_REPORT_GAME_ID).setupSchema!;
    const own = (schema.tournament?.properties as Record<string, { properties: object }>)
      .manualReport.properties;
    expect(Object.keys(own).sort()).toEqual(
      [
        'allowDraw',
        'bestOf',
        'confirmTimeoutMin',
        'confirmation',
        'gameLabel',
        'timeoutAction',
      ].sort()
    );
    // It owns no app_settings keys: every decision belongs to a tournament.
    expect(getIntegration(MANUAL_REPORT_GAME_ID).instanceSettings).toEqual([]);
    expect(schema.instance).toEqual({ type: 'object', properties: {} });
  });
});

// ---------------------------------------------------------------------------
// Match configs
// ---------------------------------------------------------------------------

test.describe('Manual-report module: match configs', () => {
  test('describeMatch reads back what buildMatchConfig wrote', async () => {
    const module = getIntegration(MANUAL_REPORT_GAME_ID);
    const config = await module.buildMatchConfig({
      slug: 'r1m1',
      matchId: 0,
      game: 'chess',
      tournament: {
        id: 1,
        type: 'single_elimination',
        format: 'bo1',
        settings: { settings: { manualReport: { bestOf: 5, allowDraw: true } } },
      },
      team1: null,
      team2: null,
      round: 1,
    });
    expect(config).toMatchObject({
      game: MANUAL_REPORT_GAME_ID,
      catalogGame: 'chess',
      gameLabel: 'Chess',
      seriesLength: 5,
      allowDraw: true,
    });

    const described = module.describeMatch(JSON.stringify(config));
    expect(described.seriesLength).toBe(5);
    expect(described.maps).toEqual([]);
    expect(described.gamesCanDraw).toBe(true);
    // There is no pre-match phase, so a match must never wait for one.
    expect(described.skipPreMatchPhase).toBe(true);
    expect(module.describeMatch(config)).toEqual(described);
  });

  test('a series of one, and a game with no catalogue row, still describe', async () => {
    const module = getIntegration(MANUAL_REPORT_GAME_ID);
    const config = await module.buildMatchConfig({
      slug: 'r1m1',
      matchId: 0,
      game: MANUAL_REPORT_GAME_ID,
      tournament: { id: 1, type: 'swiss', format: 'bo1', settings: {} },
      team1: null,
      team2: null,
      round: 1,
    });
    expect(config).toMatchObject({ catalogGame: null, gameLabel: 'the game', seriesLength: 1 });
    expect(module.describeMatch(config).seriesLength).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Against a live API
// ---------------------------------------------------------------------------

test.describe.serial('Manual-report module: a tournament with no servers', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    // The core still requires a webhook URL to start. Nothing is ever called
    // on it: this game has no servers.
    await request.put('/api/settings', {
      data: { webhookUrl: 'http://localhost:3069', simulateMatches: false },
    });
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete('/api/tournament');
  });

  test('its games are supported in the catalogue; CS2 stays CS2', { tag: ['@api'] }, async ({ request }) => {
    const res = await request.get('/api/games/popular');
    expect(res.ok(), await res.text()).toBe(true);
    const games = ((await res.json()) as { games: Array<{ slug: string; name: string; supported: boolean }> }).games;
    const bySlug = new Map(games.map((g) => [g.slug, g]));

    for (const entry of MANUAL_REPORT_CATALOG) {
      expect(bySlug.get(entry.slug), entry.slug).toMatchObject({
        name: entry.name,
        supported: true,
      });
    }
    // The module is not offered as a game of its own.
    expect(bySlug.has(MANUAL_REPORT_GAME_ID)).toBe(false);
    expect(bySlug.has('manual-reporting')).toBe(false);
    // CS2's row still belongs to CS2, with its own name.
    expect(bySlug.get('counter-strike-2')).toMatchObject({
      name: 'Counter-Strike 2',
      supported: true,
    });
  });

  test('create, start, and the match is live with no server', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'mr-live', 2);
    const created = await request.post(`${TEST}/tournament`, {
      data: {
        name: 'Rocket League Cup',
        type: 'single_elimination',
        format: 'bo3',
        game: 'rocket-league',
        teamIds,
        settings: { manualReport: { gameLabel: 'Rocket League', confirmTimeoutMin: 60 } },
      },
    });
    expect(created.status(), `creating: ${await created.text()}`).toBe(200);
    const tournament = ((await created.json()) as {
      tournament: { game: string; status: string; settings: Record<string, unknown> };
    }).tournament;

    // The row carries the *catalogue* id, not the module id: a module that
    // runs many games cannot be identified by the module alone.
    expect(tournament.game).toBe('rocket-league');
    expect(tournament.status).toBe('setup');
    // The module's settings survive the create untouched, next to the core's.
    expect(tournament.settings.manualReport).toEqual({
      gameLabel: 'Rocket League',
      confirmTimeoutMin: 60,
    });

    // With no veto, round 1 is ready straight away (a CS2 BO3 would wait).
    const matches = await listMatches(request);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ game: 'rocket-league', status: 'ready' });

    const started = await request.post('/api/tournament/start', { data: {} });
    expect(started.ok(), `starting: ${await started.text()}`).toBe(true);

    // Allocation puts it straight to live: there is nothing to load it onto,
    // so the match going live *is* loading it.
    let live: ListedMatch[] = [];
    await expect
      .poll(
        async () => {
          live = (await listMatches(request)).filter((m) => m.status === 'live');
          return live.length;
        },
        { message: 'the match should go live with no server', timeout: 20_000 }
      )
      .toBe(1);
    expect(live[0].serverId ?? null).toBeNull();

    // The stored config is the module's, with the reporting rules as they
    // stood when the match was built.
    const detail = await request.get(`/api/matches/${live[0].slug}`);
    expect(detail.ok()).toBe(true);
    const config = ((await detail.json()) as { match: { config: Record<string, unknown> } }).match.config;
    expect(config).toMatchObject({
      game: MANUAL_REPORT_GAME_ID,
      catalogGame: 'rocket-league',
      gameLabel: 'Rocket League',
      seriesLength: 3,
      confirmation: 'opponent',
      confirmTimeoutMin: 60,
      timeoutAction: 'auto_confirm',
    });

    // Loading it again is a no-op, not a second life: only a `ready` match moves.
    const reload = await request.post(`/api/matches/${live[0].slug}/load`, { data: {} });
    expect([200, 400, 409]).toContain(reload.status());
    expect((await listMatches(request)).find((m) => m.slug === live[0].slug)?.status).toBe('live');
  });

  test('the test route only makes tournaments for games this module ships', { tag: ['@api'] }, async ({ request }) => {
    const teamIds = await createTeams(request, 'mr-guard', 2);
    const base = {
      name: 'Guarded',
      type: 'single_elimination',
      format: 'bo1',
      teamIds,
    };
    // CS2 has a module of its own; this one must not take its tournaments.
    expect((await request.post(`${TEST}/tournament`, { data: { ...base, game: 'counter-strike-2' } })).status()).toBe(409);
    expect((await request.post(`${TEST}/tournament`, { data: { ...base, game: 'cs2' } })).status()).toBe(409);
    // Input checks.
    expect((await request.post(`${TEST}/tournament`, { data: { ...base, format: 'bo2' } })).status()).toBe(400);
    expect((await request.post(`${TEST}/tournament`, { data: { ...base, teamIds: [] } })).status()).toBe(400);
    expect(
      (
        await request.post(`${TEST}/tournament`, {
          data: { ...base, game: 'chess', settings: { manualReport: { bestOf: 2 } } },
        })
      ).status()
    ).toBe(400);
  });
});
