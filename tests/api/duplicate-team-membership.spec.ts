import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import type { Team } from '../helpers/teams';

/**
 * A player on two teams of one tournament dead-ends the veto.
 *
 * `resolveViewerTeamForMatch` returns `'both'`, the player cannot act for
 * either side, and the only way out is an admin removing them from a team.
 * Nothing surfaced that until the veto refused to move.
 *
 * Team rosters are admin-only — there is no player-facing way to join a team —
 * so this warns rather than blocks. An admin may mean it; they just should not
 * find out during a match.
 *
 * @tag api
 * @tag teams
 */

async function updateRoster(
  request: APIRequestContext,
  teamId: string,
  players: Array<{ steamId: string; name: string }>
) {
  const res = await request.put(`/api/teams/${teamId}`, { data: { players } });
  expect(res.ok(), `team update failed: ${await res.text()}`).toBe(true);
  return (await res.json()) as { success: boolean; warnings?: string[] };
}

test.describe.serial('Player on two teams of one tournament', () => {
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
      prefix: 'dupe',
    });
    expect(setup).toBeTruthy();
    [team1, team2] = [setup!.teams[0], setup!.teams[1]];
  });

  test(
    'warns when a player is added to a second team, without blocking it',
    { tag: ['@api', '@teams'] },
    async ({ request }) => {
      const shared = team1.players[0];

      const body = await updateRoster(request, team2.id, [
        ...team2.players.map((p) => ({ steamId: p.steamId, name: p.name })),
        { steamId: shared.steamId, name: shared.name },
      ]);

      // Allowed — the admin keeps the decision.
      expect(body.success).toBe(true);

      expect(body.warnings ?? [], 'the admin should be told at the moment they do it').not.toEqual(
        []
      );
      expect(body.warnings!.join(' ')).toContain(team1.name);
      expect(body.warnings!.join(' ')).toContain('veto');
    }
  );

  test(
    'stays quiet for a roster with no overlap',
    { tag: ['@api', '@teams'] },
    async ({ request }) => {
      // Guards the fix from the lazy version of itself: warning on every save
      // would pass the test above and mean nothing.
      const body = await updateRoster(
        request,
        team2.id,
        team2.players.map((p) => ({ steamId: p.steamId, name: p.name }))
      );

      expect(body.success).toBe(true);
      expect(body.warnings ?? []).toEqual([]);
    }
  );
});
