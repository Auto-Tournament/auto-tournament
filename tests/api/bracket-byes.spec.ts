import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { padWithByes, resolveByes, type ByeMatch } from '../../api/src/services/bracketByes';
import { sendReadyUpEvents, seriesEnd as readyUpSeriesEnd } from '../helpers/readyUp';

/**
 * Brackets for a team count that is not a power of two (Vikunja 752): byes.
 *
 * Pure: the seats and the bye resolution for 3 to 15 teams. API: six teams in
 * single and double elimination: the bracket is generated, the
 * byes never become playable matches, and playing every match that has both
 * teams (team1 always wins) ends with a champion. Driven by series_end only.
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
  slug: string;
  round: number;
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

async function bracketMatches(request: APIRequestContext): Promise<ListedMatch[]> {
  const res = await request.get('/api/matches', { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBe(true);
  const body = (await res.json()) as { matches?: ListedMatch[] };
  return (body.matches ?? []).filter((m) => m.round > 0);
}

async function seriesEnd(request: APIRequestContext, slug: string) {
  await sendReadyUpEvents(request, slug, [
    readyUpSeriesEnd({ winner: 'team1', team1: 1, team2: 0 }),
  ]);
}

async function tournamentStatus(request: APIRequestContext) {
  const res = await request.get('/api/tournament', { headers: getAuthHeader() });
  const body = (await res.json()) as {
    tournament?: { status?: string; winner?: { id: string } | null };
  };
  return body.tournament;
}

/** Play every match with both teams until the tournament completes. */
async function playOut(request: APIRequestContext): Promise<string[]> {
  const played: string[] = [];
  for (let pass = 0; pass < 40; pass++) {
    const t = await tournamentStatus(request);
    if (t?.status === 'completed') return played;
    const open = (await bracketMatches(request)).filter(
      (m) => m.team1 && m.team2 && m.status !== 'completed' && !played.includes(m.slug)
    );
    if (open.length === 0) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    for (const m of open) {
      await seriesEnd(request, m.slug);
      played.push(m.slug);
    }
  }
  throw new Error(`the tournament never completed; played ${played.join(', ')}`);
}

/** A 2^k single-elimination bracket the way the generator wires it. */
function singleElimination(seats: Array<string | null>): ByeMatch[] {
  const out: ByeMatch[] = [];
  const k = Math.log2(seats.length);
  for (let r = 1; r <= k; r++) {
    const n = seats.length / 2 ** r;
    for (let m = 1; m <= n; m++) {
      out.push({
        slug: `r${r}m${m}`,
        round: r,
        team1Id: r === 1 ? seats[2 * (m - 1)] : null,
        team2Id: r === 1 ? seats[2 * (m - 1) + 1] : null,
        team1FromMatchSlug: r === 1 ? null : `r${r - 1}m${2 * m - 1}`,
        team1FromOutcome: r === 1 ? null : 'winner',
        team2FromMatchSlug: r === 1 ? null : `r${r - 1}m${2 * m}`,
        team2FromOutcome: r === 1 ? null : 'winner',
      });
    }
  }
  return out;
}

test.describe('Byes (pure)', () => {
  for (let n = 3; n <= 15; n++) {
    test(`${n} teams: every team seated once, a bye never meets a bye, ${n - 1} matches left`, () => {
      const teams = Array.from({ length: n }, (_, i) => `t${i + 1}`);
      const seats = padWithByes(teams);
      expect(seats.filter(Boolean).sort()).toEqual([...teams].sort());
      for (let p = 0; p < seats.length; p += 2) expect(seats[p] || seats[p + 1]).toBeTruthy();
      const kept = resolveByes(singleElimination(seats));
      expect(kept).toHaveLength(n - 1);
      const slugs = new Set(kept.map((m) => m.slug));
      for (const m of kept) {
        // Every slot is a seated team or a match that is still in the bracket.
        for (const [team, from] of [
          [m.team1Id, m.team1FromMatchSlug],
          [m.team2Id, m.team2FromMatchSlug],
        ] as const) {
          expect(Boolean(team) !== Boolean(from), `${m.slug}`).toBe(true);
          if (from) expect(slugs.has(from), `${m.slug} <- ${from}`).toBe(true);
        }
      }
      // Each team is seated exactly once.
      const seated = kept.flatMap((m) => [m.team1Id, m.team2Id]).filter(Boolean);
      expect(seated.sort()).toEqual([...teams].sort());
    });
  }
});

test.describe.serial('Brackets with byes (team counts that are not a power of two)', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.put('/api/settings', { data: { simulateMatches: false } });
  });

  for (const [type, grandFinalMode] of [
    ['single_elimination', undefined],
    ['double_elimination', 'simple'],
    ['double_elimination', 'none'],
  ] as const) {
    test(
      `six teams, ${type.replace('_', ' ')}${grandFinalMode ? `, grand final ${grandFinalMode}` : ''}: byes advance and it finishes`,
      { tag: ['@api', '@regression'] },
      async ({ request }) => {
        const setup = await setupTournament(request, {
          type,
          format: 'bo1',
          maps: MAPS,
          teamCount: 6,
          serverCount: 1,
          prefix: `bye6-${type}-${grandFinalMode ?? 'se'}`,
          settings: {
            seedingMethod: 'manual',
            ...(grandFinalMode ? { grandFinalMode } : {}),
          },
        });
        expect(setup, 'tournament setup failed').toBeTruthy();
        const teams = new Set(setup!.teams.map((t) => t.id));

        const played = await playOut(request);
        // Single elimination: 6 teams = 5 matches played; byes are never played.
        if (type === 'single_elimination') expect(played).toHaveLength(5);
        const t = await tournamentStatus(request);
        expect(t?.status).toBe('completed');
        expect(teams.has(t?.winner?.id ?? '')).toBe(true);
      }
    );
  }
});
