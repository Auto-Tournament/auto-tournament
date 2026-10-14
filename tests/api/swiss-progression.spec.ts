import { test, expect, type APIRequestContext } from '@playwright/test';
import { currentTournamentId, currentTournamentMatches } from '../helpers/slugs';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import {
  sendReadyUpEvents,
  seriesEnd as readyUpSeriesEnd,
  mapResult as readyUpMapResult,
} from '../helpers/readyUp';

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

const MAPS = [
  'de_mirage',
  'de_inferno',
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_vertigo',
  'de_nuke',
];

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
  return (await currentTournamentMatches(request, body.matches ?? []))
    .filter((m) => /^(t\d+-)?swiss-r\d+m\d+$/.test(m.slug))
    .sort((a, b) => a.round - b.round || a.slug.localeCompare(b.slug));
}

const roundOf = (matches: ListedMatch[], round: number) => matches.filter((m) => m.round === round);
const isBye = (m: ListedMatch) => Boolean(m.team1) !== Boolean(m.team2);

async function seriesEnd(
  request: APIRequestContext,
  match: ListedMatch,
  winner: 'team1' | 'team2'
) {
  await sendReadyUpEvents(request, match.slug, [
    readyUpSeriesEnd({
      winner,
      team1: winner === 'team1' ? 1 : 0,
      team2: winner === 'team2' ? 1 : 0,
    }),
  ]);
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

/** A BO1 map result with round scores, so the round differential is not flat. */
async function playMap(
  request: APIRequestContext,
  match: ListedMatch,
  winner: 'team1' | 'team2',
  loserRounds: number
) {
  const [t1, t2] = winner === 'team1' ? [13, loserRounds] : [loserRounds, 13];
  await sendReadyUpEvents(request, match.slug, [
    readyUpMapResult({
      team1: t1,
      team2: t2,
      series: [winner === 'team1' ? 1 : 0, winner === 'team2' ? 1 : 0],
      winner,
    }),
  ]);
}

type StandingRow = {
  rank: number;
  teamId: string;
  wins: number;
  losses: number;
  buchholz: number;
  roundDiff: number;
};

async function finishRound(request: APIRequestContext, round: number) {
  for (const match of roundOf(await swissMatches(request), round)) {
    if (isBye(match)) continue;
    // The quoting bug failed the last series_end of a round (sendReadyUpEvents checks it went through).
    await seriesEnd(request, match, pickWinner(match));
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
        await seriesEnd(request, match, pickWinner(match));
      }

      // The same series_end five times at once (a resend racing a synthesized one).
      const last = round1[round1.length - 1];
      await Promise.all(
        Array.from({ length: 5 }, () => seriesEnd(request, last, pickWinner(last)))
      );

      const paired = await waitForPairedRound(request, 2);
      const snapshot = paired.map((m) => `${m.slug}:${m.team1?.id}:${m.team2?.id}`).sort();
      const teams = new Set(paired.flatMap((m) => [m.team1?.id, m.team2?.id]));
      expect(teams.size, 'eight distinct teams in round 2').toBe(8);

      // Retries after the fact, and bracket fetches (which also run the
      // advancement check), must not re-pair anything.
      await seriesEnd(request, last, pickWinner(last));
      await request.get('/api/tournament/bracket');
      await request.get('/api/tournament', { headers: getAuthHeader() });

      const after = await swissMatches(request);
      expect(
        roundOf(after, 2)
          .map((m) => `${m.slug}:${m.team1?.id}:${m.team2?.id}`)
          .sort()
      ).toEqual(snapshot);
      expect(
        roundOf(after, 3).every((m) => !m.team1 && !m.team2),
        'round 3 still unpaired'
      ).toBe(true);
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
          .poll(async () => roundOf(await swissMatches(request), 2).every((m) => m.vetoCompleted), {
            message: 'round 2 vetoes should complete automatically',
            timeout: 60_000,
          })
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
      expect(
        [...byes.values()].every((n) => n === 1),
        'no team gets two byes'
      ).toBe(true);
      expect(byes.size).toBe(rounds);
      expect(await waitForChampion(request), 'a champion is named').toBeTruthy();
    }
  );
  test(
    'bracket and leaderboard expose the pairing standings, ordered by Buchholz and round differential',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      const setup = await setupTournament(request, {
        type: 'swiss',
        format: 'bo1',
        maps: MAPS,
        teamCount: 8,
        serverCount: 1,
        prefix: 'swissstand',
      });
      expect(setup, 'tournament setup failed').toBeTruthy();

      // Different losing scores per match, so equal records split on the tiebreaks.
      const loserRounds = new Map<string, number>();
      let n = 0;
      for (let round = 1; round <= 3; round++) {
        for (const match of await waitForPairedRound(request, round)) {
          if (isBye(match)) continue;
          const winner = pickWinner(match);
          const lost = (n++ * 5) % 12;
          loserRounds.set(match.slug, lost);
          await playMap(request, match, winner, lost);
          await seriesEnd(request, match, winner);
        }
      }
      await waitForChampion(request);

      // Reference standings computed from the finished matches.
      const matches = await swissMatches(request);
      const { wins } = records(matches);
      const tRes = await request.get('/api/tournament', { headers: getAuthHeader() });
      const teamIds = ((await tRes.json()) as { tournament: { teamIds: string[] } }).tournament
        .teamIds;
      const expected = teamIds.map((teamId, seed) => {
        let w = 0;
        let l = 0;
        let buchholz = 0;
        let roundDiff = 0;
        for (const m of matches) {
          if (!m.team1 || !m.team2 || !m.winner) continue;
          const side = m.team1.id === teamId ? 1 : m.team2.id === teamId ? 2 : 0;
          if (!side) continue;
          const opponent = side === 1 ? m.team2.id : m.team1.id;
          const won = m.winner.id === teamId;
          if (won) w++;
          else l++;
          buchholz += wins.get(opponent) ?? 0;
          roundDiff += (won ? 1 : -1) * (13 - loserRounds.get(m.slug)!);
        }
        return { teamId, seed, wins: w, losses: l, buchholz, roundDiff };
      });
      expected.sort(
        (a, b) =>
          b.wins - a.wins ||
          a.losses - b.losses ||
          b.buchholz - a.buchholz ||
          b.roundDiff - a.roundDiff ||
          a.seed - b.seed
      );
      const strip = ({
        teamId,
        wins: w,
        losses,
        buchholz,
        roundDiff,
      }: (typeof expected)[number]) => ({
        teamId,
        wins: w,
        losses,
        buchholz,
        roundDiff,
      });

      const bracketRes = await request.get('/api/tournament/bracket', { headers: getAuthHeader() });
      expect(bracketRes.ok()).toBe(true);
      const bracket = (await bracketRes.json()) as { swissStandings?: StandingRow[] };
      expect(bracket.swissStandings, 'bracket carries swissStandings').toBeTruthy();
      expect(bracket.swissStandings!.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(
        bracket.swissStandings!.map(({ teamId, wins: w, losses, buchholz, roundDiff }) => ({
          teamId,
          wins: w,
          losses,
          buchholz,
          roundDiff,
        }))
      ).toEqual(expected.map(strip));

      // Round differential counts map rounds, not series scores.
      expect(expected.some((s) => Math.abs(s.roundDiff) > 3)).toBe(true);

      const lbRes = await request.get(
        `/api/tournament/${await currentTournamentId(request)}/leaderboard`
      );
      expect(lbRes.ok()).toBe(true);
      const lb = (await lbRes.json()) as {
        teams?: Array<{ teamId: string; matchWins: number; buchholz?: number; roundDiff?: number }>;
      };
      expect(
        lb.teams?.map((t) => t.teamId),
        'leaderboard uses the same order'
      ).toEqual(expected.map((s) => s.teamId));
      expect(lb.teams?.map((t) => [t.buchholz, t.roundDiff])).toEqual(
        expected.map((s) => [s.buchholz, s.roundDiff])
      );
    }
  );
});
