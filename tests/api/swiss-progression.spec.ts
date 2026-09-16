import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * Swiss tournaments play every round, not just round 1.
 *
 * QA ran an 8-team Swiss BO1 on 2.4.9: round 1 finished and round 2 was never
 * paired, so the tournament sat in_progress forever. Two things were wrong:
 *
 *  - the round-completion query used `status = "pending"`, which Postgres reads
 *    as a column name, so every final series_end of a round threw
 *    (`column "pending" does not exist`) and answered the plugin with a 500;
 *  - nothing ever paired round 2+. The generator creates every round up front
 *    but only fills round 1.
 *
 * These specs drive whole tournaments through series_end events only.
 *
 * @tag api
 * @tag regression
 */

const MAPS = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-MatchZy-Token': process.env.SERVER_TOKEN ?? 'server123',
};

type ListedMatch = {
  id: number;
  slug: string;
  round: number;
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
  winner?: { id: string } | null;
  vetoCompleted?: boolean;
};

type TournamentBody = {
  tournament?: { status?: string; winner?: { id: string } | null };
};

async function swissMatches(request: APIRequestContext): Promise<ListedMatch[]> {
  const res = await request.get('/api/matches', { headers: getAuthHeader() });
  expect(res.ok(), `listing matches failed: ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { matches?: ListedMatch[] };
  return (body.matches ?? [])
    .filter((m) => /^swiss-r\d+m\d+$/.test(m.slug))
    .sort((a, b) => a.round - b.round || a.slug.localeCompare(b.slug));
}

const roundOf = (matches: ListedMatch[], round: number) => matches.filter((m) => m.round === round);
const isBye = (m: ListedMatch) => Boolean(m.team1) !== Boolean(m.team2);

async function seriesEnd(request: APIRequestContext, match: ListedMatch, winner: 'team1' | 'team2') {
  return request.post(`/api/events/${match.slug}`, {
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
}

/** Deterministic but mixed results: the lower team id wins on even rounds. */
function pickWinner(match: ListedMatch): 'team1' | 'team2' {
  const t1Lower = match.team1!.id < match.team2!.id;
  return (match.round % 2 === 0) === t1Lower ? 'team1' : 'team2';
}

/** Records and opponents from completed matches, as the test sees them. */
function records(matches: ListedMatch[]) {
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  const opponents = new Map<string, Set<string>>();
  const byes = new Map<string, number>();
  const bump = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);
  for (const m of matches) {
    if (m.status !== 'completed' || !m.winner) continue;
    if (isBye(m)) {
      bump(wins, m.winner.id);
      bump(byes, m.winner.id);
      continue;
    }
    const loser = m.winner.id === m.team1!.id ? m.team2!.id : m.team1!.id;
    bump(wins, m.winner.id);
    bump(losses, loser);
    for (const [a, b] of [
      [m.team1!.id, m.team2!.id],
      [m.team2!.id, m.team1!.id],
    ]) {
      if (!opponents.has(a)) opponents.set(a, new Set());
      opponents.get(a)!.add(b);
    }
  }
  const record = (id: string) => `${wins.get(id) ?? 0}-${losses.get(id) ?? 0}`;
  return { wins, record, opponents, byes };
}

/** Wait until every match of `round` has been paired. */
async function waitForPairedRound(request: APIRequestContext, round: number) {
  let paired: ListedMatch[] = [];
  await expect
    .poll(
      async () => {
        paired = roundOf(await swissMatches(request), round);
        return paired.length > 0 && paired.every((m) => m.team1 || m.team2);
      },
      { message: `round ${round} should be paired`, timeout: 20_000 }
    )
    .toBe(true);
  return paired;
}

async function finishRound(request: APIRequestContext, round: number) {
  for (const match of roundOf(await swissMatches(request), round)) {
    if (isBye(match)) continue;
    const res = await seriesEnd(request, match, pickWinner(match));
    // The quoting bug answered the last series_end of a round with a 500.
    expect(res.status(), `series_end for ${match.slug}: ${await res.text()}`).toBe(200);
  }
}

async function waitForChampion(request: APIRequestContext): Promise<string | null> {
  let winnerId: string | null = null;
  await expect
    .poll(
      async () => {
        const res = await request.get('/api/tournament', { headers: getAuthHeader() });
        if (!res.ok()) return null;
        const body = (await res.json()) as TournamentBody;
        winnerId = body.tournament?.winner?.id ?? null;
        return body.tournament?.status;
      },
      { message: 'the tournament should complete', timeout: 20_000 }
    )
    .toBe('completed');
  return winnerId;
}

test.describe.serial('Swiss round progression', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    // Keep the automated veto out of the way; pairing is what is under test.
    await request.put('/api/settings', { data: { simulateMatches: false } });
  });

  test(
    'an 8-team Swiss pairs equal records without rematches and finishes with a champion',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      const setup = await setupTournament(request, {
        type: 'swiss',
        format: 'bo1',
        maps: MAPS,
        teamCount: 8,
        serverCount: 1,
        prefix: 'swiss8',
      });
      expect(setup, 'tournament setup failed').toBeTruthy();

      const all = await swissMatches(request);
      expect(all, '3 rounds of 4 matches').toHaveLength(12);
      expect(roundOf(all, 1).every((m) => m.team1 && m.team2)).toBe(true);
      expect(roundOf(all, 2).every((m) => !m.team1 && !m.team2)).toBe(true);

      for (let round = 1; round <= 3; round++) {
        const matches = await waitForPairedRound(request, round);
        expect(matches).toHaveLength(4);

        const { record, opponents } = records(await swissMatches(request));
        const seen = new Set<string>();
        for (const m of matches) {
          expect(m.team1 && m.team2, `${m.slug} has both teams`).toBeTruthy();
          const [a, b] = [m.team1!.id, m.team2!.id];
          expect(record(a), `${m.slug} pairs equal records`).toBe(record(b));
          expect(opponents.get(a)?.has(b) ?? false, `${m.slug} is not a rematch`).toBe(false);
          seen.add(a);
          seen.add(b);
        }
        expect(seen.size, 'every team plays every round').toBe(8);

        await finishRound(request, round);
      }

      const champion = await waitForChampion(request);
      const { wins } = records(await swissMatches(request));
      const unbeaten = [...wins.entries()].filter(([, w]) => w === 3).map(([id]) => id);
      expect(unbeaten).toHaveLength(1);
      expect(champion, 'the 3-0 team is the champion').toBe(unbeaten[0]);
    }
  );

  test(
    'duplicate and concurrent series_end events pair the next round exactly once',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      const setup = await setupTournament(request, {
        type: 'swiss',
        format: 'bo1',
        maps: MAPS,
        teamCount: 8,
        serverCount: 1,
        prefix: 'swissdup',
      });
      expect(setup, 'tournament setup failed').toBeTruthy();

      const round1 = roundOf(await swissMatches(request), 1);
      for (const match of round1.slice(0, -1)) {
        expect((await seriesEnd(request, match, pickWinner(match))).status()).toBe(200);
      }

      // The plugin retries, and a synthesized series_end can race its own.
      const last = round1[round1.length - 1];
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => seriesEnd(request, last, pickWinner(last)))
      );
      for (const res of responses) expect(res.status()).toBe(200);

      const paired = await waitForPairedRound(request, 2);
      const snapshot = paired.map((m) => `${m.slug}:${m.team1?.id}:${m.team2?.id}`).sort();
      const teams = new Set(paired.flatMap((m) => [m.team1?.id, m.team2?.id]));
      expect(teams.size, 'eight distinct teams in round 2').toBe(8);

      // Retries after the fact, and bracket fetches (which also run the
      // advancement check), must not re-pair anything.
      expect((await seriesEnd(request, last, pickWinner(last))).status()).toBe(200);
      await request.get('/api/tournament/bracket');
      await request.get('/api/tournament', { headers: getAuthHeader() });

      const after = await swissMatches(request);
      expect(
        roundOf(after, 2)
          .map((m) => `${m.slug}:${m.team1?.id}:${m.team2?.id}`)
          .sort()
      ).toEqual(snapshot);
      expect(roundOf(after, 3).every((m) => !m.team1 && !m.team2), 'round 3 still unpaired').toBe(
        true
      );
    }
  );

  test(
    'in simulation mode the paired round is auto-vetoed like round 1',
    { tag: ['@api', '@regression', '@simulation'] },
    async ({ request }) => {
      const res = await request.put('/api/settings', { data: { simulateMatches: true } });
      const enabled = Boolean((await res.json()).settings?.simulateMatches);
      test.skip(!enabled, 'simulation mode is not allowed in this environment');
      test.setTimeout(90_000);

      try {
        const setup = await setupTournament(request, {
          type: 'swiss',
          format: 'bo1',
          maps: MAPS,
          teamCount: 4,
          serverCount: 1,
          prefix: 'swisssim',
        });
        expect(setup, 'tournament setup failed').toBeTruthy();

        await finishRound(request, 1);
        await waitForPairedRound(request, 2);

        await expect
          .poll(
            async () => roundOf(await swissMatches(request), 2).every((m) => m.vetoCompleted),
            { message: 'round 2 vetoes should complete automatically', timeout: 60_000 }
          )
          .toBe(true);
      } finally {
        await request.put('/api/settings', { data: { simulateMatches: false } });
      }
    }
  );

  test(
    'an odd team count gives one bye per round, never twice to the same team',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      const setup = await setupTournament(request, {
        type: 'swiss',
        format: 'bo1',
        maps: MAPS,
        teamCount: 5,
        serverCount: 1,
        prefix: 'swiss5',
      });
      expect(setup, 'tournament setup failed').toBeTruthy();

      const rounds = 3; // ceil(log2(5))
      for (let round = 1; round <= rounds; round++) {
        const matches = await waitForPairedRound(request, round);
        expect(matches).toHaveLength(3);
        const byes = matches.filter(isBye);
        expect(byes, `round ${round} has one bye`).toHaveLength(1);
        expect(byes[0].status, 'a bye is an immediate win').toBe('completed');

        const { opponents } = records(await swissMatches(request));
        for (const m of matches.filter((x) => !isBye(x))) {
          expect(opponents.get(m.team1!.id)?.has(m.team2!.id) ?? false).toBe(false);
        }

        await finishRound(request, round);
      }

      const { byes } = records(await swissMatches(request));
      expect([...byes.values()].every((n) => n === 1), 'no team gets two byes').toBe(true);
      expect(byes.size).toBe(rounds);
      expect(await waitForChampion(request), 'a champion is named').toBeTruthy();
    }
  );
});
