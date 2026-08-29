import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import type { Team } from '../helpers/teams';

/**
 * Series stats aggregation
 *
 * `round_end` reports per-player stats cumulative *within the current map*, so
 * each new map's events overwrite the previous map's numbers. Recording the
 * final snapshot therefore captured only the last map of a BO3/BO5, which is
 * what a user hit on Discord (2026-05-10): "the KDA on your profile is taken
 * from last map of bo3 or bo5".
 *
 * @tag api
 * @tag stats
 */

const MAPS = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

interface MapStats {
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  rounds: number;
}

function roundEndPayload(
  matchSlug: string,
  mapNumber: number,
  team1: Team,
  team2: Team,
  statsFor: (steamId: string) => MapStats
) {
  const side = (team: Team) => ({
    players: team.players.map((p) => {
      const s = statsFor(p.steamId);
      return {
        steamid: p.steamId,
        name: p.name,
        stats: {
          kills: s.kills,
          deaths: s.deaths,
          assists: s.assists,
          damage: s.damage,
          rounds_played: s.rounds,
          kast: 70,
        },
      };
    }),
  });

  return {
    event: 'round_end',
    matchid: matchSlug,
    map_number: mapNumber,
    round_number: 12,
    winner: 'team1',
    team1_score: 13,
    team2_score: 5,
    team1: side(team1),
    team2: side(team2),
  };
}

test.describe.serial('Series stats', () => {
  let team1: Team;
  let team2: Team;

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    await signInViaRequest(request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo3',
      maps: MAPS,
      teamCount: 2,
      serverCount: 1,
      prefix: 'series-stats',
    });
    expect(setup).toBeTruthy();
    if (!setup) return;
    [team1, team2] = [setup.teams[0], setup.teams[1]];
  });

  test('a BO3 records the sum of every map, not just the last one', {
    tag: ['@api', '@stats', '@regression'],
  }, async ({ request }) => {
    const tournament = await createAndStartTournament(request, {
      name: `Series Stats ${Date.now()}`,
      type: 'single_elimination',
      format: 'bo3',
      maps: MAPS,
      teamIds: [team1.id, team2.id],
    });
    expect(tournament).toBeTruthy();

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();
    const slug = match!.slug;

    const headers = {
      'Content-Type': 'application/json',
      'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
    };

    // Map 1, then map 2 with smaller numbers. If only the last map is kept, the
    // totals below come out as map 2 alone.
    const map1: MapStats = { kills: 20, deaths: 10, assists: 4, damage: 2000, rounds: 20 };
    const map2: MapStats = { kills: 6, deaths: 8, assists: 2, damage: 800, rounds: 10 };

    for (const [mapNumber, stats] of [
      [1, map1],
      [2, map2],
    ] as const) {
      const res = await request.post(`/api/events/${slug}`, {
        headers,
        data: roundEndPayload(slug, mapNumber, team1, team2, () => stats),
      });
      expect(res.ok(), `round_end for map ${mapNumber} should be accepted`).toBe(true);
    }

    const seriesEnd = await request.post(`/api/events/${slug}`, {
      headers,
      data: {
        event: 'series_end',
        matchid: slug,
        team1_series_score: 2,
        team2_series_score: 0,
        winner: 'team1',
        num_maps: 3,
        time_until_restore: 0,
        team1_name: team1.name,
        team2_name: team2.name,
      },
    });
    expect(seriesEnd.ok()).toBe(true);

    const steamId = team1.players[0].steamId;

    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/players/${steamId}/summary`);
          if (!res.ok()) return null;
          const body = await res.json();
          const rows = body.matches ?? body.data?.matches ?? [];
          const row = rows.find((m: { match_slug?: string; slug?: string }) =>
            (m.match_slug ?? m.slug) === slug
          );
          return row?.kills ?? null;
        },
        { message: 'stats for the series to be recorded', timeout: 20000, intervals: [500, 1000] }
      )
      .not.toBeNull();

    const summary = await (await request.get(`/api/players/${steamId}/summary`)).json();
    const rows = summary.matches ?? summary.data?.matches ?? [];
    const row = rows.find((m: { match_slug?: string; slug?: string }) =>
      (m.match_slug ?? m.slug) === slug
    );

    expect(row, 'the series should have a stats row').toBeTruthy();
    // Sum of both maps. Before the fix this was map 2 alone (6/8/2).
    expect(row.kills).toBe(map1.kills + map2.kills);
    expect(row.deaths).toBe(map1.deaths + map2.deaths);
    expect(row.assists).toBe(map1.assists + map2.assists);
    expect(row.total_damage).toBe(map1.damage + map2.damage);
  });
});
