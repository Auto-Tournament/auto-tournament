import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { currentSlug } from '../helpers/slugs';
import { sendReadyUpEvents, seriesEnd as readyUpSeriesEnd } from '../helpers/readyUp';

/**
 * The break between a team's matches (CS2 Match rules): when the final gets
 * both semi winners, its veto does not open at once. The match is held until
 * the later semi ended plus the break; the veto says when it opens and
 * refuses bans until then; released, it opens with the longer first turn.
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
  status: string;
  team1?: { id: string } | null;
  team2?: { id: string } | null;
};

async function bracketMatch(
  request: APIRequestContext,
  slug: string
): Promise<ListedMatch | undefined> {
  const wanted = await currentSlug(request, slug);
  const res = await request.get('/api/matches', { headers: getAuthHeader() });
  const body = (await res.json()) as { matches?: ListedMatch[] };
  return (body.matches ?? []).find((m) => m.slug === wanted);
}

test.describe.serial('Break between matches', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.put('/api/settings', {
      data: {
        simulateMatches: false,
        vetoTurnSeconds: 45,
        vetoFirstTurnSeconds: 120,
        matchBreakMinutes: 3,
      },
    });
  });

  test.afterEach(async ({ request }) => {
    await request.put('/api/settings', {
      data: { matchBreakMinutes: 0, vetoFirstTurnSeconds: 0, vetoTurnSeconds: 0 },
    });
  });

  test(
    'the next match waits for the break, then its veto opens with a longer first turn',
    { tag: ['@api', '@veto', '@regression'] },
    async ({ request }) => {
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamCount: 4,
        serverCount: 1,
        prefix: 'brk',
        settings: { seedingMethod: 'manual' },
      });
      expect(setup, 'tournament setup failed').toBeTruthy();
      for (const semi of ['r1m1', 'r1m2']) {
        await sendReadyUpEvents(request, await currentSlug(request, semi), [
          readyUpSeriesEnd({ winner: 'team1', team1: 1, team2: 0 }),
        ]);
      }

      let final: ListedMatch | undefined;
      await expect
        .poll(
          async () => {
            final = await bracketMatch(request, 'r2m1');
            return Boolean(final?.team1 && final?.team2);
          },
          { timeout: 20_000 }
        )
        .toBe(true);
      const slug = final!.slug;

      // Held for the break: the veto says when it opens and takes no bans yet.
      const before = (await (await request.get(`/api/veto/${slug}`)).json()) as {
        veto: { opensAt?: string; turnDeadline?: string };
      };
      expect(before.veto.opensAt, 'the veto opens after the break').toBeTruthy();
      const opensIn = Date.parse(before.veto.opensAt!) - Date.now();
      expect(opensIn).toBeGreaterThan(2 * 60_000);
      expect(opensIn).toBeLessThanOrEqual(3 * 60_000 + 5_000);
      expect(before.veto.turnDeadline).toBeUndefined();
      const early = await request.post(`/api/veto/${slug}/action`, {
        data: { mapName: MAPS[0], actAs: 'team1' },
      });
      expect(early.status()).toBe(409);
      expect((await early.json()).opensAt).toBeTruthy();

      // The break over (an admin lets it go now): the veto opens, first turn 120 s.
      expect(
        (await request.delete(`/api/matches/${slug}/hold`, { headers: getAuthHeader() })).ok()
      ).toBe(true);
      const after = (await (await request.get(`/api/veto/${slug}`)).json()) as {
        veto: { opensAt?: string; turnSeconds?: number };
      };
      expect(after.veto.opensAt).toBeUndefined();
      expect(after.veto.turnSeconds).toBe(120);
    }
  );
});
