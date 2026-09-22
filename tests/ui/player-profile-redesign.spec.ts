import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import type { Team } from '../helpers/teams';

/**
 * Redesigned public player profile.
 *
 * A player with a few recorded matches should see the new stats grid
 * (MATCHES, WIN RATE, …) and the recent-matches list, built from real match
 * data recorded through the same `round_end` / `series_end` event path
 * MatchZy servers use — not fabricated numbers.
 *
 * @tag ui
 * @tag public
 * @tag players
 */

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

function statsPayload(team: Team, kills: number, deaths: number) {
  return {
    players: team.players.map((p) => ({
      steamid: p.steamId,
      name: p.name,
      stats: {
        kills,
        deaths,
        assists: 2,
        damage: kills * 100,
        rounds_played: 16,
        kast: 70,
      },
    })),
  };
}

test.describe('Redesigned player profile', () => {
  test(
    'shows the stats grid and recent matches for a player with recorded matches',
    { tag: ['@ui', '@public', '@players'] },
    async ({ page, request }) => {
      await setupTestContext(page, request);

      const setup = await setupTournament(request, {
        format: 'bo1',
        teamCount: 2,
        serverCount: 1,
        prefix: 'profile-redesign',
      });
      expect(setup).toBeTruthy();
      if (!setup) return;
      const [team1, team2] = [setup.teams[0], setup.teams[1]];

      const match = await findMatchByTeams(request, team1.id, team2.id);
      expect(match?.slug).toBeTruthy();
      const slug = match!.slug;

      // team1 wins 13-7 with a clean K/D so WIN RATE and the recent-matches
      // row have something real to show.
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
          team1: statsPayload(team1, 20, 10),
          team2: statsPayload(team2, 10, 20),
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
          team1_name: team1.name,
          team2_name: team2.name,
        },
      });
      expect(seriesEnd.ok(), `series_end rejected: ${await seriesEnd.text()}`).toBe(true);

      const steamId = team1.players[0].steamId;

      // Wait for the stats pipeline to land before navigating, so the page
      // doesn't race an in-flight write.
      await expect
        .poll(
          async () => {
            const res = await request.get(`/api/players/${steamId}/summary`);
            if (!res.ok()) return null;
            const body = await res.json();
            const rows = body.matches ?? [];
            const row = rows.find((m: { slug?: string }) => m.slug === slug);
            return row?.kills ?? null;
          },
          { message: 'stats for the match to be recorded', timeout: 20000, intervals: [500, 1000] }
        )
        .not.toBeNull();

      await page.goto(`/player/${steamId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('public-player-page')).toBeVisible({ timeout: 15000 });

      // Stats grid: MATCHES and WIN RATE tiles, with the real numbers this
      // player's one recorded, won match produces.
      const statsGrid = page.getByTestId('profile-stats-grid');
      await expect(statsGrid).toBeVisible();
      await expect(page.getByTestId('profile-stat-matches')).toContainText('1');
      await expect(page.getByTestId('profile-stat-win-rate')).toContainText('100%');

      // Recent matches: the just-finished match shows up, W tile and kills/deaths.
      const recentMatches = page.getByTestId('profile-recent-matches');
      await expect(recentMatches).toBeVisible();
      const row = page.getByTestId(`profile-recent-match-${slug}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText('20 / 10');
    }
  );
});
