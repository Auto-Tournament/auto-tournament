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
 * Auto Tournament CS2 servers use — not fabricated numbers.
 *
 * @tag ui
 * @tag public
 * @tag players
 */

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123',
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

      // Stats grid: MATCHES and WIN RATE tiles. They count the player's play
      // across the site: this match, plus the rated matches of tournaments
      // other suites deleted (the fixture players are shared), which only the
      // rating history still holds. So the numbers are checked against the
      // summary the page reads, not against "1".
      const summary = (await (await request.get(`/api/players/${steamId}/summary`)).json()) as {
        player: { matchCount: number };
        matches: Array<{ slug: string; won_match: boolean }>;
        ratingHistory: Array<{ match_slug: string | null; match_result: string }>;
      };
      const listed = new Set(summary.matches.map((m) => m.slug));
      const archived = summary.ratingHistory.filter(
        (h) => !h.match_slug || !listed.has(h.match_slug)
      );
      const played = summary.matches.length + archived.length;
      const won =
        summary.matches.filter((m) => m.won_match).length +
        archived.filter((h) => h.match_result === 'win').length;
      expect(played).toBe(summary.player.matchCount);
      const statsGrid = page.getByTestId('profile-stats-grid');
      await expect(statsGrid).toBeVisible();
      await expect(page.getByTestId('profile-stat-matches').locator('dd')).toHaveText(
        String(played)
      );
      await expect(page.getByTestId('profile-stat-win-rate').locator('dd')).toHaveText(
        `${Math.round((won / played) * 100)}%`
      );

      // Recent matches: the just-finished match shows up, W tile and kills/deaths.
      const recentMatches = page.getByTestId('profile-recent-matches');
      await expect(recentMatches).toBeVisible();
      const row = page.getByTestId(`profile-recent-match-${slug}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText('20 / 10');

      // CS2 measures kills and damage, so its profile keeps those tiles. The
      // manually reported game's spec (manual-report-stats-pages.spec.ts)
      // pins the other side: the same page with none of them.
      await expect(page.getByTestId('profile-stat-adr')).toBeVisible();
      await expect(page.getByTestId('profile-stat-kd')).toBeVisible();

      // Recent matches is the profile's only match list: the older "Match
      // History" table and "ELO Progression" chart are gone. Its row says
      // what the player's rating was after the match.
      await expect(page.getByTestId('profile-match-history')).toHaveCount(0);
      await expect(row).toContainText(/rating \d+/);

      // Profile header team chip links to that team's public profile page
      // (/t/team/:teamId), not the in-match/server team page (/team/:teamId).
      // It names the team, never "My team" / "Team:".
      const teamChip = page.getByTestId('public-player-team');
      await expect(teamChip).toBeVisible();
      await expect(teamChip).toHaveAttribute('href', `/t/team/${team1.id}`);
      await expect(teamChip).toContainText(team1.name);
      await expect(teamChip).not.toContainText(/my team|team:/i);

      // The stats are one joined grid: a `dl`, each number a `dd`, not a heading.
      await expect(statsGrid).toHaveJSProperty('tagName', 'DL');

      // The 3.0 profile is header, stats, Rating and Recent matches. The 2.x
      // sections below them are gone (design-conformance chunk 3): the
      // server-allocation countdown, the big "no active match" card, the
      // "My team" roster with raw Steam IDs, the recent-form highlights and
      // the second "no match history" list. The page's H1 is the name.
      await expect(page.getByTestId('public-player-my-team')).toHaveCount(0);
      await expect(page.getByText(/Next servers allocated/i)).toHaveCount(0);
      await expect(page.getByText('No active match right now')).toHaveCount(0);
      await expect(page.getByText('Recent Form & Highlights')).toHaveCount(0);
      await expect(page.getByText('No match history yet')).toHaveCount(0);
      await expect(page.getByText(`Steam ID: ${steamId}`)).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(team1.players[0].name);
    }
  );
});
