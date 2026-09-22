import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { createTournament } from '../helpers/tournaments';

/**
 * Tournament and match responses carry `game` (3.0 phase C, PR 12).
 *
 * The client picks a game integration's slots (veto, server panel, map pool,
 * ...) from this field. It is additive and always 'cs2' today.
 *
 * @tag api
 */
test.describe.serial('game field on responses', () => {
  test('tournament, match list, match detail and team match say cs2', async ({ request }) => {
    await signInViaRequest(request);
    const teams = await createTestTeams(request, 'game-field');
    expect(teams).not.toBeNull();
    const [team1, team2] = teams!;

    const created = await createTournament(request, {
      name: 'Game field cup',
      type: 'single_elimination',
      format: 'bo1',
      maps: ['de_mirage', 'de_inferno', 'de_nuke'],
      teamIds: [team1.id, team2.id],
    });
    expect(created).not.toBeNull();
    expect((created as unknown as { game?: string }).game).toBe('cs2');

    const tournament = await request.get('/api/tournament', { headers: getAuthHeader() });
    expect(tournament.ok()).toBe(true);
    expect((await tournament.json()).tournament.game).toBe('cs2');

    const list = await request.get('/api/matches', { headers: getAuthHeader() });
    expect(list.ok()).toBe(true);
    const { matches } = (await list.json()) as { matches: Array<{ slug: string; game?: string }> };
    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) expect(match.game).toBe('cs2');

    const detail = await request.get(`/api/matches/${matches[0].slug}`, { headers: getAuthHeader() });
    expect(detail.ok()).toBe(true);
    expect((await detail.json()).match.game).toBe('cs2');

    const teamMatch = await request.get(`/api/team/${team1.id}/match`, { headers: getAuthHeader() });
    expect(teamMatch.ok()).toBe(true);
    const body = await teamMatch.json();
    if (body.hasMatch) expect(body.match.game).toBe('cs2');
  });
});
