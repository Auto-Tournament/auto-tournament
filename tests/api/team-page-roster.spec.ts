import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { updateTeam } from '../helpers/teams';
import { impersonatePlayer, stopImpersonating } from '../helpers/auth';
import type { Team } from '../helpers/teams';

/**
 * The team page follows the team's roster, not the match config snapshot.
 *
 * `config` is written when the match is created and goes stale the moment an
 * admin edits the team. Deciding "is this viewer on this team?" from it was
 * wrong in both directions:
 *
 *  - a player removed from the roster kept seeing the match server, because
 *    the snapshot still listed them;
 *  - a player added after the snapshot could not see their own server, which
 *    is the reported "it shows on my player page but not the team page".
 *
 * `veto.ts` already resolves membership from the roster for the same reason.
 *
 * @tag api
 * @tag teams
 * @tag regression
 */

async function serverVisibleTo(
  request: APIRequestContext,
  teamId: string,
  steamId: string
): Promise<boolean> {
  expect(await impersonatePlayer(request, steamId)).toBe(true);
  try {
    const res = await request.get(`/api/team/${teamId}/match`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { match?: { server?: unknown } };
    return Boolean(body.match?.server);
  } finally {
    await stopImpersonating(request);
  }
}

test.describe.serial('Team page membership follows the roster', () => {
  let team1: Team;
  let team2: Team;

  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
      teamCount: 2,
      serverCount: 1,
      prefix: 'roster',
    });
    expect(setup).toBeTruthy();
    [team1, team2] = [setup!.teams[0], setup!.teams[1]];

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();

    const state = await request.post('/api/test/match-state', {
      data: { slug: match!.slug, serverId: setup!.servers[0].id, status: 'loaded' },
    });
    expect(state.ok()).toBe(true);
  });

  test(
    'a removed player stops seeing the match server',
    { tag: ['@api', '@teams', '@regression'] },
    async ({ request }) => {
      const removed = team1.players[0];

      expect(
        await serverVisibleTo(request, team1.id, removed.steamId),
        'a roster member should see it to begin with'
      ).toBe(true);

      await updateTeam(request, team1.id, {
        players: team1.players.slice(1).map((p) => ({ steamId: p.steamId, name: p.name })),
      });

      expect(
        await serverVisibleTo(request, team1.id, removed.steamId),
        'removing someone from the roster should take effect immediately'
      ).toBe(false);
    }
  );

  test(
    'a player added after the match was created sees the server',
    { tag: ['@api', '@teams', '@regression'] },
    async ({ request }) => {
      const newcomer = { steamId: '76561198000000555', name: 'Newcomer' };

      await updateTeam(request, team1.id, {
        players: [
          ...team1.players.map((p) => ({ steamId: p.steamId, name: p.name })),
          newcomer,
        ],
      });

      expect(
        await serverVisibleTo(request, team1.id, newcomer.steamId),
        'a current roster member should see their own match server'
      ).toBe(true);
    }
  );

  test(
    'an opponent still cannot see this team\u2019s server',
    { tag: ['@api', '@teams', '@security'] },
    async ({ request }) => {
      // The whole point of the check; following the roster must not widen it.
      expect(await serverVisibleTo(request, team1.id, team2.players[0].steamId)).toBe(false);
    }
  );
});
