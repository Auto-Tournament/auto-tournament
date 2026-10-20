import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { getAuthHeader, impersonatePlayer, stopImpersonating } from '../helpers/auth';

/**
 * A later round's match waiting for its server: its config was made before
 * both teams were known (TBD, no players) and is only made again when a server
 * is assigned. The match room read players and team size from it, so a player
 * waiting saw no players and "0 of 2 in the server". It now falls back to the
 * teams' rosters and the tournament's team size (Vikunja 2136).
 *
 * @tag api
 * @tag regression
 */
test('the final waiting for a server lists both teams and the team size', async ({
  page,
  request,
}) => {
  await setupTestContext(page, request);
  const setup = await setupTournament(request, {
    type: 'single_elimination',
    format: 'bo1',
    teamCount: 4,
    serverCount: 0,
    prefix: 'later-round',
  });
  expect(setup).toBeTruthy();
  const teams = setup!.teams;

  // Round 1: each first-round match gets a winner (team1).
  const bracket = (await (
    await request.get('/api/tournament/bracket', { headers: getAuthHeader() })
  ).json()) as { matches: Array<{ slug: string; round: number; team1?: { id: string } }> };
  const first = bracket.matches.filter((m) => m.round === 1);
  expect(first).toHaveLength(2);
  const winners: string[] = [];
  for (const m of first) {
    await request.post('/api/test/match-state', { data: { slug: m.slug, status: 'loaded' } });
    const won = await request.post(`/api/matches/${m.slug}/winner`, {
      headers: getAuthHeader(),
      data: { winner: 'team1' },
    });
    expect(won.ok(), await won.text()).toBe(true);
    winners.push(m.team1!.id);
  }

  const final = await findMatchByTeams(request, winners[0], winners[1]);
  expect(final?.slug, 'the final should have both winners').toBeTruthy();

  const winner = teams.find((t) => t.id === winners[0])!;
  expect(await impersonatePlayer(request, winner.players[0].steamId)).toBe(true);
  try {
    const body = (await (await request.get(`/api/team/${winner.id}/match`)).json()) as {
      match: {
        config: {
          players_per_team: number;
          team1: { players?: unknown[] };
          team2: { players?: unknown[] };
        };
      };
    };
    expect(body.match.config.team1.players?.length ?? 0).toBeGreaterThan(0);
    expect(body.match.config.team2.players?.length ?? 0).toBeGreaterThan(0);
    expect(body.match.config.players_per_team).toBe(winner.players.length);
  } finally {
    await stopImpersonating(request);
  }
});
