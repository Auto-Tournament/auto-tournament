import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  FleetTestClient,
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
import { validateMessage, type Envelope } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * Ready Up plugin sets (fleet/push/pluginSets.ts) end to end, with a fake
 * csm on the host channel and a fake Ready Up on the fleet link:
 *
 * - "Create server" with a preset: the set is kept with the server.create,
 *   csm installs the bundle that has it (full for Fun), and the new server
 *   gets `cmd plugins.set` with that set right after its first hello;
 * - a reconnect whose hello `plugins_state` matches sends nothing; one that
 *   differs gets the set again; the push state shows the set and what the
 *   server has installed;
 * - the fleet default set goes to a created server with no set of its own;
 * - a server's set can be changed with a preset; bad sets are 400s.
 *
 * The scaler's creates use the same default (fleet-autoscale.spec.ts).
 *
 * @tag api
 * @tag fleet
 */

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
  csm.sendEphemeral('host.inventory', inventory(res.body.host_id, [inventoryServer('server-1')]));
  return { hostId: res.body.host_id, csm };
}

/**
 * Create one server through the admin route and play csm's side: the create
 * succeeds, the Ready Up install follows. Returns the install's bundle and
 * the enroll key.
 */
async function createServer(
  request: APIRequestContext,
  m: Machine,
  plugins?: object
): Promise<{
  bundle: string;
  enrollKey: string;
  commandId: string;
  meta: Record<string, unknown>;
}> {
  const sent = await request.post(`/api/fleet/hosts/${m.hostId}/commands`, {
    data: { type: 'server.create', payload: { count: 1 }, ...(plugins ? { plugins } : {}) },
  });
  expect(sent.status(), await sent.text()).toBe(202);
  const commandId = (await sent.json()).command.id as string;
  const create = await m.csm.nextCommand('server.create');
  expect(create.id).toBe(commandId);
  const enrollKey = (create.payload as { enroll_key: string }).enroll_key;
  const result = m.csm.sendReliable(
    'host.result',
    { status: 'ok', output: 'created server-2' },
    { ref: commandId }
  );
  await m.csm.acked(result.seq as number);
  const install = await m.csm.nextCommand('host.update_plugins');
  const installed = m.csm.sendReliable(
    'host.result',
    { status: 'ok', output: 'Ready Up on server-2' },
    { ref: install.id }
  );
  await m.csm.acked(installed.seq as number);
  const record = (
    await (await request.get(`/api/fleet/hosts/${m.hostId}/commands/${commandId}`)).json()
  ).command;
  return {
    bundle: (install.payload as { readyup: { bundle: string } }).readyup.bundle,
    enrollKey,
    commandId,
    meta: record.meta,
  };
}

async function readyUpServer(request: APIRequestContext, enrollKey: string) {
  const installId = newInstallId();
  const res = await enroll(request, { key: enrollKey }, installId, {
    name: `plugins-${Date.now()}`,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { serverId: res.body.server_id as string, token: res.body.token as string, installId };
}

async function hello(
  ru: { serverId: string; token: string; installId: string },
  over: {
    lastRx?: number;
    lastTx?: number;
    pluginsState?: { installed: string[]; disabled: string[] };
    capabilities?: string[];
  } = {}
): Promise<FleetTestClient> {
  const client = await FleetTestClient.connect(ru.token);
  await client.handshake(ru.serverId, ru.installId, {
    stream: {
      id: `plugins-${ru.serverId}`,
      last_tx_seq: over.lastTx ?? 0,
      last_rx_seq: over.lastRx ?? 0,
    },
    ...(over.pluginsState ? { plugins_state: over.pluginsState } : {}),
    ...(over.capabilities ? { capabilities: over.capabilities } : {}),
  });
  return client;
}

const isPluginsSet = (m: Envelope) =>
  m.type === 'cmd' && (m.payload as { name: string }).name === 'plugins.set';

async function noPluginsSet(client: FleetTestClient, ms = 1200): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  expect(client.received.filter(isPluginsSet).map((m) => m.payload)).toEqual([]);
}

function answer(to: Envelope, seq: number): Envelope {
  return envelope('cmd.result', { status: 'ok' }, { seq, ack: to.seq, ref: to.id });
}

const FUN_ENABLE = ['match', 'essentials', 'skins', 'midas', 'deathmatch'];
const FUN_DISABLE = ['practice', 'whitelist', 'addons'];

test.describe.serial('Fleet plugin sets', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.put('/api/fleet/plugins/default', { data: { plugins: null } });
  });

  test('catalog and presets; the default set is validated', async ({ request }) => {
    const res = await request.get('/api/fleet/plugins');
    expect(res.ok(), await res.text()).toBe(true);
    const body = await res.json();
    expect(body.catalog).toEqual([
      'fleet',
      'match',
      'essentials',
      'practice',
      'whitelist',
      'skins',
      'midas',
      'deathmatch',
      'addons',
    ]);
    expect(body.required).toEqual(['fleet']);
    expect(body.presets.fun).toEqual([
      'fleet',
      'match',
      'essentials',
      'skins',
      'midas',
      'deathmatch',
    ]);

    expect(
      (
        await request.put('/api/fleet/plugins/default', { data: { plugins: { preset: 'party' } } })
      ).status()
    ).toBe(400);
    expect(
      (
        await request.put('/api/fleet/plugins/default', {
          data: { plugins: { preset: 'custom', plugins: ['nope'] } },
        })
      ).status()
    ).toBe(400);
    const saved = await request.put('/api/fleet/plugins/default', {
      data: { plugins: { preset: 'custom', plugins: ['essentials', 'addons'] } },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    expect((await saved.json()).default).toEqual({
      preset: 'custom',
      plugins: ['fleet', 'essentials', 'addons'],
    });
    const cleared = await request.put('/api/fleet/plugins/default', { data: { plugins: null } });
    expect((await cleared.json()).default).toBeNull();
  });

  test('Practice on Ready Up with fleet.cmds.v1: match off, practice.set {on, always}', async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const m = await machine(request, 'plugins-practice');
    try {
      const created = await createServer(request, m, { preset: 'practice' });
      const ru = await readyUpServer(request, created.enrollKey);
      const client = await hello(ru, { capabilities: ['match.v1', 'fleet.cmds.v1'] });
      const set = await client.next(isPluginsSet);
      expect((set.payload as { args: unknown }).args).toEqual({
        enable: ['essentials', 'practice'],
        disable: ['match', 'whitelist', 'skins', 'midas', 'deathmatch', 'addons'],
      });
      client.send(answer(set, 1));
      const practice = await client.next(
        (msg) => msg.type === 'cmd' && (msg.payload as { name: string }).name === 'practice.set'
      );
      expect((practice.payload as { args: unknown }).args).toEqual({ on: true, always: true });
      client.send(answer(practice, 2));

      // A custom set with match and practice: not a practice server any more.
      const changing = request.post(`/api/fleet/servers/${ru.serverId}/plugins`, {
        data: { preset: 'custom', plugins: ['match', 'practice'] },
      });
      const next = await client.next((msg) => isPluginsSet(msg) && msg.id !== set.id);
      client.send(answer(next, 3));
      const off = await client.next(
        (msg) =>
          msg.type === 'cmd' &&
          (msg.payload as { name: string }).name === 'practice.set' &&
          msg.id !== practice.id
      );
      expect((off.payload as { args: unknown }).args).toEqual({ always: false });
      client.send(answer(off, 4));
      expect((await changing).ok()).toBe(true);
      client.close();
    } finally {
      m.csm.close();
    }
  });

  test('a practice server updated to Ready Up with fleet.cmds.v1: match off and practice.set {on, always} on its hello', async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const m = await machine(request, 'plugins-practice-upgrade');
    try {
      const created = await createServer(request, m, { preset: 'practice' });
      const ru = await readyUpServer(request, created.enrollKey);
      // Older Ready Up: match stays on, practice {on}.
      const old = await hello(ru);
      const set = await old.next(isPluginsSet);
      old.send(answer(set, 1));
      const first = await old.next(
        (msg) => msg.type === 'cmd' && (msg.payload as { name: string }).name === 'practice.set'
      );
      expect((first.payload as { args: unknown }).args).toEqual({ on: true });
      old.send(answer(first, 2));
      await expect
        .poll(
          async () =>
            (await (await request.get(`/api/fleet/servers/${ru.serverId}/push`)).json()).pushed
              .practice?.status
        )
        .toBe('ok');
      old.close();
      await old.waitClosed();

      // Updated: it runs the platform commands now and still has match on.
      const updated = await hello(ru, {
        lastTx: 2,
        lastRx: first.seq as number,
        capabilities: ['match.v1', 'fleet.cmds.v1'],
        pluginsState: {
          installed: ['essentials', 'fleet', 'match', 'practice'],
          disabled: ['whitelist', 'skins', 'midas', 'deathmatch', 'addons'],
        },
      });
      const again = await updated.next(isPluginsSet);
      expect((again.payload as { args: { disable: string[] } }).args.disable).toContain('match');
      updated.send(answer(again, 3));
      const practice = await updated.next(
        (msg) =>
          msg.type === 'cmd' &&
          (msg.payload as { name: string }).name === 'practice.set' &&
          msg.id !== first.id
      );
      expect((practice.payload as { args: unknown }).args).toEqual({ on: true, always: true });
      updated.close();
    } finally {
      m.csm.close();
    }
  });

  test('create with a preset: full bundle, plugins.set after the first hello, re-sent only when the server differs', async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const m = await machine(request, 'plugins-fun');
    try {
      // A bad set never reaches csm.
      const bad = await request.post(`/api/fleet/hosts/${m.hostId}/commands`, {
        data: {
          type: 'server.create',
          payload: { count: 1 },
          plugins: { preset: 'custom', plugins: ['hello'] },
        },
      });
      expect(bad.status()).toBe(400);
      expect((await bad.json()).code).toBe('invalid_plugins');

      const created = await createServer(request, m, { preset: 'fun' });
      // Skins, Midas and deathmatch are not in the essentials bundle.
      expect(created.bundle).toBe('skins');
      expect(created.meta.plugins).toEqual({
        preset: 'fun',
        plugins: ['fleet', 'match', 'essentials', 'skins', 'midas', 'deathmatch'],
      });

      const ru = await readyUpServer(request, created.enrollKey);
      const client = await hello(ru);
      const set = await client.next(isPluginsSet);
      expect(validateMessage(set), JSON.stringify(set)).toEqual({ ok: true, errors: [] });
      expect((set.payload as { args: unknown }).args).toEqual({
        enable: FUN_ENABLE,
        disable: FUN_DISABLE,
      });
      client.send(answer(set, 1));
      await expect
        .poll(
          async () =>
            (await (await request.get(`/api/fleet/servers/${ru.serverId}/push`)).json()).pushed
              .plugins?.status
        )
        .toBe('ok');
      // Once.
      await noPluginsSet(client, 800);
      client.close();
      await client.waitClosed();

      // It has the set: nothing is sent. The push state shows the set and what is installed.
      const same = await hello(ru, {
        lastTx: 1,
        lastRx: set.seq as number,
        pluginsState: {
          installed: ['essentials', 'fleet', 'match', 'practice'],
          disabled: FUN_DISABLE,
        },
      });
      await noPluginsSet(same);
      const state = await (await request.get(`/api/fleet/servers/${ru.serverId}/push`)).json();
      expect(state.pluginSet).toEqual({
        preset: 'fun',
        plugins: ['fleet', 'match', 'essentials', 'skins', 'midas', 'deathmatch'],
      });
      expect(state.pluginsState).toEqual({
        installed: ['essentials', 'fleet', 'match', 'practice'],
        disabled: FUN_DISABLE,
      });
      same.close();
      await same.waitClosed();

      // Someone turned skins off by hand (and practice on): the set goes out again.
      const drift = await hello(ru, {
        lastTx: 1,
        lastRx: set.seq as number,
        pluginsState: { installed: ['fleet', 'match', 'practice', 'skins'], disabled: ['skins'] },
      });
      const again = await drift.next(isPluginsSet);
      expect((again.payload as { args: unknown }).args).toEqual({
        enable: FUN_ENABLE,
        disable: FUN_DISABLE,
      });
      drift.close();
    } finally {
      m.csm.close();
    }
  });

  test('the fleet default goes to a created server without its own set; a preset changes it later', async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const saved = await request.put('/api/fleet/plugins/default', {
      data: { plugins: { preset: 'practice' } },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const m = await machine(request, 'plugins-default');
    try {
      const created = await createServer(request, m);
      // Practice fits the essentials bundle.
      expect(created.bundle).toBe('default');
      expect(created.meta.plugins).toMatchObject({ preset: 'practice' });

      const ru = await readyUpServer(request, created.enrollKey);
      const client = await hello(ru);
      const set = await client.next(isPluginsSet);
      // This Ready Up has no fleet.cmds.v1: it refuses to disable match, so
      // match stays on (not in either list).
      expect((set.payload as { args: unknown }).args).toEqual({
        enable: ['essentials', 'practice'],
        disable: ['whitelist', 'skins', 'midas', 'deathmatch', 'addons'],
      });
      client.send(answer(set, 1));
      // Practice is for a practice server: practice mode goes on right after,
      // so the server does not sit in the match plugin's scrim warm-up.
      const practice = await client.next(
        (msg) => msg.type === 'cmd' && (msg.payload as { name: string }).name === 'practice.set'
      );
      expect((practice.payload as { args: unknown }).args).toEqual({ on: true });
      expect(practice.seq).toBeGreaterThan(set.seq);
      client.send(answer(practice, 2));

      // An admin picks Tournament for this server.
      const changing = request.post(`/api/fleet/servers/${ru.serverId}/plugins`, {
        data: { preset: 'tournament' },
      });
      const next = await client.next((msg) => isPluginsSet(msg) && msg.id !== set.id);
      expect((next.payload as { args: unknown }).args).toEqual({
        enable: ['match', 'essentials', 'whitelist'],
        disable: ['practice', 'skins', 'midas', 'deathmatch', 'addons'],
      });
      client.send(answer(next, 3));
      expect((await (await changing).json()).command).toMatchObject({ status: 'ok' });
      const state = await (await request.get(`/api/fleet/servers/${ru.serverId}/push`)).json();
      expect(state.pluginSet).toMatchObject({ preset: 'tournament' });
      expect(
        (
          await request.post(`/api/fleet/servers/${ru.serverId}/plugins`, {
            data: { preset: 'custom', plugins: ['x y'] },
          })
        ).status()
      ).toBe(400);
      client.close();
    } finally {
      m.csm.close();
      await request.put('/api/fleet/plugins/default', { data: { plugins: null } });
    }
  });

  test('without a default, a created server keeps its bundle plugins (no plugins.set)', async ({
    request,
  }) => {
    test.setTimeout(60_000);
    await request.put('/api/fleet/plugins/default', { data: { plugins: null } });
    const m = await machine(request, 'plugins-none');
    try {
      const created = await createServer(request, m);
      expect(created.bundle).toBe('default');
      expect(created.meta.plugins).toBeUndefined();
      const ru = await readyUpServer(request, created.enrollKey);
      const client = await hello(ru);
      await noPluginsSet(client);
      client.close();
    } finally {
      m.csm.close();
    }
  });
});
