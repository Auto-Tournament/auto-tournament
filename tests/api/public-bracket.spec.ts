import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { createTournament } from '../helpers/tournaments';
import { createTestTeams } from '../helpers/teams';

/**
 * `GET /api/tournament/:id/bracket`: the public tournament page's Bracket and
 * Matches tabs read it with no session.
 *
 * It is an allow-listed copy of the admin bracket: teams, status and scores,
 * never the game server, the game module's match config (Steam IDs, in-game
 * admins, cvars) or per-player stats.
 *
 * @tag api
 * @tag tournament
 * @tag public
 */

const PUBLIC_MATCH_KEYS = new Set([
  'id',
  'slug',
  'round',
  'matchNumber',
  'status',
  'nextMatchId',
  'createdAt',
  'loadedAt',
  'completedAt',
  'team1',
  'team2',
  'winner',
  'team1Score',
  'team2Score',
  'team1SeriesScore',
  'team2SeriesScore',
  'team1MapScore',
  'team2MapScore',
  'mapResults',
]);

test.describe('Public bracket API', () => {
  test(
    'answers anonymous visitors with matches and nothing admin-only',
    { tag: ['@api', '@tournament', '@public'] },
    async ({ request, playwright }, testInfo) => {
      await signInViaRequest(request);
      const teams = await createTestTeams(request, 'public-bracket');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;

      const tournament = await createTournament(request, {
        name: `Public Bracket ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [team1.id, team2.id],
      });
      expect(tournament).toBeTruthy();

      // A fresh context: no session cookie at all.
      const stranger = await playwright.request.newContext({
        baseURL: testInfo.project.use.baseURL,
      });
      try {
        const response = await stranger.get(`/api/tournament/${tournament!.id}/bracket`);
        expect(response.status(), await response.text()).toBe(200);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.tournament.id).toBe(tournament!.id);
        expect(Array.isArray(data.matches)).toBe(true);
        expect(data.matches.length).toBeGreaterThan(0);

        for (const match of data.matches) {
          for (const key of Object.keys(match)) {
            expect(PUBLIC_MATCH_KEYS.has(key), `unexpected public match field "${key}"`).toBe(true);
          }
          expect(match).not.toHaveProperty('serverId');
          expect(match).not.toHaveProperty('config');
          expect(match).not.toHaveProperty('team1Players');
        }

        const first = data.matches.find((m: { round: number }) => m.round === 1);
        const names = [first.team1?.name, first.team2?.name];
        expect(names).toContain(team1.name);
        expect(names).toContain(team2.name);

        // Another tournament id is refused, as on the leaderboard route.
        const other = await stranger.get(`/api/tournament/${tournament!.id + 1000}/bracket`);
        expect(other.status()).toBe(400);
      } finally {
        await stranger.dispose();
      }
    }
  );
});
