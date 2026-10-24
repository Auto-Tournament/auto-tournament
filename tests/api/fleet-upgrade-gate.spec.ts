import { test, expect } from '@playwright/test';
import { FleetTestClient, wsUrl } from '../helpers/fleet';
import { hostWsUrl } from '../helpers/fleetHost';
import {
  PENDING_UPGRADES_PER_IP,
  PENDING_UPGRADES_TOTAL,
  PendingUpgrades,
} from '../../api/src/integrations/cs2/fleet/upgradeGate';

/**
 * The fleet sockets' upgrade (fleet/upgradeGate.ts, fleet/gateway.ts,
 * fleet/hosts/gateway.ts): a bearer that is not a token of that channel is
 * refused with HTTP 401 before the handshake; upgrades whose token is being
 * checked are capped per address and in all; the handshake completes only
 * once the token check is done, so no frame arrives before it.
 *
 * @tag api
 * @tag fleet
 */

async function upgradeStatus(url: string, token: string | null): Promise<string> {
  try {
    const client = await FleetTestClient.connect(token, {}, url);
    client.ws.close();
    return 'open';
  } catch (error) {
    return (error as Error).message;
  }
}

test.describe('fleet upgrade gate (no server)', () => {
  test('caps pending upgrades per address and in all; a slot is released once', () => {
    const gate = new PendingUpgrades(2, 3);
    const a1 = gate.acquire('198.51.100.1');
    const a2 = gate.acquire('198.51.100.1');
    expect(a1).not.toBeNull();
    expect(a2).not.toBeNull();
    expect(gate.acquire('198.51.100.1')).toBeNull();
    const b1 = gate.acquire('198.51.100.2');
    expect(b1).not.toBeNull();
    expect(gate.acquire('198.51.100.3')).toBeNull();
    a1!();
    a1!();
    expect(gate.size).toBe(2);
    expect(gate.acquire('198.51.100.3')).not.toBeNull();
    expect(gate.acquire('198.51.100.1')).toBeNull();
    a2!();
    expect(gate.acquire('198.51.100.1')).not.toBeNull();
  });

  test('defaults', () => {
    expect(PENDING_UPGRADES_PER_IP).toBe(20);
    expect(PENDING_UPGRADES_TOTAL).toBe(200);
  });
});

test.describe('fleet upgrade gate', () => {
  test('server channel: no token or one that does not parse is HTTP 401', async () => {
    expect(await upgradeStatus(wsUrl(), null)).toBe('unexpected HTTP 401');
    expect(await upgradeStatus(wsUrl(), 'not-a-token')).toBe('unexpected HTTP 401');
    expect(await upgradeStatus(wsUrl(), 'rhs_000000000000_' + 'A'.repeat(43))).toBe(
      'unexpected HTTP 401'
    );
  });

  test('host channel: no token or one that does not parse is HTTP 401', async () => {
    expect(await upgradeStatus(hostWsUrl(), null)).toBe('unexpected HTTP 401');
    expect(await upgradeStatus(hostWsUrl(), 'not-a-token')).toBe('unexpected HTTP 401');
    expect(await upgradeStatus(hostWsUrl(), 'rus_000000000000_' + 'A'.repeat(43))).toBe(
      'unexpected HTTP 401'
    );
  });

  test('a well-formed unknown token still completes the handshake and closes 4401', async () => {
    const server = await FleetTestClient.connect('rus_000000000000_' + 'A'.repeat(43));
    expect(await server.waitClosed()).toMatchObject({ code: 4401 });
    const host = await FleetTestClient.connect(
      'rhs_000000000000_' + 'A'.repeat(43),
      {},
      hostWsUrl()
    );
    expect(await host.waitClosed()).toMatchObject({ code: 4401 });
  });
});
