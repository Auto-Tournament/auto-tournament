import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTournament } from '../helpers/tournamentSetup';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { executeVetoActions, getCSMajorBO1Actions } from '../helpers/veto';
import type { Team } from '../helpers/teams';

/**
 * A later round of a BO1 bracket opens its own veto and waits for it.
 *
 * 2026-10-12 bracket test: with simulation off, the final went straight to
 * `ready` once both semis ended, with no veto. The veto timer and the
 * players' page only open a veto for a `pending` match, and allocation
 * failed on "no maps yet", so the final sat there until an admin set it
 * back to `pending` by hand. Now the final stays `pending` until its veto is
 * done, and the veto finishing readies it.
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

const SERVER_HEADERS = {
  'Content-Type': 'application/json',
  'X-Auto-Tournament-Token': process.env.SERVER_TOKEN ?? 'server123',
};

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
  const res = await request.post(`/api/events/${slug}`, {
    headers: SERVER_HEADERS,
    data: {
      event: 'series_end',
      matchid: slug,
      team1_series_score: 1,
      team2_series_score: 0,
      winner: { side: '3', team: 'team1' },
      time_until_restore: 0,
    },
  });
  expect(res.status(), `series_end for ${slug}: ${await res.text()}`).toBe(200);
}

test.describe.serial('Next-round veto', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.put('/api/settings', { data: { simulateMatches: false } });
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
      const teams = new Map<string, Team>(setup!.teams.map((t) => [t.id, t]));

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

      const team1 = teams.get(final!.team1!.id)!;
      const team2 = teams.get(final!.team2!.id)!;
      const done = await executeVetoActions(request, 'r2m1', getCSMajorBO1Actions(team1, team2));
      expect(done, 'the final veto should go through').toBeTruthy();

      await expect
        .poll(async () => (await bracketMatch(request, 'r2m1'))?.status, {
          message: 'the finished veto readies the final',
          timeout: 20_000,
        })
        .toMatch(/^(ready|loaded|live)$/);
    }
  );
});
