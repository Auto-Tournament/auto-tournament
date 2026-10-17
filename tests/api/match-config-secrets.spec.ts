import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { liveGotv, withoutConfigSecrets } from '../../api/src/utils/matchConfigSecrets';

/**
 * The match's GOTV password (`config.cvars.tv_password`, cs2 gotv.ts) in the
 * public match list and match endpoints. GOTV is public: anyone may watch with
 * a delay, so with a delay the password is shown to everyone. With no delay
 * (`tv_delay` 0) a viewer could ghost for a team, so only admins get it (and
 * the config a server loads).
 *
 * @tag api
 * @tag regression
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const DELAYED = 'gotv-secret-delayed';
const LIVE = 'gotv-secret-live';
const SECRET = 'tvsecret123';

type Cvars = Record<string, unknown> | undefined;

async function cvarsOf(
  request: APIRequestContext,
  slug: string
): Promise<{ list: Cvars; one: Cvars }> {
  const list = await request.get('/api/matches');
  expect(list.ok()).toBe(true);
  const listed = (
    (await list.json()) as {
      matches: Array<{ slug: string; config?: { cvars?: Record<string, unknown> } }>;
    }
  ).matches.find((m) => m.slug === slug);
  expect(listed).toBeTruthy();
  const one = await request.get(`/api/matches/${slug}`);
  expect(one.ok()).toBe(true);
  const body = (await one.json()) as { match: { config?: { cvars?: Record<string, unknown> } } };
  return { list: listed?.config?.cvars, one: body.match.config?.cvars };
}

async function createMatch(request: APIRequestContext, slug: string, tvDelay: number) {
  await request.delete(`/api/matches/${slug}`);
  const res = await request.post('/api/matches', {
    data: {
      slug,
      config: {
        vetoDisabled: true,
        maplist: ['de_mirage'],
        num_maps: 1,
        players_per_team: 1,
        map_sides: ['team1_ct'],
        team1: { name: `${slug} A`, players: [{ steamid: '76561198000099001', name: 'a' }] },
        team2: { name: `${slug} B`, players: [{ steamid: '76561198000099002', name: 'b' }] },
        cvars: { mp_maxrounds: 24, tv_delay: tvDelay, tv_password: SECRET },
      },
    },
  });
  expect(res.ok()).toBe(true);
}

test('the password goes only when GOTV has no delay', () => {
  const cfg = (tv_delay?: unknown) => ({
    cvars: { tv_password: SECRET, ...(tv_delay === undefined ? {} : { tv_delay }) },
  });
  expect(withoutConfigSecrets(cfg(105)).cvars.tv_password).toBe(SECRET);
  expect(withoutConfigSecrets(cfg()).cvars.tv_password).toBe(SECRET);
  expect(withoutConfigSecrets(cfg(0)).cvars).toEqual({ tv_delay: 0 });
  expect(liveGotv({ tv_delay: '0' })).toBe(true);
});

test.describe.serial('GOTV password in match responses', () => {
  test.beforeAll(async ({ request }) => {
    await signInViaRequest(request);
    await createMatch(request, DELAYED, 105);
    await createMatch(request, LIVE, 0);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete(`/api/matches/${DELAYED}`);
    await request.delete(`/api/matches/${LIVE}`);
  });

  test('an admin sees it, delay or not', { tag: ['@api'] }, async ({ request }) => {
    await signInViaRequest(request);
    for (const slug of [DELAYED, LIVE]) {
      const { list, one } = await cvarsOf(request, slug);
      expect(list?.tv_password).toBe(SECRET);
      expect(one?.tv_password).toBe(SECRET);
    }
  });

  test(
    'nobody signed in and a player: with a delay yes, with no delay no',
    { tag: ['@api', '@regression'] },
    async ({ playwright }) => {
      const anon = await playwright.request.newContext({ baseURL: BASE_URL });
      const player = await playwright.request.newContext({ baseURL: BASE_URL });
      try {
        expect(await signInAsPlayerViaRequest(player)).toBe(true);
        for (const ctx of [anon, player]) {
          const delayed = await cvarsOf(ctx, DELAYED);
          const live = await cvarsOf(ctx, LIVE);
          for (const cvars of [delayed.list, delayed.one]) {
            expect(cvars?.tv_password).toBe(SECRET);
          }
          for (const cvars of [live.list, live.one]) {
            expect(cvars?.tv_password).toBeUndefined();
            expect(cvars?.tv_delay).toBe(0);
          }
        }
      } finally {
        await anon.dispose();
        await player.dispose();
      }
    }
  );
});
