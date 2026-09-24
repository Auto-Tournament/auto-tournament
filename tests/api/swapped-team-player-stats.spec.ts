import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { createAndStartTournament } from '../helpers/tournaments';
import { findMatchByTeams } from '../helpers/matches';
import type { Team } from '../helpers/teams';

/**
 * Player stats are matched by steamid, not by the team block they arrive in.
 *
 * Auto Tournament CS2 has shipped `round_end` payloads that list team 2's players inside
 * the `team1` block. MAT looked each roster player up in its own side's
 * dictionary, so every player missed and their match history showed 0 kills,
 * 0 damage and 0.0 ADR after a finished match (QA, MAT 2.4.6). Matching on
 * steamid is correct whichever block the plugin used.
 *
 * @tag api
 * @tag stats
 * @tag regression
 */

const MAPS = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123',
};

function playerBlock(team: Team, kills: number, damage: number) {
  return {
    players: team.players.map((p) => ({
      steamid: p.steamId,
      name: p.name,
      stats: {
        kills,
        deaths: 5,
        assists: 2,
        damage,
        rounds_played: 20,
        kast: 70,
      },
    })),
  };
}

test.describe.serial('Swapped team blocks in round_end', () => {
  test(
    'players keep their own stats when the plugin files them under the other team',
    { tag: ['@api', '@stats', '@regression'] },
    async ({ page, request }) => {
      await ensureSignedIn(page);
      await signInViaRequest(request);

      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamCount: 2,
        serverCount: 1,
        prefix: 'swapped-stats',
      });
      expect(setup).toBeTruthy();
      if (!setup) return;
      const [team1, team2] = [setup.teams[0], setup.teams[1]];

      const tournament = await createAndStartTournament(request, {
        name: `Swapped Stats ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamIds: [team1.id, team2.id],
      });
      expect(tournament).toBeTruthy();

      const match = await findMatchByTeams(request, team1.id, team2.id);
      expect(match?.slug).toBeTruthy();
      const slug = match!.slug;

      const TEAM1_KILLS = 21;
      const TEAM1_DAMAGE = 2100;
      const TEAM2_KILLS = 9;
      const TEAM2_DAMAGE = 900;

      // Note the swap: team 2's players are sent inside the team1 block.
      const roundEnd = await request.post(`/api/events/${slug}`, {
        headers: SERVER_HEADERS,
        data: {
          event: 'round_end',
          matchid: slug,
          map_number: 0,
          round_number: 20,
          winner: 'team1',
          team1_score: 13,
          team2_score: 7,
          team1: playerBlock(team2, TEAM2_KILLS, TEAM2_DAMAGE),
          team2: playerBlock(team1, TEAM1_KILLS, TEAM1_DAMAGE),
        },
      });
      expect(roundEnd.ok(), `round_end rejected: ${await roundEnd.text()}`).toBe(true);

      const seriesEnd = await request.post(`/api/events/${slug}`, {
        headers: SERVER_HEADERS,
        data: {
          event: 'series_end',
          matchid: slug,
          team1_series_score: 1,
          team2_series_score: 0,
          winner: 'team1',
          num_maps: 1,
          time_until_restore: 0,
        },
      });
      expect(seriesEnd.ok()).toBe(true);

      const readRow = async (steamId: string) => {
        const res = await request.get(`/api/players/${steamId}/summary`);
        if (!res.ok()) return null;
        const body = await res.json();
        const rows = body.matches ?? body.data?.matches ?? [];
        return (
          rows.find(
            (m: { match_slug?: string; slug?: string }) => (m.match_slug ?? m.slug) === slug
          ) ?? null
        );
      };

      const team1Player = team1.players[0].steamId;
      const team2Player = team2.players[0].steamId;

      await expect
        .poll(async () => (await readRow(team1Player))?.kills ?? null, {
          message: 'stats for the finished match to be recorded',
          timeout: 20000,
          intervals: [500, 1000],
        })
        .not.toBeNull();

      const row1 = await readRow(team1Player);
      const row2 = await readRow(team2Player);

      // Before the fix both rows were 0 kills / 0 damage / 0.0 ADR.
      expect(row1.kills).toBe(TEAM1_KILLS);
      expect(row1.total_damage).toBe(TEAM1_DAMAGE);
      expect(row1.adr).toBeGreaterThan(0);
      expect(row2.kills).toBe(TEAM2_KILLS);
      expect(row2.total_damage).toBe(TEAM2_DAMAGE);
      expect(row2.adr).toBeGreaterThan(0);
    }
  );
});
