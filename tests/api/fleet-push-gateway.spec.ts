import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import {
  FleetTestClient,
  createFleetKey,
  enroll,
  envelope,
  newInstallId,
  resetEnrollRateLimit,
  type Enrolled,
} from '../helpers/fleet';
import { validateMessage, type Envelope } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * Server-level pushes over the fleet link (FLEET.md §7.3-§7.5), against the
 * running API with a fake Ready Up client:
 *
 * - admins.set: the fleet-wide list with its rev in welcome, sent after a
 *   hello that is behind (not when the server has it, not twice while it is
 *   still in the outbox), raised above a server's higher rev, and pushed to a
 *   connected server when the list changes;
 * - server.config + cmd settings.set: the fleet default and a per-server
 *   override, pushed on save; the cmd.result shows on the server's status;
 * - whitelist.set / practice.set: the request waits for the server's answer;
 * - match.update: add a player (ok, new config_rev), a stale base refused
 *   without sending, and a conflict answer moving the base.
 *
 * @tag api
 */

let key: { id: string; value: string };
let serverSeq = 0;

async function enrollNew(request: APIRequestContext): Promise<Enrolled & { installId: string }> {
  const installId = newInstallId();
  const res = await enroll(request, { key: key.value }, installId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...res.body, installId };
}

/** Connect and handshake; returns the client and welcome. */
async function connect(
  server: Enrolled & { installId: string },
  opts: { adminsRev?: number; lastRx?: number; lastTx?: number; streamId?: string } = {}
): Promise<{ client: FleetTestClient; welcome: Envelope }> {
  const client = await FleetTestClient.connect(server.token);
  const welcome = await client.handshake(server.server_id, server.installId, {
    stream: {
      id: opts.streamId ?? 'push-stream',
      last_tx_seq: opts.lastTx ?? 0,
      last_rx_seq: opts.lastRx ?? 0,
    },
    ...(opts.adminsRev !== undefined ? { admins_rev: opts.adminsRev } : {}),
  });
  return { client, welcome };
}

function expectValid(msg: Envelope): void {
  expect(validateMessage(msg), JSON.stringify(msg)).toEqual({ ok: true, errors: [] });
}

/** A reliable server frame answering `to` (a cmd.result), with the ack for it. */
function answer(to: Envelope, payload: Record<string, unknown>, seq: number): Envelope {
  return envelope('cmd.result', payload, {
    seq,
    ack: to.seq,
    ref: to.id,
    ...(to.epoch ? { epoch: to.epoch } : {}),
  });
}

function ack(seq: number): Envelope {
  return envelope('ack', {}, { ack: seq });
}

async function nothingOfType(client: FleetTestClient, type: string, ms = 700): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  expect(client.received.filter((m) => m.type === type).map((m) => m.payload)).toEqual([]);
}

test.describe.serial('Fleet pushes: admins, settings, switches, match.update', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'push-tests' });
  });

  test.afterAll(async ({ request }) => {
    // Leave no fleet default behind for other specs' servers.
    await signInViaRequest(request);
    await request.put('/api/fleet/settings', { data: { settings: { config: {}, match: {} } } });
    await request.put('/api/fleet/admins/extras', { data: { admins: [] } });
  });

  test('admins.set: rev in welcome, sent after a hello that is behind, raised above a higher rev, pushed on change', async ({
    request,
  }) => {
    // Signing in marks the test admin as admin, which schedules a (debounced)
    // admin list check; let it run before counting admins.set frames.
    await new Promise((r) => setTimeout(r, 800));
    const referee = `7656119900000${String(1000 + (Date.now() % 9000)).padStart(4, '0')}`;
    const extras = await request.put('/api/fleet/admins/extras', {
      data: { admins: [{ steamid64: referee, name: 'Referee' }] },
    });
    expect(extras.ok(), await extras.text()).toBe(true);
    const list = await (await request.get('/api/fleet/admins')).json();
    expect(list.rev).toBeGreaterThanOrEqual(1);
    expect(list.admins.map((a: { steamid64: string }) => a.steamid64)).toContain(referee);

    const server = await enrollNew(request);
    const { client, welcome } = await connect(server);
    expect((welcome.payload as { admins_rev: number }).admins_rev).toBe(list.rev);
    const set = await client.nextOfType('admins.set');
    expectValid(set);
    expect(set.payload).toMatchObject({ rev: list.rev });
    expect(
      (set.payload as { admins: Array<{ steamid64: string; name: string }> }).admins
    ).toContainEqual({
      steamid64: referee,
      name: 'Referee',
    });
    // Exactly one copy (no second push on top of the queued one).
    await nothingOfType(client, 'admins.set');
    client.send(ack(set.seq as number));
    await expect
      .poll(async () => {
        const res = await (await request.get('/api/fleet/admins')).json();
        return res.servers.find((s: { serverId: string }) => s.serverId === server.server_id)
          ?.acked;
      })
      .toBe(true);
    client.close();
    await client.waitClosed();

    // It has our rev: nothing is sent.
    const again = await connect(server, { adminsRev: list.rev, lastRx: set.seq as number });
    await nothingOfType(again.client, 'admins.set');

    // A change reaches the connected server at once.
    const changed = await request.put('/api/fleet/admins/extras', {
      data: { admins: [{ steamid64: referee, name: 'Head referee' }] },
    });
    expect(changed.ok()).toBe(true);
    const changedBody = await changed.json();
    expect(changedBody).toMatchObject({ changed: true, rev: list.rev + 1 });
    const pushed = await again.client.nextOfType('admins.set');
    expect(pushed.payload).toMatchObject({ rev: list.rev + 1 });
    expect((pushed.payload as { admins: Array<{ name: string }> }).admins).toContainEqual({
      steamid64: referee,
      name: 'Head referee',
    });
    again.client.send(ack(pushed.seq as number));
    again.client.close();
    await again.client.waitClosed();

    // A server holding a higher rev (an earlier database): ours goes above it.
    const ahead = list.rev + 50;
    const third = await connect(server, { adminsRev: ahead, lastRx: pushed.seq as number });
    const raised = await third.client.nextOfType('admins.set');
    expect((raised.payload as { rev: number }).rev).toBe(ahead + 1);
    third.client.close();
  });

  test('settings: the fleet default and an override go out as server.config + cmd settings.set', async ({
    request,
  }) => {
    const server = await enrollNew(request);
    const { client } = await connect(server, { streamId: `settings-${++serverSeq}` });
    const admins = await client.nextOfType('admins.set');

    const saved = await request.put('/api/fleet/settings', {
      data: {
        settings: {
          config: {
            hostname_format: '{TEAM1} vs {TEAM2}',
            scrim_knife: false,
            status_http: { token: 'tok-123' },
          },
          match: { playout_enabled_default: true },
        },
      },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const savedBody = await saved.json();
    expect(JSON.stringify(savedBody)).not.toContain('tok-123');
    expect(savedBody.settings.statusTokenSet).toBe(true);

    const cfg = await client.nextOfType('server.config');
    expectValid(cfg);
    expect(cfg.payload).toEqual({
      rev: savedBody.rev,
      settings: {
        hostname_format: '{TEAM1} vs {TEAM2}',
        scrim_knife: false,
        status_http: { token: 'tok-123' },
      },
    });
    const cmd = await client.nextOfType('cmd');
    expectValid(cmd);
    expect(cmd.payload).toMatchObject({
      name: 'settings.set',
      args: { settings: { playout_enabled_default: true } },
    });
    client.send(answer(cmd, { status: 'ok', output: 'playout_enabled_default = 1\n' }, 1));
    client.send(ack(Math.max(cfg.seq as number, cmd.seq as number, admins.seq as number)));

    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/fleet/servers/${server.server_id}/push`)).json()).pushed
            ?.settings?.status
      )
      .toBe('ok');
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/fleet/servers/${server.server_id}/push`)).json()).pushed
            ?.serverConfig?.acked
      )
      .toBe(true);
    const status = await (await request.get(`/api/fleet/servers/${server.server_id}/push`)).json();
    expect(status.pushed.serverConfig).toMatchObject({ rev: savedBody.rev, acked: true });
    expect(status.pushed.settings.output).toContain('playout_enabled_default');
    expect(JSON.stringify(status)).not.toContain('tok-123');

    // An override for this server: merged over the default, pushed to it.
    const over = await request.put(`/api/fleet/servers/${server.server_id}/settings`, {
      data: {
        settings: {
          config: { hostname_format: 'Server {MATCH_ID}' },
          match: { autoready_enabled: true },
        },
      },
    });
    expect(over.ok(), await over.text()).toBe(true);
    const cfg2 = await client.nextOfType('server.config');
    expect(cfg2.payload).toMatchObject({
      rev: (await over.json()).rev,
      settings: { hostname_format: 'Server {MATCH_ID}', scrim_knife: false },
    });
    const cmd2 = await client.nextOfType('cmd');
    expect(cmd2.payload).toMatchObject({
      name: 'settings.set',
      args: { settings: { playout_enabled_default: true, autoready_enabled: true } },
    });
    client.send(answer(cmd2, { status: 'ok' }, 2));
    client.send(ack(cmd2.seq as number));
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/fleet/servers/${server.server_id}/push`)).json()).pushed
            ?.settings?.status
      )
      .toBe('ok');
    client.close();
    await client.waitClosed();

    // Reconnecting at the current rev: nothing is sent again.
    const again = await connect(server, {
      streamId: `settings-${serverSeq}`,
      lastTx: 2,
      lastRx: cmd2.seq as number,
    });
    await nothingOfType(again.client, 'server.config');
    again.client.close();

    // Invalid settings are refused whole.
    const bad = await request.put('/api/fleet/settings', {
      data: { settings: { match: { nope: true } } },
    });
    expect(bad.status()).toBe(400);
  });

  test('whitelist.set / practice.set: the request waits for the cmd.result', async ({
    request,
  }) => {
    const server = await enrollNew(request);
    const { client } = await connect(server, { streamId: `switch-${++serverSeq}` });

    const wlReq = request.put(`/api/fleet/servers/${server.server_id}/whitelist`, {
      data: { enabled: true, steamids: ['76561198000000001', '76561198000000002'] },
    });
    const wl = await client.next(
      (m) => m.type === 'cmd' && (m.payload as { name: string }).name === 'whitelist.set'
    );
    expectValid(wl);
    expect(wl.payload).toMatchObject({
      args: { enabled: true, steamids: ['76561198000000001', '76561198000000002'] },
    });
    client.send(
      answer(
        wl,
        {
          status: 'rejected',
          error: {
            code: 'unsupported',
            message: 'the whitelist plugin (whitelist.so) is not loaded',
          },
        },
        1
      )
    );
    const wlRes = await wlReq;
    expect(wlRes.ok()).toBe(true);
    expect((await wlRes.json()).command).toMatchObject({
      status: 'rejected',
      errorCode: 'unsupported',
    });

    const prReq = request.put(`/api/fleet/servers/${server.server_id}/practice`, {
      data: { on: true },
    });
    const pr = await client.next(
      (m) => m.type === 'cmd' && (m.payload as { name: string }).name === 'practice.set'
    );
    expectValid(pr);
    expect((pr.payload as { expires_at: number }).expires_at).toBeGreaterThan(Date.now());
    client.send(answer(pr, { status: 'ok' }, 2));
    expect((await (await prReq).json()).command).toMatchObject({ status: 'ok' });

    const state = await (await request.get(`/api/fleet/servers/${server.server_id}/push`)).json();
    expect(state.practice).toBe(true);
    expect(state.whitelist).toEqual({
      enabled: true,
      steamids: ['76561198000000001', '76561198000000002'],
    });
    expect(state.pushed.whitelist).toMatchObject({ status: 'rejected', errorCode: 'unsupported' });

    // fleet cannot be disabled over the link.
    const locked = await request.post(`/api/fleet/servers/${server.server_id}/plugins`, {
      data: { disable: ['fleet'] },
    });
    expect(locked.status()).toBe(400);
    client.close();
  });

  test('match.update: a substitute keeps its role in the stored config, and the answer says it was saved', async ({
    request,
  }) => {
    // M1 play-test: the route answered configSaved:false (the cmd.result hook
    // had saved it first), and the sub was stored as a plain player.
    const server = await enrollNew(request);
    const slug = `fleet-sub-${Date.now()}`;
    const A = '76561198000000021';
    const B = '76561198000000022';
    const SUB = '76561198000000023';
    const created = await request.post('/api/matches', {
      headers: getAuthHeader(),
      data: {
        slug,
        // A server id skips the auto-allocation: the test assigns it below.
        serverId: 'fleet-push-test-no-allocation',
        config: {
          vetoDisabled: true,
          maplist: ['de_mirage'],
          num_maps: 1,
          players_per_team: 1,
          map_sides: ['team1_ct'],
          team1: { name: 'Red', players: [{ steamid: A, name: 'Ann' }] },
          team2: { name: 'Blue', players: [{ steamid: B, name: 'Bea' }] },
        },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    try {
      const assign = await request.post('/api/test/fleet/assign', {
        headers: getAuthHeader(),
        data: { matchSlug: slug, serverId: server.server_id },
      });
      expect(assign.ok(), await assign.text()).toBe(true);
      const { client } = await connect(server, { streamId: `sub-${++serverSeq}` });

      const addReq = request.post(`/api/fleet/matches/${slug}/update`, {
        data: {
          baseConfigRev: 1,
          ops: [{ op: 'add_player', team: 'team1', steamid64: SUB, name: 'Sid', role: 'sub' }],
        },
      });
      const upd = await client.nextOfType('match.update');
      expect(upd.payload).toMatchObject({
        ops: [{ op: 'add_player', team: 'team1', steamid64: SUB, name: 'Sid', role: 'sub' }],
      });
      client.send(answer(upd, { status: 'ok', rev: 2 }, 1));
      const addRes = await addReq;
      expect(addRes.status(), await addRes.text()).toBe(200);
      expect(await addRes.json()).toMatchObject({ status: 'ok', configRev: 2, configSaved: true });

      // No snapshot yet: the roster view is the stored config, the sub a sub.
      const roster = await (await request.get(`/api/fleet/matches/${slug}/roster`)).json();
      expect(roster.roster.source).toBe('config');
      expect(roster.roster.team1.players).toEqual(
        expect.arrayContaining([
          { steamid64: A, name: 'Ann', role: 'player', connected: null },
          { steamid64: SUB, name: 'Sid', role: 'sub', connected: null },
        ])
      );
      client.close();
    } finally {
      await request.delete(`/api/matches/${slug}`, { headers: getAuthHeader() });
    }
  });

  test('match.update: add a player, a stale base refused, a conflict moves the base', async ({
    request,
  }) => {
    const server = await enrollNew(request);
    const slug = `fleet-push-${Date.now()}`;
    const assign = await request.post('/api/test/fleet/assign', {
      headers: getAuthHeader(),
      data: { matchSlug: slug, serverId: server.server_id },
    });
    expect(assign.ok(), await assign.text()).toBe(true);
    const epoch = (await assign.json()).epoch as number;
    const { client } = await connect(server, { streamId: `upd-${++serverSeq}` });

    const roster = await (await request.get(`/api/fleet/matches/${slug}/roster`)).json();
    expect(roster).toMatchObject({
      fleet: true,
      serverId: server.server_id,
      epoch,
      configRev: 1,
      online: true,
    });

    // ok: the server's new config_rev is the next base.
    const addReq = request.post(`/api/fleet/matches/${slug}/update`, {
      data: {
        baseConfigRev: 1,
        ops: [
          {
            op: 'add_player',
            team: 'team1',
            steamid64: '76561198000000009',
            name: 'Sub',
            role: 'sub',
          },
        ],
      },
    });
    const upd = await client.nextOfType('match.update');
    expectValid(upd);
    expect(upd.epoch).toBe(epoch);
    expect(upd.payload).toMatchObject({ match_id: slug, epoch, base_config_rev: 1, config_rev: 2 });
    client.send(answer(upd, { status: 'ok', rev: 2 }, 1));
    const addRes = await addReq;
    expect(addRes.status(), await addRes.text()).toBe(200);
    expect(await addRes.json()).toMatchObject({ status: 'ok', configRev: 2 });

    // The admin looked at rev 1: refused here, nothing sent.
    const stale = await request.post(`/api/fleet/matches/${slug}/update`, {
      data: { baseConfigRev: 1, ops: [{ op: 'rename_team', team: 'team2', name: 'Blue' }] },
    });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'stale', configRev: 2 });
    await nothingOfType(client, 'match.update', 400);

    // The server's config moved on (rev 5): conflict, the base follows it.
    const renReq = request.post(`/api/fleet/matches/${slug}/update`, {
      data: { baseConfigRev: 2, ops: [{ op: 'rename_team', team: 'team2', name: 'Blue' }] },
    });
    const upd2 = await client.nextOfType('match.update');
    expect(upd2.payload).toMatchObject({ base_config_rev: 2, config_rev: 3 });
    client.send(
      answer(
        upd2,
        {
          status: 'rejected',
          error: { code: 'conflict', message: 'base_config_rev 2 != server config_rev 5' },
          rev: 5,
        },
        2
      )
    );
    const renRes = await renReq;
    expect(renRes.status()).toBe(409);
    expect(await renRes.json()).toMatchObject({ code: 'conflict', configRev: 5 });
    const after = await (await request.get(`/api/fleet/matches/${slug}/roster`)).json();
    expect(after.configRev).toBe(5);
    expect(after.updates.map((u: { status: string }) => u.status)).toEqual(['rejected', 'ok']);

    // Bad ops, and a match that is not on a fleet server.
    const badOps = await request.post(`/api/fleet/matches/${slug}/update`, {
      data: { ops: [{ op: 'set_password', password: 'x' }] },
    });
    expect(badOps.status()).toBe(400);
    const rcon = await (
      await request.get(`/api/fleet/matches/not-a-fleet-${Date.now()}/roster`)
    ).json();
    expect(rcon.fleet).toBe(false);
    const rconUpd = await request.post(`/api/fleet/matches/not-a-fleet-${Date.now()}/update`, {
      data: { ops: [{ op: 'rename_team', team: 'team1', name: 'x' }] },
    });
    expect(rconUpd.status()).toBe(409);
    expect((await rconUpd.json()).code).toBe('not_fleet');
    client.close();
  });
});
