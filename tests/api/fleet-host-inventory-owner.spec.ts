import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { createFleetKey, enroll, newInstallId, resetEnrollRateLimit } from '../helpers/fleet';
import {
  FakeCsm,
  createPendingHost,
  enrollHost,
  inventory,
  inventoryServer,
  newMachineId,
} from '../helpers/fleetHost';
import {
  claimableIndex,
  joinInventory,
  type FleetServerJoinRow,
} from '../../api/src/integrations/cs2/fleet/hosts/join';

/**
 * Which Ready Up servers a machine's inventory may claim (fleet/hosts/join.ts,
 * hosts/service.ts, link.ts): those enrolled with a key minted for that
 * machine, and the others only while no other machine's inventory names them.
 * Another machine's inventory never joins, readdresses or removes them.
 *
 * @tag api
 * @tag fleet
 */

function row(id: string, installId: string, keyHostId: string | null = null): FleetServerJoinRow {
  return {
    id,
    name: id,
    status: 'enrolled',
    install_id: installId,
    availability: 'available',
    versions: null,
    key_host_id: keyHostId,
  };
}

const named = (installId: string, serverId?: string) =>
  inventoryServer('server-1', {
    readyup: {
      installed: '0.5.0',
      install_id: installId,
      ...(serverId ? { server_id: serverId } : {}),
      health: 'ok',
      update_safe: true,
    },
  });

test.describe('inventory claims (no server)', () => {
  test("a machine's own key wins; others are joined only when nobody else names them", () => {
    const rows = [row('fs_own', 'inst-own', 'fh_a'), row('fs_free', 'inst-free')];
    const a = [named('inst-own'), named('inst-free')];
    const b = [named('inst-own', 'fs_own'), named('inst-other', 'fs_free')];

    const forA = joinInventory(a, claimableIndex('fh_a', rows, [b]), () => true);
    expect(forA.map((s) => s.fleetServer?.id ?? null)).toEqual(['fs_own', null]);
    const forB = joinInventory(b, claimableIndex('fh_b', rows, [a]), () => true);
    expect(forB.map((s) => s.fleetServer?.id ?? null)).toEqual([null, null]);

    const alone = joinInventory(a, claimableIndex('fh_a', rows, []), () => true);
    expect(alone.map((s) => s.fleetServer?.id ?? null)).toEqual(['fs_own', 'fs_free']);
  });
});

interface Linked {
  hostId: string;
  csm: FakeCsm;
}

async function linkMachine(request: APIRequestContext, name: string): Promise<Linked> {
  const pending = await createPendingHost(request, name);
  const machineId = newMachineId();
  const res = await enrollHost(request, { code: pending.code }, machineId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const csm = await FakeCsm.connect(res.body.token, res.body.host_id, machineId);
  await csm.handshake();
  return { hostId: res.body.host_id, csm };
}

async function hostView(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/fleet/hosts/${id}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).host;
}

async function connectHost(request: APIRequestContext, serverId: string): Promise<string | null> {
  const servers = (await (await request.get('/api/fleet/servers')).json()).servers as Array<{
    id: string;
    connect: { host: string } | null;
  }>;
  return servers.find((s) => s.id === serverId)?.connect?.host ?? null;
}

test.describe.serial('inventory claims across machines', () => {
  const machines: Linked[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test.afterAll(() => {
    for (const m of machines) m.csm.close();
  });

  test("another machine's inventory does not take, readdress or remove a server", async ({
    request,
  }) => {
    const key = await createFleetKey(request, { name: 'inventory-owner' });
    const installId = newInstallId();
    const ru = await enroll(request, { key: key.value }, installId);
    expect(ru.status).toBe(201);
    const serverId = ru.body.server_id;

    const a = await linkMachine(request, 'inv-owner-a');
    const b = await linkMachine(request, 'inv-owner-b');
    machines.push(a, b);
    a.csm.sendEphemeral('host.inventory', {
      ...inventory(a.hostId, [named(installId)]),
      address: '198.51.100.10',
    });
    await expect
      .poll(async () => (await hostView(request, a.hostId)).servers?.[0]?.fleetServer?.id ?? null)
      .toBe(serverId);
    await expect.poll(() => connectHost(request, serverId)).toBe('198.51.100.10');

    b.csm.sendEphemeral('host.inventory', {
      ...inventory(b.hostId, [named(installId, serverId)]),
      address: '203.0.113.66',
    });
    await expect.poll(async () => (await hostView(request, b.hostId)).servers?.length).toBe(1);
    expect((await hostView(request, b.hostId)).servers[0].fleetServer).toBeNull();
    expect(await connectHost(request, serverId)).not.toBe('203.0.113.66');

    const sent = await request.post(`/api/fleet/hosts/${b.hostId}/commands`, {
      data: { type: 'server.remove', payload: { server: 'server-1' } },
    });
    expect(sent.status(), await sent.text()).toBe(202);
    const remove = await b.csm.nextCommand('server.remove');
    const done = b.csm.sendReliable(
      'host.result',
      { status: 'ok', output: 'removed server-1' },
      { ref: remove.id }
    );
    await b.csm.acked(done.seq as number);
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/fleet/hosts/${b.hostId}`)).json()).host.commands?.[0]
            ?.status
      )
      .toBe('ok');
    const servers = (await (await request.get('/api/fleet/servers')).json()).servers as Array<{
      id: string;
    }>;
    expect(servers.some((s) => s.id === serverId)).toBe(true);
  });
});
