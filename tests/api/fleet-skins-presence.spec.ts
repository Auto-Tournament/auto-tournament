import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  envelope,
  newInstallId,
  resetEnrollRateLimit,
} from '../helpers/fleet';

/**
 * Skins on a server with no match (skin tryout, practice): no player_connect
 * event says who is there, so the ping names the players
 * (ping.health.steamids) and the platform sends each newcomer their skins
 * (api/src/integrations/cs2/fleet/push/skins.ts playersSeen).
 *
 * @tag api
 * @tag fleet
 */

const PLAYER = '76561198000123456';

test(
  'a player a ping names on a server with no match gets their skins state',
  {
    tag: ['@api', '@fleet'],
  },
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    const key = await createFleetKey(request, { name: 'skins-presence' });
    const installId = newInstallId();
    const res = await enroll(request, { key: key.value }, installId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const client = await FleetTestClient.connect(res.body.token);
    try {
      await client.handshake(res.body.server_id, installId, {
        capabilities: ['match.v1', 'stats.v1', 'skins.v1'],
      });
      const ping = (ids: string[]) =>
        client.send(
          envelope('ping', { t: Date.now(), health: { players: ids.length, steamids: ids } })
        );

      // Nothing equipped: the server is told to forget any loadout it had.
      ping([PLAYER]);
      const sent = await client.next(
        (m) => m.type === 'skins.invalidate' || m.type === 'skins.loadout',
        5000
      );
      expect((sent.payload as { steamid64: string }).steamid64).toBe(PLAYER);

      // Still there on the next ping: nothing sent again.
      ping([PLAYER]);
      await expect(
        client.next((m) => m.type === 'skins.invalidate' || m.type === 'skins.loadout', 1500)
      ).rejects.toThrow();
    } finally {
      client.close();
    }
  }
);
