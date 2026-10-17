import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * The match's GOTV password (`config.cvars.tv_password`, cs2 gotv.ts) is only
 * for admins and for viewers allowed to watch (GET /api/events/watch/:slug).
 * The public match list and match endpoints used to hand it to everyone, so
 * anyone could join GOTV with no delay check. Non-admins now get the config
 * without it; admins (and the config route a server loads) keep it.
 *
 * @tag api
 * @tag regression
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const SLUG = 'gotv-secret-check';
const SECRET = 'tvsecret123';

type Cvars = Record<string, unknown> | undefined;

async function cvarsOf(request: APIRequestContext): Promise<{ list: Cvars; one: Cvars }> {
  const list = await request.get('/api/matches');
  expect(list.ok()).toBe(true);
  const listed = (
    (await list.json()) as {
      matches: Array<{ slug: string; config?: { cvars?: Record<string, unknown> } }>;
    }
  ).matches.find((m) => m.slug === SLUG);
  expect(listed).toBeTruthy();
  const one = await request.get(`/api/matches/${SLUG}`);
  expect(one.ok()).toBe(true);
  const body = (await one.json()) as { match: { config?: { cvars?: Record<string, unknown> } } };
  return { list: listed?.config?.cvars, one: body.match.config?.cvars };
}

test.describe.serial('GOTV password in match responses', () => {
  test.beforeAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete(`/api/matches/${SLUG}`);
    const res = await request.post('/api/matches', {
      data: {
        slug: SLUG,
        config: {
          vetoDisabled: true,
          maplist: ['de_mirage'],
          num_maps: 1,
          players_per_team: 1,
          map_sides: ['team1_ct'],
          team1: { name: 'Secret Alpha', players: [{ steamid: '76561198000099001', name: 'a' }] },
          team2: { name: 'Secret Bravo', players: [{ steamid: '76561198000099002', name: 'b' }] },
          cvars: { mp_maxrounds: 24, tv_delay: 105, tv_password: SECRET },
        },
      },
    });
    expect(res.ok()).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete(`/api/matches/${SLUG}`);
  });

  test('an admin still sees it', { tag: ['@api'] }, async ({ request }) => {
    await signInViaRequest(request);
    const { list, one } = await cvarsOf(request);
    expect(list?.tv_password).toBe(SECRET);
    expect(one?.tv_password).toBe(SECRET);
  });

  test(
    'nobody signed in and a player do not, the other cvars stay',
    { tag: ['@api', '@regression'] },
    async ({ playwright }) => {
      const anon = await playwright.request.newContext({ baseURL: BASE_URL });
      const player = await playwright.request.newContext({ baseURL: BASE_URL });
      try {
        expect(await signInAsPlayerViaRequest(player)).toBe(true);
        for (const ctx of [anon, player]) {
          const { list, one } = await cvarsOf(ctx);
          for (const cvars of [list, one]) {
            expect(cvars?.tv_password).toBeUndefined();
            expect(cvars?.tv_delay).toBe(105);
          }
        }
      } finally {
        await anon.dispose();
        await player.dispose();
      }
    }
  );
});
