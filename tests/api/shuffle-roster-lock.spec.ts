import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { setupShuffleTournament, generateRound } from '../helpers/shuffleTournament';

/**
 * Regression for the Discord report "shuffle tournament: everyone could join
 * any team, regardless of the randomly created teams".
 *
 * The game server can only hold players to the shuffled teams if the match
 * config it fetches carries those teams as explicit rosters. This pins that
 * down: every round-1 match config names two disjoint five-player rosters,
 * `players_per_team` matches, and together the matches cover exactly the
 * registered players - nobody is left off a roster (and so free to pick a side).
 *
 * @tag api
 * @tag shuffle
 */

type Roster = Record<string, string>;
interface ServedConfig {
  players_per_team?: number;
  team1?: { name?: string; players?: Roster };
  team2?: { name?: string; players?: Roster };
}

async function roundOneMatches(request: APIRequestContext): Promise<{ slug: string }[]> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request.get('/api/matches', { headers: getAuthHeader() });
    const body = (await res.json()) as { matches: { slug: string; round: number }[] };
    const matches = body.matches.filter((m) => m.round === 1);
    if (matches.length > 0) return matches;
    if (attempt === 4) await generateRound(request, 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return [];
}

test.describe.serial('Shuffle tournament rosters', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
  });

  test.afterEach(async ({ request }) => {
    await request.delete('/api/tournament', { headers: getAuthHeader() }).catch(() => undefined);
  });

  test(
    'served match configs lock every registered player to one shuffled team',
    { tag: ['@api', '@shuffle'] },
    async ({ request }) => {
      const setup = await setupShuffleTournament(request, {
        playerCount: 20,
        mapSequence: ['de_mirage'],
        prefix: 'roster-lock',
        startTournament: true,
      });
      expect(setup).toBeTruthy();
      const registered = new Set(setup!.players.map((p) => p.id));

      const matches = await roundOneMatches(request);
      expect(matches.length).toBe(2);

      const seen = new Set<string>();
      for (const match of matches) {
        const res = await request.get(`/api/matches/${match.slug}.json`, {
          headers: { 'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123' },
        });
        expect(res.ok(), `config for ${match.slug}: ${res.status()}`).toBe(true);
        const config = (await res.json()) as ServedConfig;

        const team1 = Object.keys(config.team1?.players ?? {});
        const team2 = Object.keys(config.team2?.players ?? {});
        expect(config.players_per_team).toBe(5);
        expect(team1).toHaveLength(5);
        expect(team2).toHaveLength(5);
        expect(team1.filter((id) => team2.includes(id))).toEqual([]);

        for (const id of [...team1, ...team2]) {
          expect(registered.has(id), `${id} is a registered player`).toBe(true);
          expect(seen.has(id), `${id} is on only one roster this round`).toBe(false);
          seen.add(id);
        }
      }
      expect(seen.size).toBe(registered.size);
    }
  );
});
