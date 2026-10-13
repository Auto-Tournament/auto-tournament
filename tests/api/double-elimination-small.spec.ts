import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { createTeam, type Team } from '../helpers/teams';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { sendReadyUpEvents, seriesEnd as readyUpSeriesEnd } from '../helpers/readyUp';

/**
 * The smallest double-elimination brackets.
 *
 * A two-team double elimination with a grand final could not be created at all:
 * the deterministic power-of-two generator demanded N = 2^k with k >= 2 and
 * threw on N = 2, and createTournament deletes the tournament again when
 * bracket generation fails. Two teams is a team count the setup UI offers, so
 * the only way through was to turn the grand final off.
 *
 * N = 2 is the degenerate case the generator's own formulas already describe:
 * the losers bracket has 2k - 2 = 0 rounds, so the loser of the single winners
 * match drops into an empty bracket and wins it unopposed. It is therefore the
 * grand final's second seed and the two teams meet twice.
 *
 * Bracket reset is deliberately not part of this: grandFinalMode 'double' is
 * generated exactly like 'simple' everywhere else in the code, so a two-team
 * bracket is 'r1m1' plus 'gf' for both modes and never a 'gf-reset'.
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
};

type TournamentBody = {
  tournament?: { status?: string; winner?: { id: string } | null };
};

async function bracketMatches(request: APIRequestContext): Promise<ListedMatch[]> {
  const res = await request.get('/api/matches', { headers: getAuthHeader() });
  expect(res.ok(), `listing matches failed: ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { matches?: ListedMatch[] };
  return (body.matches ?? [])
    .filter((m) => m.slug === 'gf' || /^(lb-)?r\d+m\d+$/.test(m.slug))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

const bySlug = (matches: ListedMatch[], slug: string) => matches.find((m) => m.slug === slug);

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

/** Wait until `slug` has both teams, and return it. */
async function waitForBothTeams(request: APIRequestContext, slug: string): Promise<ListedMatch> {
  let match: ListedMatch | undefined;
  await expect
    .poll(
      async () => {
        match = bySlug(await bracketMatches(request), slug);
        return Boolean(match?.team1 && match?.team2);
      },
      { message: `${slug} should have both teams`, timeout: 20_000 }
    )
    .toBe(true);
  return match!;
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

test.describe.serial('Small double-elimination brackets', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    // Keep the automated veto out of the way; progression is what is under test.
    await request.put('/api/settings', { data: { simulateMatches: false } });
  });

  for (const grandFinalMode of ['simple', 'double'] as const) {
    test(
      `two teams with a '${grandFinalMode}' grand final play the winners match and the grand final`,
      { tag: ['@api', '@regression'] },
      async ({ request }) => {
        const setup = await setupTournament(request, {
          type: 'double_elimination',
          format: 'bo1',
          maps: MAPS,
          teamCount: 2,
          serverCount: 1,
          prefix: `de2-${grandFinalMode}`,
          settings: { seedingMethod: 'manual', grandFinalMode },
        });
        expect(setup, 'tournament setup failed').toBeTruthy();

        const [teamA, teamB] = setup!.teams.map((t) => t.id);

        // One winners match and a grand final; no losers bracket, no reset.
        const all = await bracketMatches(request);
        expect(all.map((m) => m.slug)).toEqual(['gf', 'r1m1']);

        const opening = bySlug(all, 'r1m1')!;
        expect([opening.team1?.id, opening.team2?.id]).toEqual([teamA, teamB]);
        expect(bySlug(all, 'gf')!.team1, 'the grand final starts empty').toBeFalsy();

        // Team A wins the winners match. Team B "wins" the empty losers
        // bracket, so both of them are in the grand final.
        await seriesEnd(request, opening, 'team1');
        const grandFinal = await waitForBothTeams(request, 'gf');
        expect([grandFinal.team1?.id, grandFinal.team2?.id]).toEqual([teamA, teamB]);

        // Team B takes the grand final and the title.
        await seriesEnd(request, grandFinal, 'team2');
        expect(await waitForChampion(request)).toBe(teamB);
      }
    );
  }

  test(
    'two teams without a grand final are decided by the single winners match',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      const setup = await setupTournament(request, {
        type: 'double_elimination',
        format: 'bo1',
        maps: MAPS,
        teamCount: 2,
        serverCount: 1,
        prefix: 'de2-none',
        settings: { seedingMethod: 'manual', grandFinalMode: 'none' },
      });
      expect(setup, 'tournament setup failed').toBeTruthy();

      const [teamA] = setup!.teams.map((t) => t.id);

      const all = await bracketMatches(request);
      expect(all.map((m) => m.slug)).toEqual(['r1m1']);

      await seriesEnd(request, bySlug(all, 'r1m1')!, 'team1');
      expect(await waitForChampion(request)).toBe(teamA);
    }
  );

  test(
    'four teams still play the full winners, losers and grand final chain',
    { tag: ['@api', '@regression'] },
    async ({ request }) => {
      const setup = await setupTournament(request, {
        type: 'double_elimination',
        format: 'bo1',
        maps: MAPS,
        teamCount: 4,
        serverCount: 1,
        prefix: 'de4',
        settings: { seedingMethod: 'manual', grandFinalMode: 'simple' },
      });
      expect(setup, 'tournament setup failed').toBeTruthy();

      const [teamA, , teamC] = setup!.teams.map((t) => t.id);

      const all = await bracketMatches(request);
      expect(all.map((m) => m.slug)).toEqual(['gf', 'lb-r1m1', 'lb-r2m1', 'r1m1', 'r1m2', 'r2m1']);

      // A and C win their openers; B and D meet in the losers bracket.
      await seriesEnd(request, bySlug(all, 'r1m1')!, 'team1');
      await seriesEnd(request, bySlug(all, 'r1m2')!, 'team1');

      const winnersFinal = await waitForBothTeams(request, 'r2m1');
      expect([winnersFinal.team1?.id, winnersFinal.team2?.id]).toEqual([teamA, teamC]);
      await seriesEnd(request, winnersFinal, 'team1');

      await seriesEnd(request, await waitForBothTeams(request, 'lb-r1m1'), 'team1');
      // C dropped out of the winners final and meets the losers-bracket winner.
      const losersFinal = await waitForBothTeams(request, 'lb-r2m1');
      expect(losersFinal.team2?.id).toBe(teamC);
      await seriesEnd(request, losersFinal, 'team2');

      const grandFinal = await waitForBothTeams(request, 'gf');
      expect([grandFinal.team1?.id, grandFinal.team2?.id]).toEqual([teamA, teamC]);
      await seriesEnd(request, grandFinal, 'team1');

      expect(await waitForChampion(request)).toBe(teamA);
    }
  );

  // Three teams used to be refused (power-of-two counts only). It now gets a
  // bye (Vikunja 752): the top seed waits in round 2, and the bracket plays out.
  for (const grandFinalMode of ['simple', 'none'] as const) {
    test(
      `three teams with grand final '${grandFinalMode}': the top seed gets a bye and it finishes`,
      { tag: ['@api', '@regression'] },
      async ({ request }) => {
        const setup = await setupTournament(request, {
          type: 'double_elimination',
          format: 'bo1',
          maps: MAPS,
          teamCount: 3,
          serverCount: 1,
          prefix: `de3-${grandFinalMode}`,
          settings: { seedingMethod: 'manual', grandFinalMode },
        });
        expect(setup, 'tournament setup failed').toBeTruthy();
        const [teamA, teamB, teamC] = setup!.teams.map((t) => t.id);

        // Seats: A vs bye, B vs C. A waits for the B/C winner in the winners final.
        const all = await bracketMatches(request);
        const opener = all.find((m) => m.team1 && m.team2)!;
        expect([opener.team1?.id, opener.team2?.id]).toEqual([teamB, teamC]);
        expect(all.some((m) => m.team1?.id === teamA || m.team2?.id === teamA)).toBe(true);

        const done = new Set<string>();
        for (let i = 0; i < 20; i++) {
          const open = (await bracketMatches(request)).filter(
            (m) => m.team1 && m.team2 && m.status !== 'completed' && !done.has(m.slug)
          );
          if (open.length === 0) {
            const t = await request.get('/api/tournament', { headers: getAuthHeader() });
            if (((await t.json()) as TournamentBody).tournament?.status === 'completed') break;
            await new Promise((r) => setTimeout(r, 300));
            continue;
          }
          for (const m of open) {
            await seriesEnd(request, m, 'team1');
            done.add(m.slug);
          }
        }
        const champion = await waitForChampion(request);
        expect([teamA, teamB, teamC]).toContain(champion);
      }
    );
  }
});
