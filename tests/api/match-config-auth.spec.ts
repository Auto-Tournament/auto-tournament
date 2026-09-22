import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest, getAuthHeader, DEFAULT_PLAYER_STEAM_ID } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';

/**
 * The match config MatchZy downloads is not public.
 *
 * GET /api/matches/:slug.json carries both rosters with their Steam IDs and the
 * match setup, and slugs are guessable (r1m1). It used to answer anyone. Now a
 * game server presents `X-MatchZy-Token: <SERVER_TOKEN>` — MAT passes the
 * header on the `matchzy_loadmatch_url` line — and admins get in by session or
 * service token.
 *
 * @tag api
 * @tag auth
 * @tag regression
 */

const SERVER_TOKEN = process.env.SERVER_TOKEN ?? 'server123';
const READONLY_TOKEN = (
  process.env.API_TOKENS_READONLY || 'ci-readonly:ci-readonly-token-0123456789abcdef'
)
  .split(/[\s,;]+/)[0]
  .split(':')
  .slice(1)
  .join(':');

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

type ListedMatch = { id: number; slug: string; round?: number };

async function firstRoundMatch(request: APIRequestContext): Promise<ListedMatch> {
  const res = await request.get('/api/matches', { headers: getAuthHeader() });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { matches: ListedMatch[] };
  const match = body.matches.filter((m) => m.round === 1).sort((a, b) => a.id - b.id)[0];
  expect(match, 'the bracket has a first-round match').toBeTruthy();
  return match;
}

test.describe.serial('Match config download auth', () => {
  let match: ListedMatch;
  let serverId: string;
  /** A context with no cookies, as a game server or a stranger would be. */
  let anonymous: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    anonymous = await playwright.request.newContext({ baseURL: BASE_URL });
  });

  test.afterAll(async () => {
    await anonymous.dispose();
  });

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const setup = await setupTournament(request, {
      format: 'bo1',
      teamCount: 2,
      serverCount: 1,
      prefix: 'cfgauth',
    });
    expect(setup, 'tournament setup should succeed').toBeTruthy();
    serverId = setup!.servers[0].id;
    match = await firstRoundMatch(request);
  });

  test('no header is refused without leaking the config', {
    tag: ['@api', '@auth', '@regression'],
  }, async () => {
    const res = await anonymous.get(`/api/matches/${match.slug}.json`);
    expect(res.status()).toBe(401);
    const body = await res.text();
    expect(body).not.toContain('team1');
    expect(body).not.toContain('maplist');
  });

  test('a wrong header is refused', { tag: ['@api', '@auth', '@regression'] }, async () => {
    const res = await anonymous.get(`/api/matches/${match.slug}.json`, {
      headers: { 'X-MatchZy-Token': `${SERVER_TOKEN}-wrong` },
    });
    expect(res.status()).toBe(401);
    expect(await res.text()).not.toContain('team1');
  });

  test('an unknown slug gets the same 401, not a 404', {
    tag: ['@api', '@auth'],
  }, async () => {
    const res = await anonymous.get('/api/matches/no-such-match-slug.json');
    expect(res.status()).toBe(401);
  });

  test('the server token gets the same config an admin sees', {
    tag: ['@api', '@auth', '@regression'],
  }, async ({ request }) => {
    const asServer = await anonymous.get(`/api/matches/${match.slug}.json`, {
      headers: { 'X-MatchZy-Token': SERVER_TOKEN },
    });
    expect(asServer.status()).toBe(200);

    const asAdmin = await request.get(`/api/matches/${match.slug}.json`);
    expect(asAdmin.status(), 'admin session').toBe(200);

    const served = (await asServer.json()) as { matchid?: number };
    expect(served.matchid).toBe(match.id);
    expect(served).toEqual(await asAdmin.json());
  });

  test('a read-only service token is enough', { tag: ['@api', '@auth'] }, async () => {
    const res = await anonymous.get(`/api/matches/${match.slug}.json`, {
      headers: { Authorization: `Bearer ${READONLY_TOKEN}` },
    });
    expect(res.status()).toBe(200);
  });

  test('a signed-in player who is not an admin is refused', {
    tag: ['@api', '@auth'],
  }, async ({ playwright }) => {
    const player = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      const login = await player.post('/api/test/login-player', {
        data: { steamId: DEFAULT_PLAYER_STEAM_ID },
      });
      expect(login.ok()).toBe(true);
      const res = await player.get(`/api/matches/${match.slug}.json`);
      expect(res.status()).toBe(401);
    } finally {
      await player.dispose();
    }
  });

  test('the load command carries the header, with the token kept out of the response', {
    tag: ['@api', '@auth', '@regression'],
  }, async ({ request }) => {
    const set = await request.post('/api/test/match-state', {
      headers: getAuthHeader(),
      data: { slug: match.slug, status: 'ready', serverId },
    });
    expect(set.ok()).toBe(true);

    const res = await request.post(`/api/matches/${match.slug}/load`, { data: {} });
    const body = (await res.json()) as {
      rconResponses?: Array<{ command: string }>;
      error?: string;
    };
    expect(res.status(), JSON.stringify(body)).toBe(200);

    const load = (body.rconResponses ?? []).find((r) =>
      r.command.startsWith('matchzy_loadmatch_url ')
    );
    expect(load, 'the load command is reported').toBeTruthy();
    expect(load!.command).toMatch(
      new RegExp(`^matchzy_loadmatch_url "[^"]*/api/matches/${match.slug}\\.json[^"]*" "X-MatchZy-Token" "REDACTED"$`)
    );
    expect(JSON.stringify(body)).not.toContain(SERVER_TOKEN);
  });
});
