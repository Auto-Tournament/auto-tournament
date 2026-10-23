import { test, expect } from '@playwright/test';
import { db } from '../../api/src/config/database';
import { fleetBus } from '../../api/src/integrations/cs2/fleet/service';
// skins.ts imports it lazily; loaded here so the lazy import resolves in the test process.
import '../../api/src/integrations/cs2/fleet/gameMessages';
import {
  flushRoundLoadouts,
  pushLoadoutLive,
  skinsTurnedOff,
} from '../../api/src/integrations/cs2/fleet/push/skins';
import { skinService } from '../../api/src/integrations/cs2/skins/skinService';
import { playerConnectionService } from '../../api/src/services/playerConnectionService';

/**
 * Live skins pushes (fleet/push/skins.ts) go to the fleet server a match's
 * `cs2_servers` row is linked to. A Ready Up server linked onto an existing
 * RCON row keeps that row's id (fleet/link.ts), so `matches.server_id` is not
 * the fleet server id.
 *
 * @tag api
 * @tag fleet
 */

const STEAM = '76561198000000001';
const MATCH = { slug: 'skins-push-m1', server_id: 'rcon-row', status: 'live' };
const SERVER = { id: 'rcon-row', fleet_server_id: 'fleet-x' };

type Sent = { serverId: string; type: string; payload: Record<string, unknown> };

test.describe('fleet skins push: the linked fleet server', () => {
  const restore: Array<() => void> = [];
  let sent: Sent[];

  function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
    const original = target[key];
    target[key] = value;
    restore.push(() => {
      target[key] = original;
    });
  }

  test.beforeEach(() => {
    sent = [];
    // A matches table joined to cs2_servers the way the SQL asks.
    stub(db, 'queryAsync', (async (sql: string, params: unknown[] = []) => {
      if (!/FROM matches/.test(sql)) return [];
      const joined = /JOIN cs2_servers/.test(sql);
      const rows = [MATCH].map((m) => ({
        ...m,
        ...(joined && m.server_id === SERVER.id ? { fleet_server_id: SERVER.fleet_server_id } : {}),
      }));
      if (/fleet_server_id = \?/.test(sql))
        return rows.filter((r) => 'fleet_server_id' in r && r.fleet_server_id === params[0]);
      if (/server_id = \?/.test(sql)) return rows.filter((r) => r.server_id === params[0]);
      return rows;
    }) as typeof db.queryAsync);
    stub(db, 'queryOneAsync', (async () => ({
      capabilities: '["skins.v1"]',
      host: '{}',
    })) as typeof db.queryOneAsync);
    stub(skinService, 'loadoutItems', async () => null);
    stub(fleetBus(), 'send', async (serverId, message) => {
      sent.push({
        serverId,
        type: message.type,
        payload: message.payload as Record<string, unknown>,
      });
      return { seq: sent.length, delivered: true };
    });
    playerConnectionService.setConnections(MATCH.slug, [
      { steamId: STEAM, name: 'p1', team: 'team1', connectedAt: 0, isReady: true },
    ]);
  });

  test.afterEach(() => {
    while (restore.length) restore.pop()!();
  });

  test('skins switched off: the linked fleet server clears its players', async () => {
    await skinsTurnedOff(SERVER.fleet_server_id);
    expect(sent).toEqual([
      { serverId: SERVER.fleet_server_id, type: 'skins.invalidate', payload: { steamid64: STEAM } },
    ]);
  });

  test('a live loadout change goes to the linked fleet server at round end', async () => {
    await pushLoadoutLive(STEAM);
    await flushRoundLoadouts(SERVER.fleet_server_id);
    expect(sent).toEqual([
      { serverId: SERVER.fleet_server_id, type: 'skins.invalidate', payload: { steamid64: STEAM } },
    ]);
  });
});
