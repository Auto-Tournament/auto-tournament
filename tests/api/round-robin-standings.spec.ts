import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { computeRoundRobinStandings } from '../../api/src/utils/roundRobinStandings';

/**
 * Round robin ends with a champion and a strict order (#225).
 *
 * QA, MAT 2.4.12 (4 teams, Bo1): Alpha, Delta and Charlie finished 2-1 and all
 * showed rank 1, Bravo (0-3) rank 2, and `/api/tournament` returned
 * `winner: null` because round robin only counted wins and gave up on a tie.
 *
 * Standings order: wins, then head-to-head wins among the tied teams, then
 * round difference over all maps, then rounds won, then seed.
 *
 * @tag api
 * @tag regression
 */

const done = (team1Id: string, team2Id: string, winnerId: string | null, t1: number, t2: number) => ({
  team1Id,
  team2Id,
  winnerId,
  status: 'completed',
  team1Rounds: t1,
  team2Rounds: t2,
});

test.describe('Round robin standings', () => {
  test('wins first', () => {
    const order = computeRoundRobinStandings(
      ['a', 'b', 'c'],
      [done('a', 'b', 'b', 12, 13), done('b', 'c', 'b', 13, 0), done('a', 'c', 'a', 13, 11)]
    ).map((s) => s.teamId);
    expect(order).toEqual(['b', 'a', 'c']);
  });

  test('two teams level on wins: the head-to-head winner is ahead, whatever the round difference', () => {
    // a and b both 2-1; b beat a narrowly, a won its other games big.
    const standings = computeRoundRobinStandings(
      ['a', 'b', 'c', 'd'],
      [
        done('a', 'b', 'b', 11, 13),
        done('a', 'c', 'a', 13, 0),
        done('a', 'd', 'a', 13, 0),
        done('b', 'c', 'c', 5, 13),
        done('b', 'd', 'b', 13, 11),
        done('c', 'd', 'd', 3, 13),
      ]
    );
    const a = standings.find((s) => s.teamId === 'a')!;
    const b = standings.find((s) => s.teamId === 'b')!;
    expect(a.roundDiff).toBeGreaterThan(b.roundDiff);
    expect(standings.map((s) => s.teamId).slice(0, 2)).toEqual(['b', 'a']);
  });

  test('three-way tie with a cycle: head-to-head is level, round difference decides', () => {
    const standings = computeRoundRobinStandings(
      ['alpha', 'bravo', 'charlie', 'delta'],
      [
        done('alpha', 'bravo', 'alpha', 13, 5),
        done('charlie', 'bravo', 'charlie', 13, 6),
        done('delta', 'bravo', 'delta', 13, 7),
        done('alpha', 'delta', 'alpha', 13, 11),
        done('delta', 'charlie', 'delta', 13, 3),
        done('charlie', 'alpha', 'charlie', 13, 10),
      ]
    );
    expect(standings.map((s) => [s.teamId, s.wins, s.roundDiff])).toEqual([
      ['delta', 2, 14],
      ['alpha', 2, 7],
      ['charlie', 2, 0],
      ['bravo', 0, -21],
    ]);
  });

  test('level on wins, head-to-head and round difference: rounds won, then seed', () => {
    // A cycle where every game is 13-11: same round difference for all three.
    const cycle = [done('a', 'b', 'a', 13, 11), done('b', 'c', 'b', 13, 11), done('c', 'a', 'c', 13, 11)];
    expect(computeRoundRobinStandings(['c', 'b', 'a'], cycle).map((s) => s.teamId)).toEqual([
      'c',
      'b',
      'a',
    ]);
    // Same, but c's win was 16-14 in overtime: more rounds won, same difference.
    const overtime = [done('a', 'b', 'a', 13, 11), done('b', 'c', 'b', 13, 11), done('c', 'a', 'c', 16, 14)];
    // a and c won 27 rounds, b 24: b is last despite the top seed; c and a
    // are still level and split on seed.
    const standings = computeRoundRobinStandings(['b', 'c', 'a'], overtime);
    expect(standings.map((s) => s.roundDiff)).toEqual([0, 0, 0]);
    expect(standings.map((s) => [s.teamId, s.roundsWon])).toEqual([
      ['c', 27],
      ['a', 27],
      ['b', 24],
    ]);
  });

  test('unfinished matches count for nothing', () => {
    const standings = computeRoundRobinStandings(
      ['a', 'b'],
      [{ team1Id: 'a', team2Id: 'b', winnerId: null, status: 'live', team1Rounds: 9, team2Rounds: 2 }]
    );
    expect(standings.map((s) => [s.teamId, s.wins, s.roundDiff])).toEqual([
      ['a', 0, 0],
      ['b', 0, 0],
    ]);
  });
});

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123',
};

type ListedMatch = {
  slug: string;
  round: number;
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

async function playBo1(
  request: APIRequestContext,
  match: ListedMatch,
  winner: 'team1' | 'team2',
  t1: number,
  t2: number
) {
  const mapRes = await request.post(`/api/events/${match.slug}`, {
    headers: SERVER_HEADERS,
    data: {
      event: 'map_result',
      matchid: match.slug,
      map_number: 0,
      map_name: 'de_mirage',
      team1_score: t1,
      team2_score: t2,
      winner: { side: winner === 'team1' ? '3' : '2', team: winner },
      team1: { score: t1, series_score: winner === 'team1' ? 1 : 0 },
      team2: { score: t2, series_score: winner === 'team2' ? 1 : 0 },
    },
  });
  expect(mapRes.ok(), `map_result ${match.slug}: ${await mapRes.text()}`).toBe(true);
  const endRes = await request.post(`/api/events/${match.slug}`, {
    headers: SERVER_HEADERS,
    data: {
      event: 'series_end',
      matchid: match.slug,
      team1_series_score: winner === 'team1' ? 1 : 0,
      team2_series_score: winner === 'team2' ? 1 : 0,
      winner: { side: winner === 'team1' ? '3' : '2', team: winner },
      time_until_restore: 0,
    },
  });
  expect(endRes.status(), `series_end ${match.slug}: ${await endRes.text()}`).toBe(200);
}

test.describe.serial('Round robin completion', () => {
  test(
    'the QA table: three teams on 2-1 are split by round difference and the top one is champion',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await signInViaRequest(request);
      await request.put('/api/settings', { data: { simulateMatches: false } });

      const setup = await setupTournament(request, {
        type: 'round_robin',
        format: 'bo1',
        teamCount: 4,
        serverCount: 1,
        prefix: 'rrstand',
      });
      expect(setup, 'tournament setup failed').toBeTruthy();
      const [alpha, bravo, charlie, delta] = setup!.teams.map((t) => t.id);

      // winner id, loser id, winner rounds, loser rounds (same results as the cycle unit test)
      const results: Array<[string, string, number, number]> = [
        [alpha, bravo, 13, 5],
        [charlie, bravo, 13, 6],
        [delta, bravo, 13, 7],
        [alpha, delta, 13, 11],
        [delta, charlie, 13, 3],
        [charlie, alpha, 13, 10],
      ];

      const res = await request.get('/api/matches', { headers: getAuthHeader() });
      const matches = ((await res.json()) as { matches: ListedMatch[] }).matches.filter((m) =>
        /^r\d+m\d+$/.test(m.slug)
      );
      expect(matches).toHaveLength(6);
      for (const match of matches) {
        const ids = [match.team1!.id, match.team2!.id];
        const result = results.find(([w, l]) => ids.includes(w) && ids.includes(l));
        expect(result, `a result for ${match.slug}`).toBeTruthy();
        const [winnerId, , wr, lr] = result!;
        const winnerSide = match.team1!.id === winnerId ? 'team1' : 'team2';
        await playBo1(
          request,
          match,
          winnerSide,
          winnerSide === 'team1' ? wr : lr,
          winnerSide === 'team1' ? lr : wr
        );
      }

      let winnerId: string | null = null;
      await expect
        .poll(
          async () => {
            const t = await request.get('/api/tournament', { headers: getAuthHeader() });
            const body = (await t.json()) as {
              tournament?: { status?: string; winner?: { id: string } | null };
            };
            winnerId = body.tournament?.winner?.id ?? null;
            return body.tournament?.status;
          },
          { message: 'the tournament should complete', timeout: 20_000 }
        )
        .toBe('completed');
      expect(winnerId, 'Delta (+14) is champion, not a shared first place').toBe(delta);

      const expected = [delta, alpha, charlie, bravo];
      const bracketRes = await request.get('/api/tournament/bracket', { headers: getAuthHeader() });
      const bracket = (await bracketRes.json()) as {
        roundRobinStandings?: Array<{ rank: number; teamId: string; wins: number; roundDiff: number }>;
      };
      expect(bracket.roundRobinStandings, 'bracket carries roundRobinStandings').toBeTruthy();
      expect(bracket.roundRobinStandings!.map((s) => [s.rank, s.teamId, s.wins, s.roundDiff])).toEqual([
        [1, delta, 2, 14],
        [2, alpha, 2, 7],
        [3, charlie, 2, 0],
        [4, bravo, 0, -21],
      ]);

      const lbRes = await request.get('/api/tournament/1/leaderboard');
      const lb = (await lbRes.json()) as { teams?: Array<{ teamId: string; rank?: number }> };
      expect(lb.teams?.map((t) => t.teamId), 'leaderboard uses the same order').toEqual(expected);
      expect(lb.teams?.map((t) => t.rank)).toEqual([1, 2, 3, 4]);
    }
  );

  /**
   * The round opener that keeps a no-veto round robin moving must not reach
   * CS2. A CS2 round robin holds every match for the map veto, including
   * round 1, and finishing a round changes none of that: the veto is what
   * readies a match, in its own order and its own time.
   */
  test(
    'CS2 keeps the veto: a finished round does not ready the next one',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      await signInViaRequest(request);
      await request.put('/api/settings', { data: { simulateMatches: false } });

      const setup = await setupTournament(request, {
        type: 'round_robin',
        format: 'bo1',
        teamCount: 4,
        serverCount: 1,
        prefix: 'rrveto',
      });
      expect(setup, 'tournament setup failed').toBeTruthy();

      const listed = async () => {
        const res = await request.get('/api/matches', { headers: getAuthHeader() });
        return ((await res.json()) as { matches: ListedMatch[] }).matches.filter((m) =>
          /^r\d+m\d+$/.test(m.slug)
        );
      };

      // Started, and every match — round 1 included — waits for its veto.
      const created = await listed();
      expect(created).toHaveLength(6);
      expect(created.every((m) => m.status === 'pending')).toBe(true);

      // Play round 1 anyway (the events do not care about the veto).
      for (const match of created.filter((m) => m.round === 1)) {
        await playBo1(request, match, 'team1', 13, 5);
      }

      await expect
        .poll(async () => (await listed()).filter((m) => m.round === 1 && m.status === 'completed').length, {
          message: 'round 1 should complete',
          timeout: 20_000,
        })
        .toBe(2);

      // Round 2 is still the veto's to open, exactly as before.
      const after = await listed();
      expect(
        after.filter((m) => m.round > 1).map((m) => m.status),
        'CS2 rounds after 1 are still held for the veto'
      ).toEqual(['pending', 'pending', 'pending', 'pending']);
    }
  );
});
