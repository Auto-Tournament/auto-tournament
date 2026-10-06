import { test, expect, request as playwrightRequest } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * A finished standalone match (no tournament) shows in its players' recent
 * matches. Its config names players the MatchZy way, `{ "<steamid>": "<name>" }`,
 * which the CS2 roster reader used to choke on, so no stats were written
 * (NTLAN test 2026-10-05, Vikunja 1831).
 *
 * @tag api
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

test('a finished standalone match is in both players\' recent matches', { tag: ['@api'] }, async ({ request }) => {
  expect(await signInViaRequest(request)).toBe(true);
  const a = `7656119${digits(10)}`;
  const b = `7656119${digits(10)}`;
  for (const [id, name] of [
    [a, 'Solo A'],
    [b, 'Solo B'],
  ]) {
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect(await signInAsPlayerViaRequest(ctx, id, name)).toBe(true);
    await ctx.dispose();
  }

  const slug = `solo-${digits(6)}`;
  const created = await request.post('/api/matches', {
    headers: getAuthHeader(),
    data: {
      slug,
      config: {
        num_maps: 1,
        maplist: ['de_dust2'],
        players_per_team: 1,
        team1: { name: 'Solo A', players: { [a]: 'Solo A' } },
        team2: { name: 'Solo B', players: { [b]: 'Solo B' } },
      },
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  expect((await request.post('/api/test/match-state', { headers: getAuthHeader(), data: { slug, status: 'live' } })).ok()).toBe(true);
  const ended = await request.post('/api/test/series-result', {
    headers: getAuthHeader(),
    data: { slug, result: { team1Score: 1, team2Score: 0, winner: 'team1', games: [] } },
  });
  expect(ended.ok(), await ended.text()).toBe(true);

  for (const [id, won] of [
    [a, true],
    [b, false],
  ] as const) {
    const summary = await (await request.get(`/api/players/${id}/summary`)).json();
    const row = (summary.matches as Array<{ slug: string; won_match: boolean }>).find((m) => m.slug === slug);
    expect(row, `${id} should have ${slug} in recent matches`).toBeTruthy();
    expect(Boolean(row!.won_match)).toBe(won);
  }

  await request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() });
});
