import { test, expect } from '@playwright/test';
import { signInViaRequest, impersonatePlayer, stopImpersonating } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { actingSteamIdFor } from '../helpers/veto';
import { pauseView } from '../../api/src/integrations/cs2/fleet/pauseView';

/**
 * GET /api/game/cs2/matches/:slug/connect (client API 0.2.0).
 *
 * The CS2 join panel reads how to join a match by its slug instead of being
 * handed the server by the team and player pages. The address goes only to a
 * player on the match, the way the team page already decided it; anyone else
 * gets `server: null`, the same answer as a match with no server.
 *
 * @tag api
 */
test.describe.serial('CS2 match connect route', () => {
  test.setTimeout(120000);

  let slug: string;
  let team1Player: string;
  let serverHost: string;

  test.beforeAll(async ({ request }) => {
    await signInViaRequest(request);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: [
        'de_mirage',
        'de_inferno',
        'de_ancient',
        'de_anubis',
        'de_dust2',
        'de_vertigo',
        'de_nuke',
      ],
      teamCount: 2,
      serverCount: 1,
      prefix: 'connect',
    });
    expect(setup).toBeTruthy();
    const [team1, team2] = [setup!.teams[0], setup!.teams[1]];
    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();
    slug = match!.slug;
    team1Player = actingSteamIdFor(team1);
    serverHost = setup!.servers[0].host;

    const state = await request.post('/api/test/match-state', {
      data: { slug, serverId: setup!.servers[0].id, status: 'loaded' },
    });
    expect(state.ok()).toBe(true);
  });

  test.afterEach(async ({ request }) => {
    await stopImpersonating(request);
  });

  test('a viewer on neither team gets no address', { tag: ['@api'] }, async ({ request }) => {
    await signInViaRequest(request);
    const res = await request.get(`/api/game/cs2/matches/${slug}/connect`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, viewerIsTeamMember: false, server: null });
    expect(body.matchStatus).toBe('loaded');
  });

  test('a player on the match gets the server', { tag: ['@api'] }, async ({ request }) => {
    await signInViaRequest(request);
    expect(await impersonatePlayer(request, team1Player)).toBe(true);
    const res = await request.get(`/api/game/cs2/matches/${slug}/connect`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.viewerIsTeamMember).toBe(true);
    expect(body.server).toMatchObject({ host: serverHost, password: null });
    expect(typeof body.server.port).toBe('number');
  });

  test('an unknown match is a 404', { tag: ['@api'] }, async ({ request }) => {
    const res = await request.get('/api/game/cs2/matches/no-such-match/connect');
    expect(res.status()).toBe(404);
  });
});

test('a paused match names the lineup players not connected', () => {
  const team = (
    players: Record<
      string,
      { name?: string; connected: boolean; role?: 'player' | 'sub' | 'coach' }
    >
  ) => ({
    name: 'T',
    score: 0,
    players: Object.fromEntries(
      Object.entries(players).map(([id, p]) => [id, { ready: true, ...p }])
    ),
  });
  const state = {
    pause: { active: true, type: 'auto_5v5' as const },
    teams: {
      team1: team({
        '1': { name: 'alice', connected: true },
        '2': { name: 'bob', connected: false },
      }),
      team2: team({
        '3': { name: 'carol', connected: false },
        '4': { name: 'sub', connected: false, role: 'sub' },
        '5': { name: 'coach', connected: false, role: 'coach' },
      }),
    },
  };
  expect(pauseView(state)).toEqual({ type: 'auto_5v5', waitingFor: ['bob', 'carol'] });
  expect(pauseView({ ...state, pause: { active: false } })).toBeNull();
  expect(pauseView(null)).toBeNull();
});
