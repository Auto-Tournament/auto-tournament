import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { configureWebhook } from '../helpers/setup';
import { createTeam, type Team } from '../helpers/teams';
import { createTestServer } from '../helpers/servers';
import { getOk, postOk, resetDatabaseForGolden } from '../helpers/golden';

/**
 * A deleted player stays as a tombstone ("Deleted player") for the match rows
 * (services/playerModeration.ts). GET /api/leaderboard leaves them out.
 *
 * @tag api
 * @tag regression
 */

const TEAMS: Team[] = ['alpha', 'bravo'].map((name, t) => ({
  id: `lbdeleted-${name}`,
  name: `Board ${name}`,
  players: [0].map((p) => ({
    steamId: `7656119900002${t}${p}`.padEnd(17, '0'),
    name: `${name}-${p}`,
  })),
}));

type Board = { players: Array<{ id: string; name: string }> };

test(
  'the leaderboard leaves deleted players out',
  { tag: ['@api', '@regression'] },
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetDatabaseForGolden(request);
    expect(await configureWebhook(request, 'http://localhost:3069')).toBe(true);
    for (const team of TEAMS) expect(await createTeam(request, team)).toBeTruthy();
    expect(await createTestServer(request, 'lbdeleted')).toBeTruthy();

    await postOk(request, '/api/tournament', {
      name: 'Board',
      type: 'single_elimination',
      format: 'bo1',
      maps: ['de_mirage', 'de_inferno', 'de_nuke'],
      teamIds: TEAMS.map((t) => t.id),
      settings: { seedingMethod: 'manual' },
    });
    await postOk(request, '/api/tournament/start', {});
    const slug = (await getOk<{ matches: Array<{ slug: string }> }>(request, '/api/matches'))
      .matches[0].slug;
    await postOk(request, '/api/test/match-state', { slug, status: 'live' });
    await postOk(request, '/api/test/series-result', {
      slug,
      result: { games: [], team1Score: 1, team2Score: 0, winner: 'team1' },
      meta: {},
    });

    const [kept, gone] = TEAMS.map((t) => t.players[0].steamId);
    // Both are rated once the series is in.
    await expect
      .poll(async () =>
        (await getOk<Board>(request, '/api/leaderboard?game=cs2')).players.map((p) => p.id)
      )
      .toEqual(expect.arrayContaining([kept, gone]));

    const deleted = await request.delete(`/api/players/${gone}`, { headers: getAuthHeader() });
    expect(deleted.ok(), await deleted.text()).toBe(true);

    const board = await getOk<Board>(request, '/api/leaderboard?game=cs2');
    expect(board.players.map((p) => p.id)).toContain(kept);
    expect(board.players.map((p) => p.id)).not.toContain(gone);
    expect(board.players.map((p) => p.name)).not.toContain('Deleted player');
  }
);
