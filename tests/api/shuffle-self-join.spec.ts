import { test, expect, request as playwrightRequest } from '@playwright/test';
import { getAuthHeader, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';
import { createShuffleTournament } from '../helpers/shuffleTournament';

/**
 * A shuffle tournament takes players on their own (tournamentSignupService.joinShuffle):
 * join and leave while sign-up is open, the list is public, nothing once it is closed.
 */

const TAGS = { tag: ['@api', '@shuffle'] };
const BASE_URL = process.env.BASE_URL || 'http://localhost:3069';

test('a player joins and leaves a shuffle tournament without a team', TAGS, async ({ request }) => {
  // Creating a shuffle takes an admin session, not a token.
  expect(await signInViaRequest(request)).toBe(true);
  const tournament = await createShuffleTournament(request, {
    name: `Self Join ${Date.now()}`,
    maxRounds: 6,
  });
  expect(tournament).not.toBeNull();
  const id = tournament!.id;
  const scope = { ...getAuthHeader(), 'X-Tournament-Id': String(id) };

  const player = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const steamId = `7656119${String(Date.now()).slice(-10)}`;
  expect(await signInAsPlayerViaRequest(player, steamId, 'Solo Joiner')).toBe(true);

  // Sign-up not open yet: refused.
  expect((await player.post(`/api/tournament-signup/${id}/join`, { data: {} })).status()).toBe(409);

  const opened = await request.put('/api/tournament', {
    headers: scope,
    data: { settings: { registrationOpen: true } },
  });
  expect(opened.ok(), await opened.text()).toBe(true);

  const joined = await player.post(`/api/tournament-signup/${id}/join`, { data: {} });
  expect(joined.status(), await joined.text()).toBe(200);
  // Twice is fine.
  expect((await player.post(`/api/tournament-signup/${id}/join`, { data: {} })).status()).toBe(200);

  const listed = await (await request.get(`/api/tournament-signup/${id}`)).json();
  const players = listed.players as Array<{ steamId: string; name: string }>;
  expect(players.filter((p) => p.steamId === steamId)).toHaveLength(1);
  expect(players.find((p) => p.steamId === steamId)?.name).toBe('Solo Joiner');

  const left = await player.delete(`/api/tournament-signup/${id}/join`);
  expect(left.status()).toBe(200);
  const after = await (await request.get(`/api/tournament-signup/${id}`)).json();
  expect((after.players as Array<{ steamId: string }>).some((p) => p.steamId === steamId)).toBe(
    false
  );

  // Not signed in: no joining.
  const visitor = await playwrightRequest.newContext({ baseURL: BASE_URL });
  expect((await visitor.post(`/api/tournament-signup/${id}/join`, { data: {} })).status()).toBe(
    401
  );
  await visitor.dispose();
  await player.dispose();
});
