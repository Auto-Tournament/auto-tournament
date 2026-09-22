import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { createTestServer, deleteServer } from '../helpers/servers';

/**
 * Adding a backup player or spectator to a live match.
 *
 * The admin tools have always POSTed to /api/rcon/:serverId/add-player. The
 * route did not exist, so every attempt 404'd and the UI reported "failed to
 * add player to match" — the reported bug, and not only for spectators.
 *
 * MatchZy reports refusals (no match set up, halftime, already on a team, bad
 * Steam ID) in the *reply text* while the RCON call itself succeeds, so the
 * route has to read the reply. A fake test server answers "fake_response",
 * which is exactly an unconfirmed add — so the refusal path is what CI can
 * check. The happy path needs a real CS2 server.
 *
 * @tag api
 * @tag rcon
 * @tag regression
 */

const VALID_STEAM_ID = '76561198000000042';

async function addPlayer(
  request: APIRequestContext,
  serverId: string,
  body: Record<string, unknown>
) {
  return request.post(`/api/rcon/${serverId}/add-player`, { data: body });
}

test.describe.serial('Add player to match', () => {
  let serverId: string;

  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    const server = await createTestServer(request, 'addplayer');
    expect(server).toBeTruthy();
    serverId = server!.id;
  });

  test.afterEach(async ({ request }) => {
    if (serverId) await deleteServer(request, serverId);
  });

  test(
    'the endpoint exists at all',
    { tag: ['@api', '@rcon', '@regression'] },
    async ({ request }) => {
      const res = await addPlayer(request, serverId, {
        steamId: VALID_STEAM_ID,
        team: 'spec',
        nickname: 'Caster',
      });

      // The whole bug: this used to be 404, which the UI showed as
      // "failed to add player to match".
      expect(res.status(), 'route must be mounted').not.toBe(404);
    }
  );

  test(
    'does not claim success when the server never confirmed',
    { tag: ['@api', '@rcon', '@regression'] },
    async ({ request }) => {
      const res = await addPlayer(request, serverId, {
        steamId: VALID_STEAM_ID,
        team: 'spec',
        nickname: 'Caster',
      });

      // A fake server answers without MatchZy's "successfully" confirmation.
      // Reporting success off `result.success` alone would tell an admin the
      // spectator was added when nothing happened.
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { success: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error, 'should pass on what the server actually said').toBeTruthy();
    }
  );

  test(
    'rejects a malformed Steam ID and an unknown team',
    { tag: ['@api', '@rcon'] },
    async ({ request }) => {
      const badId = await addPlayer(request, serverId, { steamId: 'not-a-steamid', team: 'spec' });
      expect(badId.status()).toBe(400);
      expect(((await badId.json()) as { error: string }).error).toMatch(/17-digit/i);

      const badTeam = await addPlayer(request, serverId, {
        steamId: VALID_STEAM_ID,
        team: 'team3',
      });
      expect(badTeam.status()).toBe(400);
      expect(((await badTeam.json()) as { error: string }).error).toMatch(/team1, team2, spec/);

      const missing = await addPlayer(request, serverId, { team: 'spec' });
      expect(missing.status()).toBe(400);
    }
  );
});
