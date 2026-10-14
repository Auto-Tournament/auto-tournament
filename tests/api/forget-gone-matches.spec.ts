import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';

/**
 * Slugs come back: a reset regenerates t<id>-r1m1, and a deleted
 * tournament's id goes to the next one. Clips kept under a gone match's slug
 * must not show up as the new match's (a test bracket showed a player's
 * highlights on a bots-only match).
 *
 * @tag api
 * @tag regression
 */

/** Seeds `ticks` as finished clips on map 0 (none for []), answers the clips there. */
async function clips(request: APIRequestContext, slug: string, ticks: number[]) {
  const res = await request.post('/api/test/highlights/repick', {
    headers: getAuthHeader(),
    data: {
      matchSlug: slug,
      mapNumber: 0,
      clips: ticks.map((startTick) => ({
        playerId: '76561198000000001',
        round: 3,
        startTick,
        status: 'done',
        demoPath: null,
      })),
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return Object.keys((await res.json()).statuses as Record<string, string>);
}

test.describe.serial('Gone matches leave nothing under their slug', () => {
  for (const how of ['reset', 'delete'] as const) {
    test(
      `after a ${how}, the new match under the slug has no old clips`,
      { tag: ['@api', '@regression'] },
      async ({ request }) => {
        test.setTimeout(90_000);
        expect(await signInViaRequest(request)).toBe(true);
        const headers = getAuthHeader();
        const first = await setupTournament(request, {
          teamCount: 2,
          serverCount: 1,
          prefix: `forget-${how}`,
        });
        expect(first).toBeTruthy();
        const old = await findMatchByTeams(request, first!.teams[0].id, first!.teams[1].id);
        const slug = old!.slug;
        expect(await clips(request, slug, [1000, 2000])).toEqual(['1000', '2000']);

        if (how === 'reset') {
          expect((await request.post('/api/tournament/reset', { headers })).ok()).toBe(true);
          expect((await request.post('/api/tournament/start', { headers })).ok()).toBe(true);
          const fresh = await findMatchByTeams(request, first!.teams[0].id, first!.teams[1].id);
          expect(fresh!.slug).toBe(slug);
        } else {
          expect((await request.delete('/api/tournament', { headers })).ok()).toBe(true);
          const second = await setupTournament(request, {
            teamCount: 2,
            serverCount: 1,
            prefix: 'forget-next',
          });
          expect(second).toBeTruthy();
          const fresh = await findMatchByTeams(request, second!.teams[0].id, second!.teams[1].id);
          expect(fresh!.slug).toBe(slug);
        }

        expect(await clips(request, slug, [])).toEqual([]);
      }
    );
  }
});
