import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { sendReadyUpEvents, seriesEnd as readyUpSeriesEnd } from '../helpers/readyUp';

/**
 * A later round of a BO1 bracket opens its own veto and waits for it.
 *
 * 2026-10-12 bracket test: with simulation off, the final went straight to
 * `ready` once both semis ended, with no veto. The veto timer and the
 * players' page only open a veto for a `pending` match, and allocation
 * failed on "no maps yet", so the final sat there until an admin set it
 * back to `pending` by hand. Now the final stays `pending` until its veto is
 * done, the veto timer picks it up, and the veto finishing readies it.
 *
 * Driven through series_end events (no game server needed for the semis).
 *
 * @tag api
 * @tag veto
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
  const res = await request.get('/api/matches', { headers: getAuthHeader() });
  expect(res.ok(), `listing matches failed: ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { matches?: ListedMatch[] };
  return (body.matches ?? []).find((m) => m.slug === slug);
}

async function seriesEnd(request: APIRequestContext, slug: string) {
  await sendReadyUpEvents(request, slug, [
    readyUpSeriesEnd({ winner: 'team1', team1: 1, team2: 0 }),
  ]);
}

test.describe.serial('Next-round veto', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    // Simulation off (the state that got stuck); a 1 s turn so the veto timer
    // plays the final's veto for both teams (veto/timer.ts), as it did for the
    // bot teams in the live test.
    await request.put('/api/settings', { data: { simulateMatches: false, vetoTurnSeconds: 1 } });
  });

  test.afterEach(async ({ request }) => {
    await request.put('/api/settings', { data: { vetoTurnSeconds: 0 } });
  });

  test(
    'the final opens its own veto after the semis and is readied by it',
    { tag: ['@api', '@veto', '@regression'] },
    async ({ request }) => {
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        maps: MAPS,
        teamCount: 4,
        serverCount: 1,
        prefix: 'nrv',
        settings: { seedingMethod: 'manual' },
      });
      expect(setup, 'tournament setup failed').toBeTruthy();

      await seriesEnd(request, 'r1m1');
      await seriesEnd(request, 'r1m2');

      let final: ListedMatch | undefined;
      await expect
        .poll(
          async () => {
            final = await bracketMatch(request, 'r2m1');
            return Boolean(final?.team1 && final?.team2);
          },
          { message: 'the final should get both semi winners', timeout: 20_000 }
        )
        .toBe(true);

      // Both teams known, veto not done: the match waits for its veto.
      expect(final!.status, 'the final must wait for its veto').toBe('pending');

      // The veto timer picks the final up and takes each turn.
      await expect
        .poll(async () => (await bracketMatch(request, 'r2m1'))?.status, {
          message: 'the veto timer finishes the veto and that readies the final',
          timeout: 45_000,
        })
        .toMatch(/^(ready|loaded|live)$/);
    }
  );
});
