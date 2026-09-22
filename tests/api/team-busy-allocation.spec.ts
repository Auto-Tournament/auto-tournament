import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { withoutBusyTeams, type QueueEntry } from '../../api/src/core/allocationQueue';

/**
 * A team plays one match at a time (#224).
 *
 * QA, MAT 2.4.12 (round robin, 4 teams, Bo1, 3 servers): Bravo was live in
 * r1m2 and r2m1 at the same time, Delta in r1m1 and r2m1. Round robin creates
 * every match up front with both teams set, so after the vetoes every match is
 * 'ready' and the allocator handed servers out by queue order alone, never
 * checking whether a team was already playing.
 *
 * A match is not ready for a server while either team is in a loaded or live
 * match (or one that already has a server and is loading). Within one
 * allocation pass the earliest match in queue order claims its teams, so a
 * later match with the same team waits for it.
 *
 * @tag api
 * @tag allocation
 */

const entry = (slug: string, round: number, matchNumber: number, team1Id: string, team2Id: string) => ({
  id: round * 10 + matchNumber,
  slug,
  round,
  matchNumber,
  team1Id,
  team2Id,
});

// Round robin, 4 teams: every pair once.
const roundRobin4: Array<QueueEntry & { team1Id: string; team2Id: string }> = [
  entry('r1m1', 1, 1, 'delta', 'alpha'),
  entry('r1m2', 1, 2, 'bravo', 'charlie'),
  entry('r2m1', 2, 1, 'delta', 'bravo'),
  entry('r2m2', 2, 2, 'alpha', 'charlie'),
  entry('r3m1', 3, 1, 'delta', 'charlie'),
  entry('r3m2', 3, 2, 'alpha', 'bravo'),
];

test.describe('Team busy rule', () => {
  test('nothing busy: round 1 goes first, round 2 waits for the teams it shares', () => {
    expect(withoutBusyTeams(roundRobin4, new Set()).map((e) => e.slug)).toEqual(['r1m1', 'r1m2']);
  });

  test('a team in a live match keeps its next match out of the queue', () => {
    // The QA run: r1m1 done, r1m2 (Bravo, Charlie) still live. Every later
    // match has Bravo or Charlie, or its other team is claimed by an earlier one.
    const queue = roundRobin4.filter((e) => e.slug !== 'r1m1' && e.slug !== 'r1m2');
    expect(withoutBusyTeams(queue, new Set(['bravo', 'charlie'])).map((e) => e.slug)).toEqual([]);
    expect(withoutBusyTeams(queue, new Set(['delta', 'alpha'])).map((e) => e.slug)).toEqual([]);
    // Round 1 fully done: both round 2 matches, round 3 waits for them.
    expect(withoutBusyTeams(queue, new Set()).map((e) => e.slug)).toEqual(['r2m1', 'r2m2']);
  });

  test('order of the matches that may start is unchanged', () => {
    const eight = [
      entry('r1m1', 1, 1, 'a', 'b'),
      entry('r1m2', 1, 2, 'c', 'd'),
      entry('r1m3', 1, 3, 'e', 'f'),
      entry('r1m4', 1, 4, 'g', 'h'),
    ];
    expect(withoutBusyTeams(eight, new Set(['c'])).map((e) => e.slug)).toEqual(['r1m1', 'r1m3', 'r1m4']);
  });

  test('matches with an empty slot are left alone (they cannot clash)', () => {
    const withTbd = [{ id: 1, slug: 'r2m1', round: 2, matchNumber: 1, team1Id: 'a', team2Id: null }];
    expect(withoutBusyTeams(withTbd, new Set()).map((e) => e.slug)).toEqual(['r2m1']);
  });
});

type ListedMatch = { slug: string; round: number; team1?: { id: string } | null; team2?: { id: string } | null };

async function setMatchState(request: APIRequestContext, data: Record<string, unknown>) {
  const res = await request.post('/api/test/match-state', { headers: getAuthHeader(), data });
  expect(res.ok(), `match-state ${JSON.stringify(data)}: ${await res.text()}`).toBe(true);
}

test.describe.serial('Round robin never double-books a team', () => {
  test(
    'with one match live, only the match between the two other teams waits for a server',
    { tag: ['@api', '@allocation', '@regression'] },
    async ({ request }) => {
      await signInViaRequest(request);
      await request.put('/api/settings', { data: { simulateMatches: false } });

      const setup = await setupTournament(request, {
        type: 'round_robin',
        format: 'bo1',
        teamCount: 4,
        serverCount: 1,
        prefix: 'rrbusy',
      });
      expect(setup, 'tournament setup failed').toBeTruthy();

      const res = await request.get('/api/matches', { headers: getAuthHeader() });
      expect(res.ok()).toBe(true);
      const matches = ((await res.json()) as { matches: ListedMatch[] }).matches.filter((m) =>
        /^r\d+m\d+$/.test(m.slug)
      );
      expect(matches, '4-team round robin has 6 matches').toHaveLength(6);

      // Vetoes done everywhere (every match 'ready'), then r1m1 goes live.
      for (const m of matches) await setMatchState(request, { slug: m.slug, status: 'ready' });
      const live = matches.find((m) => m.slug === 'r1m1')!;
      await setMatchState(request, {
        slug: live.slug,
        status: 'live',
        serverId: setup!.servers[0].id,
        loadedAt: Math.floor(Date.now() / 1000),
      });

      const busy = new Set([live.team1!.id, live.team2!.id]);
      const free = matches.filter((m) => !busy.has(m.team1!.id) && !busy.has(m.team2!.id));
      expect(free.map((m) => m.slug), 'only one match has neither live team').toHaveLength(1);

      const availability = await request.get('/api/tournament/server-availability', {
        headers: getAuthHeader(),
      });
      expect(availability.ok()).toBe(true);
      const body = (await availability.json()) as { requiredServerCount: number };
      expect(
        body.requiredServerCount,
        'matches whose team is live in r1m1 must not wait for (and get) a server'
      ).toBe(1);
    }
  );
});
