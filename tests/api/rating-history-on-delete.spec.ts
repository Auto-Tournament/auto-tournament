import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import type { Team } from '../helpers/teams';

/**
 * Deleting a tournament keeps players' ratings AND the history behind them.
 * The history used to cascade away with the matches, leaving ratings nothing
 * explained. Reset is different ("play it again"): it rolls ratings back and
 * removes that run's history (#222).
 *
 * @tag api
 * @tag regression
 */

interface HistoryRow {
  match_slug: string | null;
  match_label: string | null;
  tournament_name: string | null;
  elo_after: number;
  created_at: number;
}

async function currentElo(request: APIRequestContext, steamId: string): Promise<number> {
  const body = await (await request.get(`/api/players/${steamId}`)).json();
  return body.player.currentElo as number;
}

async function history(request: APIRequestContext, steamId: string): Promise<HistoryRow[]> {
  const res = await request.get(`/api/players/${steamId}/rating-history`);
  expect(res.ok()).toBe(true);
  return (await res.json()).history as HistoryRow[];
}

/** Starts a fresh tournament, finishes its only match, returns the rated row. */
async function playRatedMatch(request: APIRequestContext, name: string) {
  const setup = await setupTournament(request, { teamCount: 2, serverCount: 1, name, prefix: 'rating-hist' });
  expect(setup).toBeTruthy();
  const [team1, team2] = setup!.teams as Team[];
  const steamId = team1.players[0].steamId;
  const eloBefore = await currentElo(request, steamId);

  const match = await findMatchByTeams(request, team1.id, team2.id);
  const slug = match!.slug;
  const res = await request.post(`/api/events/${slug}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123',
    },
    data: {
      event: 'series_end',
      matchid: slug,
      team1_series_score: 1,
      team2_series_score: 0,
      winner: 'team1',
      num_maps: 1,
      time_until_restore: 0,
      team1_name: team1.name,
      team2_name: team2.name,
    },
  });
  expect(res.ok()).toBe(true);

  let row: HistoryRow | undefined;
  await expect
    .poll(async () => {
      row = (await history(request, steamId)).find((h) => h.tournament_name === name);
      return row?.match_slug ?? null;
    })
    .toBe(slug);
  return { steamId, slug, eloBefore, row: row!, team1, team2 };
}

test.describe.serial('Rating history across tournament delete and reset', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
  });

  test('delete keeps history (unlinked, labelled) and ratings', {
    tag: ['@api', '@regression'],
  }, async ({ request }) => {
    const name = `Rating Delete ${Date.now()}`;
    const { steamId, row, team1, team2 } = await playRatedMatch(request, name);
    const eloAfterMatch = await currentElo(request, steamId);
    expect(eloAfterMatch).toBe(row.elo_after);

    const del = await request.delete('/api/tournament', { headers: getAuthHeader() });
    expect(del.ok()).toBe(true);

    expect(await currentElo(request, steamId), 'delete must not touch ratings').toBe(eloAfterMatch);

    const kept = (await history(request, steamId)).find((h) => h.tournament_name === name);
    expect(kept, 'history row survives the delete').toBeTruthy();
    expect(kept!.match_slug).toBeNull();
    expect(kept!.match_label).toBe(`${team1.name} vs ${team2.name}`);
    expect(kept!.elo_after).toBe(row.elo_after);
    expect(kept!.created_at).toBe(row.created_at);

    // The player page reads the orphaned row without a match behind it.
    const summary = await request.get(`/api/players/${steamId}/summary`);
    expect(summary.ok()).toBe(true);
    const summaryRows = (await summary.json()).ratingHistory as HistoryRow[];
    expect(summaryRows.some((h) => h.tournament_name === name && h.match_slug === null)).toBe(true);
  });

  test('reset rolls ratings back and removes that run\'s history', {
    tag: ['@api', '@regression'],
  }, async ({ request }) => {
    const name = `Rating Reset ${Date.now()}`;
    const { steamId, eloBefore } = await playRatedMatch(request, name);

    const reset = await request.post('/api/tournament/reset', { headers: getAuthHeader() });
    expect(reset.ok()).toBe(true);

    expect(await currentElo(request, steamId), 'reset rolls the rating back').toBe(eloBefore);
    const rows = await history(request, steamId);
    expect(rows.filter((h) => h.tournament_name === name)).toHaveLength(0);
  });
});
