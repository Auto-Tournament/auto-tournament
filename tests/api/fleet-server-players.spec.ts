import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, resetEnrollRateLimit } from '../helpers/fleet';
import { FakeReadyUp, STEAM } from '../helpers/fleetFake';

/**
 * A Ready Up server's connected players (its last state.snapshot `players`) and
 * kicking one: cmd kick needs no match.
 *
 * @tag api
 * @tag fleet
 */
test.describe.serial('Fleet: server players and kick', () => {
  let key: { id: string; value: string };
  const fakes: FakeReadyUp[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-players-tests' });
  });

  test.afterAll(() => {
    for (const f of fakes) f.close();
  });

  test('the players route lists what the last snapshot reported', async ({ request }) => {
    const server = await FakeReadyUp.enroll(request, key.value);
    fakes.push(server);
    await server.hello({ availability: 'available' });
    const players = async (id: string) =>
      request.get(`/api/fleet/servers/${id}/players`, { headers: getAuthHeader() });
    expect(await (await players(server.serverId)).json()).toEqual({ success: true, players: [] });
    const listed = [
      { steamid64: STEAM(1), name: 'alice', team: 'ct' },
      { steamid64: STEAM(2), name: 'bob', team: 'spectator' },
    ];
    server.snapshot('none', 1, { state: null, availability: 'available', players: listed });
    await expect
      .poll(async () => (await (await players(server.serverId)).json()).players)
      .toEqual(listed);
    // A snapshot without players (a state.request answer) leaves the list as it was.
    server.snapshot('none', 1, { state: null, availability: 'available' });
    await new Promise((r) => setTimeout(r, 500));
    expect((await (await players(server.serverId)).json()).players).toEqual(listed);
    expect((await players('no-such-server')).status()).toBe(404);
  });

  test('kick sends cmd kick without an assignment; bad input and offline servers are refused', async ({
    request,
  }) => {
    const idle = await FakeReadyUp.enroll(request, key.value);
    fakes.push(idle);
    const kick = (id: string, data: Record<string, unknown>) =>
      request.post(`/api/fleet/servers/${id}/kick`, { headers: getAuthHeader(), data });
    const offline = await kick(idle.serverId, { steamid64: STEAM(9) });
    expect(offline.status()).toBe(409);
    expect((await offline.json()).errorCode).toBe('offline');
    await idle.hello({ availability: 'available' });
    const sent = kick(idle.serverId, { steamid64: STEAM(9), message: 'afk' });
    const cmd = await idle.next('cmd');
    expect(cmd.payload).toMatchObject({
      name: 'kick',
      args: { steamid64: STEAM(9), message: 'afk' },
    });
    expect(cmd.payload).not.toHaveProperty('match_id');
    idle.answer(cmd, 'ok');
    expect(await (await sent).json()).toEqual({ ok: true });
    expect((await kick(idle.serverId, { steamid64: '123' })).status()).toBe(400);
    expect((await kick(idle.serverId, { steamid64: STEAM(9), message: 'a\u0007b' })).status()).toBe(
      400
    );
    expect((await kick('no-such-server', { steamid64: STEAM(9) })).status()).toBe(404);
  });
});
