import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  envelope,
  newInstallId,
  resetEnrollRateLimit,
} from '../helpers/fleet';
import {
  FakeCsm,
  createPendingHost,
  enrollHost,
  inventory,
  inventoryServer,
  newMachineId,
} from '../helpers/fleetHost';
import type { HostInventoryServer } from '../../api/src/integrations/cs2/fleet/protocol/host/v1';

/**
 * Automatic server scaling (fleet/autoscale/) against a fake csm on the host
 * channel and fake Ready Up servers on the fleet link. CI runs the app with
 * FLEET_AUTOSCALE_INTERVAL_MS=0, so every pass here is POST
 * /api/fleet/autoscale/run.
 *
 * - a match waiting for a server: the scaler starts a stopped Ready Up server
 *   (server.start), and says why in its activity;
 * - no matches: an idle server is stopped after the cool-down (server.stop);
 *   a busy one never is;
 * - the pool short and no stopped server: csm is asked for one new server
 *   (server.create, once), and the Ready Up that enrolls with that create's
 *   key is linked to the match pool;
 * - settings: on by default, validated.
 *
 * @tag api
 * @tag fleet
 */

const STEAM = (n: number) => `765611980002${String(n).padStart(5, '0')}`;
const DEFAULTS = {
  enabled: true,
  leadTimeSeconds: 120,
  cooldownSeconds: 600,
  maxServersPerHost: 4,
};

let key: { id: string; value: string };

interface Machine {
  hostId: string;
  csm: FakeCsm;
}

async function machine(request: APIRequestContext, name: string): Promise<Machine> {
  const pending = await createPendingHost(request, name);
  const machineId = newMachineId();
  const res = await enrollHost(request, { code: pending.code }, machineId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const csm = await FakeCsm.connect(res.body.token, res.body.host_id, machineId);
  await csm.handshake();
  return { hostId: res.body.host_id, csm };
}

/** A Ready Up server enrolled with the test key and linked to the match pool. */
async function readyUp(request: APIRequestContext, name: string) {
  const installId = newInstallId();
  const res = await enroll(request, { key: key.value }, installId, { name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const link = await request.post(`/api/fleet/servers/${res.body.server_id}/link`, {
    headers: getAuthHeader(),
    data: {},
  });
  expect([200, 201], await link.text()).toContain(link.status());
  return { serverId: res.body.server_id, token: res.body.token, installId };
}

/** Its Ready Up link up (hello with `availability`), kept alive. */
async function connect(
  ru: { serverId: string; token: string; installId: string },
  availability: 'available' | 'busy'
) {
  const client = await FleetTestClient.connect(ru.token);
  await client.handshake(ru.serverId, ru.installId, {
    availability,
    stream: { id: `stream-${ru.serverId}`, last_tx_seq: 0, last_rx_seq: 0 },
  });
  const keepalive = setInterval(() => client.send(envelope('ping', { t: Date.now() })), 5000);
  return {
    client,
    close: () => {
      clearInterval(keepalive);
      client.close();
    },
  };
}

function csmServer(
  name: string,
  installId: string | null,
  over: Partial<HostInventoryServer> = {}
): HostInventoryServer {
  const base = inventoryServer(name);
  return {
    ...base,
    readyup: { ...base.readyup, ...(installId ? { install_id: installId } : {}) },
    ...over,
  };
}

async function status(request: APIRequestContext) {
  const res = await request.get('/api/fleet/autoscale?activity=50', { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

async function settings(request: APIRequestContext, data: object) {
  const res = await request.put('/api/fleet/autoscale/settings', {
    headers: getAuthHeader(),
    data,
  });
  return { status: res.status(), body: await res.json() };
}

async function run(request: APIRequestContext) {
  const res = await request.post('/api/fleet/autoscale/run', { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

/** A standalone match with no server: it needs one. */
async function createMatch(request: APIRequestContext, slug: string): Promise<void> {
  const res = await request.post('/api/matches', {
    headers: getAuthHeader(),
    data: {
      slug,
      config: {
        vetoDisabled: true,
        maplist: ['de_mirage'],
        num_maps: 1,
        players_per_team: 1,
        map_sides: ['team1_ct'],
        team1: { name: 'Scale Alpha', players: [{ steamid: STEAM(1), name: 'alice' }] },
        team2: { name: 'Scale Bravo', players: [{ steamid: STEAM(2), name: 'bob' }] },
      },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** Nothing else needs a server: no tournament, no open standalone match. */
async function clearDemand(request: APIRequestContext): Promise<void> {
  await request.delete('/api/tournament', { headers: getAuthHeader() });
  const list = await (await request.get('/api/matches', { headers: getAuthHeader() })).json();
  const open = ((list.matches ?? []) as Array<{ slug: string; round: number; status: string }>)
    .filter((m) => m.round === 0 && ['pending', 'ready', 'loaded', 'live'].includes(m.status))
    .map((m) => m.slug);
  if (open.length > 0) {
    await request.post('/api/matches/bulk-delete', {
      headers: getAuthHeader(),
      data: { slugs: open },
    });
  }
}

const noCommand = async (csm: FakeCsm, type: string) =>
  expect(csm.client.nextOfType(type, 1500)).rejects.toThrow();

test.describe.serial('Fleet autoscale (csm)', () => {
  const cleanup: Array<() => Promise<unknown> | unknown> = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-autoscale-tests' });
    await clearDemand(request);
  });

  test.afterEach(async ({ request }) => {
    while (cleanup.length) await cleanup.pop()?.();
    await settings(request, DEFAULTS);
  });

  test('settings: on by default, validated', async ({ request }) => {
    const s = await status(request);
    expect(s.settings).toMatchObject(DEFAULTS);
    expect((await settings(request, { cooldownSeconds: -5 })).status).toBe(400);
    expect((await settings(request, { enabled: 'no' })).status).toBe(400);
    expect((await settings(request, { surprise: 1 })).status).toBe(400);
    const saved = await settings(request, { enabled: false, leadTimeSeconds: 300 });
    expect(saved.status).toBe(200);
    expect(saved.body.settings).toMatchObject({
      enabled: false,
      leadTimeSeconds: 300,
      cooldownSeconds: 600,
    });
    expect(saved.body.settings.updatedBy).toBeTruthy();
    // Off: a pass does nothing.
    const pass = await run(request);
    expect(pass.actions).toEqual([]);
  });

  test('a match waiting for a server starts a stopped Ready Up server', async ({ request }) => {
    const m = await machine(request, 'scale-start');
    cleanup.push(() => m.csm.close());
    const ru = await readyUp(request, 'scale-start-1');
    cleanup.push(() =>
      request.delete(`/api/fleet/servers/${ru.serverId}/link`, { headers: getAuthHeader() })
    );
    m.csm.sendEphemeral(
      'host.inventory',
      inventory(m.hostId, [
        csmServer('server-1', ru.installId, {
          process: { running: false, restarts_24h: 0 },
          readyup: { installed: '0.5.0', install_id: ru.installId, health: 'not_running' },
        }),
      ])
    );
    await expect
      .poll(
        async () =>
          (await status(request)).servers.find(
            (s: { fleetServerId: string }) => s.fleetServerId === ru.serverId
          )?.state
      )
      .toBe('stopped');

    const slug = `scale-${Date.now()}`;
    await createMatch(request, slug);
    cleanup.push(() => request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() }));
    const before = await status(request);
    expect(before.demand.total).toBeGreaterThanOrEqual(1);

    const pass = await run(request);
    expect(pass.actions).toContainEqual(
      expect.objectContaining({
        outcome: 'sent',
        action: expect.objectContaining({ kind: 'start', server: 'server-1', hostId: m.hostId }),
      })
    );
    const start = await m.csm.nextCommand('server.start');
    expect(start.payload).toMatchObject({ server: 'server-1' });
    const record = (
      await (await request.get(`/api/fleet/hosts/${m.hostId}/commands/${start.id}`)).json()
    ).command;
    // Audited with its reason, never forced.
    expect(record).toMatchObject({ type: 'server.start', issuedBy: 'autoscale', forcedBy: null });
    expect(record.meta).toMatchObject({
      autoscale: true,
      reason: expect.stringMatching(/waiting for a server/),
    });

    // Why, on the Servers page.
    const after = await status(request);
    expect(after.activity[0]).toMatchObject({
      action: 'start',
      server: 'server-1',
      fleetServerId: ru.serverId,
      hostId: m.hostId,
      outcome: 'sent',
      commandId: start.id,
    });
    expect(after.activity[0].reason).toMatch(/waiting for a server/);
    // Being started: warm, so a second pass does not start it again.
    expect(
      after.servers.find((s: { fleetServerId: string }) => s.fleetServerId === ru.serverId)?.state
    ).toBe('starting');
    await run(request);
    await noCommand(m.csm, 'server.start');

    const done = m.csm.sendReliable(
      'host.result',
      { status: 'ok', output: 'started server-1' },
      { ref: start.id }
    );
    await m.csm.acked(done.seq as number);
  });

  test('no matches: an idle server is stopped after the cool-down, a busy one never', async ({
    request,
  }) => {
    const m = await machine(request, 'scale-stop');
    cleanup.push(() => m.csm.close());
    const idle = await readyUp(request, 'scale-idle');
    const busy = await readyUp(request, 'scale-busy');
    for (const ru of [idle, busy]) {
      cleanup.push(() =>
        request.delete(`/api/fleet/servers/${ru.serverId}/link`, { headers: getAuthHeader() })
      );
    }
    const idleLink = await connect(idle, 'available');
    cleanup.push(() => idleLink.close());
    const busyLink = await connect(busy, 'busy');
    cleanup.push(() => busyLink.close());
    m.csm.sendEphemeral(
      'host.inventory',
      inventory(m.hostId, [
        csmServer('server-1', idle.installId),
        csmServer('server-2', busy.installId, {
          readyup: {
            installed: '0.5.0',
            install_id: busy.installId,
            health: 'ok',
            phase: 'live',
            update_safe: false,
          },
        }),
      ])
    );
    const stateOf = async (id: string) =>
      (await status(request)).servers.find((s: { fleetServerId: string }) => s.fleetServerId === id)
        ?.state;
    await expect.poll(() => stateOf(idle.serverId)).toBe('idle');
    await expect.poll(() => stateOf(busy.serverId)).toBe('busy');
    expect((await status(request)).demand.total).toBe(0);

    // Inside the cool-down: nothing.
    await run(request);
    await noCommand(m.csm, 'server.stop');

    await settings(request, { cooldownSeconds: 0 });
    const pass = await run(request);
    expect(pass.actions).toContainEqual(
      expect.objectContaining({
        outcome: 'sent',
        action: expect.objectContaining({ kind: 'stop', server: 'server-1' }),
      })
    );
    const stop = await m.csm.nextCommand('server.stop');
    expect(stop.payload).toMatchObject({ server: 'server-1' });
    expect((stop.payload as { force?: unknown }).force).toBeUndefined();
    const s = await status(request);
    expect(s.activity[0]).toMatchObject({ action: 'stop', server: 'server-1', outcome: 'sent' });
    expect(s.activity[0].reason).toMatch(/^Idle \d+ min and not needed/);

    // The busy server stays up, pass after pass.
    await run(request);
    await noCommand(m.csm, 'server.stop');
    const done = m.csm.sendReliable(
      'host.result',
      { status: 'ok', output: 'stopped server-1' },
      { ref: stop.id }
    );
    await m.csm.acked(done.seq as number);
  });

  test('pool short: csm creates one server, and its Ready Up joins the pool', async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const m = await machine(request, 'scale-create');
    cleanup.push(() => m.csm.close());
    m.csm.sendEphemeral('host.inventory', inventory(m.hostId, []));
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/fleet/hosts/${m.hostId}`)).json()).host.inventory?.servers
      )
      .toEqual([]);

    const slug = `scale-create-${Date.now()}`;
    await createMatch(request, slug);
    cleanup.push(() => request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() }));

    const pass = await run(request);
    expect(pass.actions).toContainEqual(
      expect.objectContaining({
        outcome: 'sent',
        action: expect.objectContaining({ kind: 'create', hostId: m.hostId }),
      })
    );
    const create = await m.csm.nextCommand('server.create');
    const payload = create.payload as { count: number; enroll: boolean; enroll_key: string };
    expect(payload).toMatchObject({ count: 1, enroll: true });
    expect(payload.enroll_key).toMatch(/^rfk_/);

    // Once: not again while it runs.
    await run(request);
    await noCommand(m.csm, 'server.create');

    const result = m.csm.sendReliable(
      'host.result',
      { status: 'ok', output: 'created server-1' },
      { ref: create.id }
    );
    await m.csm.acked(result.seq as number);
    const install = await m.csm.nextCommand('host.update_plugins');
    expect(install.payload).toMatchObject({ servers: ['server-1'] });
    const installed = m.csm.sendReliable(
      'host.result',
      { status: 'ok', output: 'Ready Up on server-1' },
      { ref: install.id }
    );
    await m.csm.acked(installed.seq as number);

    // Nor while its server has not joined the pool.
    await run(request);
    await noCommand(m.csm, 'server.create');

    // Ready Up on the new server enrolls with the create's key: the next pass links it.
    const installId = newInstallId();
    const ru = await enroll(request, { key: payload.enroll_key }, installId, {
      name: 'scale-created',
    });
    expect(ru.status, JSON.stringify(ru.body)).toBe(201);
    cleanup.push(() =>
      request.delete(`/api/fleet/servers/${ru.body.server_id}/link`, { headers: getAuthHeader() })
    );
    const linked = await run(request);
    expect(linked.linked).toBeGreaterThanOrEqual(1);
    const row = await (
      await request.get(`/api/servers/${ru.body.server_id}`, { headers: getAuthHeader() })
    ).json();
    expect(row.server ?? row).toMatchObject({
      transport: 'fleet',
      fleetServerId: ru.body.server_id,
      enabled: true,
    });
    const s = await status(request);
    expect(
      s.activity.find(
        (e: { action: string; fleetServerId: string }) =>
          e.action === 'link' && e.fleetServerId === ru.body.server_id
      )
    ).toMatchObject({
      outcome: 'linked',
      hostId: m.hostId,
    });
    expect(
      s.activity.find(
        (e: { action: string; commandId: string }) =>
          e.action === 'create' && e.commandId === create.id
      )
    ).toBeTruthy();
    // Linked but not in csm's inventory yet: still waited for, no second create.
    await noCommand(m.csm, 'server.create');

    // csm reports it, booting: it is the warm server the match needs.
    m.csm.sendEphemeral(
      'host.inventory',
      inventory(m.hostId, [
        csmServer('server-1', installId, {
          process: {
            running: true,
            pid: 4242,
            started_at: Math.floor(Date.now() / 1000),
            restarts_24h: 0,
          },
        }),
      ])
    );
    await expect
      .poll(
        async () =>
          (await status(request)).servers.find(
            (x: { fleetServerId: string }) => x.fleetServerId === ru.body.server_id
          )?.state
      )
      .toBe('starting');
    const settled = await run(request);
    expect(settled.actions).toEqual([]);
    await noCommand(m.csm, 'server.create');
  });

  test('a server the scaler creates gets the fleet default plugin set after its first hello', async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const saved = await request.put('/api/fleet/plugins/default', {
      headers: getAuthHeader(),
      data: { plugins: { preset: 'fun' } },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    cleanup.push(() =>
      request.put('/api/fleet/plugins/default', { headers: getAuthHeader(), data: { plugins: null } })
    );
    const m = await machine(request, 'scale-plugins');
    cleanup.push(() => m.csm.close());
    m.csm.sendEphemeral('host.inventory', inventory(m.hostId, []));
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/fleet/hosts/${m.hostId}`)).json()).host.inventory?.servers
      )
      .toEqual([]);
    const slug = `scale-plugins-${Date.now()}`;
    await createMatch(request, slug);
    cleanup.push(() => request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() }));

    await run(request);
    const create = await m.csm.nextCommand('server.create');
    const enrollKey = (create.payload as { enroll_key: string }).enroll_key;
    const result = m.csm.sendReliable(
      'host.result',
      { status: 'ok', output: 'created server-1' },
      { ref: create.id }
    );
    await m.csm.acked(result.seq as number);
    // Fun needs plugins the essentials bundle does not have: csm installs the full one.
    const install = await m.csm.nextCommand('host.update_plugins');
    expect(install.payload).toMatchObject({ servers: ['server-1'], readyup: { bundle: 'skins' } });

    const installId = newInstallId();
    const ru = await enroll(request, { key: enrollKey }, installId, { name: 'scale-plugins' });
    expect(ru.status, JSON.stringify(ru.body)).toBe(201);
    const link = await connect(
      { serverId: ru.body.server_id, token: ru.body.token, installId },
      'available'
    );
    cleanup.push(() => link.close());
    const set = await link.client.next(
      (msg) => msg.type === 'cmd' && (msg.payload as { name: string }).name === 'plugins.set'
    );
    expect((set.payload as { args: unknown }).args).toEqual({
      enable: ['match', 'essentials', 'skins', 'midas', 'deathmatch'],
      disable: ['practice', 'whitelist', 'addons'],
    });
  });
});
