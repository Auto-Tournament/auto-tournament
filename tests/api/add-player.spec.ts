import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { createTestServer, deleteServer } from '../helpers/servers';

/**
 * Adding a backup player or spectator to a live match.
 *
 * The admin tools POST to /api/rcon/:serverId/add-player, which sends a
 * Ready Up match.update add_player over the server's fleet link. A server
 * that holds no match says so (the add path itself is covered by the fleet
 * driver specs).
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
    'a server with no match says so, not a missing route',
    { tag: ['@api', '@rcon', '@regression'] },
    async ({ request }) => {
      const res = await addPlayer(request, serverId, {
        steamId: VALID_STEAM_ID,
        team: 'spec',
        nickname: 'Caster',
      });
      // Never claims success when nothing was added.
      expect(res.ok()).toBe(false);
      const body = (await res.json()) as { success: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/no match is assigned/i);
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
