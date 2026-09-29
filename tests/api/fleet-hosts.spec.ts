import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { FleetTestClient, createFleetKey, enroll, newInstallId, resetEnrollRateLimit } from '../helpers/fleet';
import {
  FakeCsm,
  createPendingHost,
  enrollHost,
  hostWsUrl,
  inventory,
  inventoryServer,
  newMachineId,
} from '../helpers/fleetHost';

/**
 * The host channel end to end (FLEET.md §18), with a fake csm on
 * `/api/fleet/host`:
 *
 * - Add machine → one-time code and the `csm link` command; the code enrolls
 *   once through POST /api/fleet/enroll with `kind: "host"` (host token
 *   `rhs_…`), and a fleet key enrolls a machine;
 * - hello → welcome; the machine shows online with its inventory;
 * - create server: server.create carries an `enroll_key` minted at send time
 *   → host.progress → host.result; the platform follows up with
 *   host.update_plugins for the new server (csm's copies have no Ready Up);
 *   the new Ready Up server enrolls with that key (limited to the command's
 *   count) and the next inventory joins it to the machine (§18.3);
 * - a disruptive action on a server with a match in progress is refused
 *   (409) without force; with force it is sent with `force {by, reason}` and
 *   audited; csm's own refusal comes back as `rejected`;
 * - commands queued while csm is offline are replayed after the next hello;
 * - host.health is stored and acked; token rotation; revocation closes the
 *   socket with 4403 and the token stops working.
 *
 * @tag api
 */

interface Linked {
  hostId: string;
  token: string;
  machineId: string;
}

async function linkMachine(request: APIRequestContext, name = 'host-spec'): Promise<Linked> {
  const pending = await createPendingHost(request, name);
  const machineId = newMachineId();
  const res = await enrollHost(request, { code: pending.code }, machineId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { hostId: res.body.host_id, token: res.body.token, machineId };
}

async function getHost(request: APIRequestContext, id: string) {
  const res = await request.get(`/api/fleet/hosts/${id}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).host;
}

async function command(request: APIRequestContext, hostId: string, data: object) {
  const res = await request.post(`/api/fleet/hosts/${hostId}/commands`, { data });
  return { status: res.status(), body: await res.json() };
}

test.describe.serial('Fleet hosts (csm)', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test('add machine: one command, a single-use code, and a host token', async ({ request }) => {
    const pending = await createPendingHost(request, 'rack-1');
    expect(pending.code).toMatch(/^RUE-[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    expect(pending.command).toMatch(new RegExp(`^(csm link https://\\S+ ${pending.code}|csm link http://\\S+ ${pending.code} --insecure)$`));
    expect(pending.expiresAt).toBeGreaterThan(Date.now() / 1000);

    const listed = (await (await request.get('/api/fleet/hosts')).json()).hosts.find((h: { id: string }) => h.id === pending.hostId);
    expect(listed).toMatchObject({ status: 'pending', online: false, name: 'rack-1' });
    expect(listed.codeExpiresAt).toBe(pending.expiresAt);

    const machineId = newMachineId();
    const first = await enrollHost(request, { code: pending.code.toLowerCase() }, machineId);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.host_id).toBe(pending.hostId);
    expect(first.body.token).toMatch(/^rhs_[0-9a-z]{12}_[A-Za-z0-9_-]{43}$/);
    expect(first.body.ws_url).toMatch(/^wss?:\/\/.+\/api\/fleet\/host$/);
    expect(first.body.reenrolled).toBe(false);

    const again = await enrollHost(request, { code: pending.code }, newMachineId());
    expect(again.status).toBe(401);
    expect(again.body.code).toBe('invalid_code');

    // The same machine linking again (a new code) gets its record back.
    const second = await createPendingHost(request, 'rack-1 again');
    const re = await enrollHost(request, { code: second.code }, machineId);
    expect(re.status, JSON.stringify(re.body)).toBe(201);
    expect(re.body.host_id).toBe(pending.hostId);
    expect(re.body.reenrolled).toBe(true);
    const hosts = (await (await request.get('/api/fleet/hosts')).json()).hosts;
    expect(hosts.find((h: { id: string }) => h.id === second.hostId)).toBeUndefined();

    // The old token was replaced.
    const old = await FleetTestClient.connect(first.body.token, {}, hostWsUrl());
    expect((await old.waitClosed()).code).toBe(4403);
  });

  test('a fleet key enrolls a machine; a host token is not a server token', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'csm-installs' });
    const res = await enrollHost(request, { key: key.value }, newMachineId());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.token.startsWith('rhs_')).toBe(true);
    // Wrong channel: the server gateway rejects a host token.
    const wrong = await FleetTestClient.connect(res.body.token);
    expect((await wrong.waitClosed()).code).toBe(4401);
  });

  test('hello → welcome; online with inventory; offline after close', async ({ request }) => {
    const m = await linkMachine(request);
    const csm = await FakeCsm.connect(m.token, m.hostId, m.machineId);
    const welcome = await csm.handshake();
    expect(welcome.payload).toMatchObject({ protocol: 1, host_id: m.hostId, resume: { result: 'reset', platform_last_rx_seq: 0 } });
    csm.sendEphemeral('host.inventory', inventory(m.hostId, [inventoryServer('server-1'), inventoryServer('server-2')]));

    await expect.poll(async () => (await getHost(request, m.hostId)).servers?.length).toBe(2);
    const host = await getHost(request, m.hostId);
    expect(host).toMatchObject({ online: true, status: 'enrolled', hostname: 'csm-box', csmVersion: '2.0.0' });
    expect(host.inventory.resources.cpus).toBe(16);
    expect(host.servers[0]).toMatchObject({ name: 'server-1', fleetServer: null, matchInProgress: false });

    // Wrong identity in hello.
    const wrong = await FakeCsm.connect(m.token, 'fh_someone_else', m.machineId);
    wrong.client.send({ v: 1, type: 'hello', id: '01J8ZQ4T8W6N3X0F2R5K7M9P1C', ts: Date.now(), payload: wrong.hello() });
    expect((await wrong.client.waitClosed()).code).toBe(4403);

    csm.close();
    await csm.client.waitClosed();
    await expect.poll(async () => (await getHost(request, m.hostId)).online).toBe(false);
  });

  test('create server: progress, result, and the new server enrolls itself under the machine', async ({ request }) => {
    const m = await linkMachine(request, 'creator');
    const csm = await FakeCsm.connect(m.token, m.hostId, m.machineId);
    await csm.handshake();
    csm.sendEphemeral('host.inventory', inventory(m.hostId, [inventoryServer('server-1')]));

    const sent = await command(request, m.hostId, { type: 'server.create', payload: { count: 1 } });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    expect(sent.body.delivered).toBe(true);
    const commandId = sent.body.command.id;
    // The key never reaches the command record.
    expect(JSON.stringify(sent.body.command)).not.toContain('rfk_');

    const create = await csm.nextCommand('server.create');
    expect(create.id).toBe(commandId);
    const payload = create.payload as { count: number; enroll: boolean; enroll_key: string };
    expect(payload).toMatchObject({ count: 1, enroll: true });
    expect(payload.enroll_key).toMatch(/^rfk_/);
    const enrollKey = payload.enroll_key;

    csm.sendEphemeral('host.progress', { ref: commandId, step: 'provisioning server-2', pct: 40 });
    await expect
      .poll(async () => (await (await request.get(`/api/fleet/hosts/${m.hostId}/commands/${commandId}`)).json()).command.progress.pct)
      .toBe(40);

    const result = csm.sendReliable('host.result', { status: 'ok', output: 'created server-2' }, { ref: commandId });
    await csm.acked(result.seq as number);

    // csm's new servers are copies of the master install without Ready Up:
    // the platform installs it on them next.
    const install = await csm.nextCommand('host.update_plugins');
    expect(install.payload).toEqual({ servers: ['server-2'], readyup: { version: 'latest', bundle: 'default' } });
    const done = (await (await request.get(`/api/fleet/hosts/${m.hostId}/commands/${commandId}`)).json()).command;
    expect(done).toMatchObject({ status: 'ok', output: 'created server-2', type: 'server.create' });
    expect(done.meta).toMatchObject({ serversBefore: ['server-1'], newServers: ['server-2'], followUp: install.id });
    const installRecord = (await (await request.get(`/api/fleet/hosts/${m.hostId}/commands/${install.id}`)).json()).command;
    expect(installRecord).toMatchObject({ issuedBy: 'platform', meta: { followUpOf: commandId } });
    const installed = csm.sendReliable('host.result', { status: 'ok', output: 'Ready Up 0.5.0 on server-2' }, { ref: install.id });
    await csm.acked(installed.seq as number);

    // Ready Up on server-2 enrolls with the key csm wrote for it...
    const installId = newInstallId();
    const ru = await enroll(request, { key: enrollKey }, installId, { name: 'server-2' });
    expect(ru.status, JSON.stringify(ru.body)).toBe(201);
    // ...and the key is limited to the command's count.
    const extra = await enroll(request, { key: enrollKey }, newInstallId());
    expect(extra.status).toBe(409);
    // It does not enroll machines, and it is not listed with the admin's fleet keys.
    expect((await enrollHost(request, { key: enrollKey }, newMachineId())).status).toBe(403);
    const keys = (await (await request.get('/api/fleet/keys')).json()).keys;
    expect(keys.some((k: { id: string }) => enrollKey.includes(k.id))).toBe(false);

    // Before csm reports it, the server shows as enrolled from this machine.
    await expect
      .poll(async () => (await getHost(request, m.hostId)).enrolledServers.map((s: { id: string }) => s.id))
      .toContain(ru.body.server_id);

    // The next inventory joins it on install_id (§18.3).
    csm.sendEphemeral(
      'host.inventory',
      inventory(m.hostId, [
        inventoryServer('server-1'),
        inventoryServer('server-2', { readyup: { installed: '0.5.0', install_id: installId, health: 'ok', phase: 'idle', update_safe: true } }),
      ])
    );
    await expect
      .poll(async () => (await getHost(request, m.hostId)).servers.find((s: { name: string }) => s.name === 'server-2')?.fleetServer?.id)
      .toBe(ru.body.server_id);
    expect((await getHost(request, m.hostId)).enrolledServers).toEqual([]);
    csm.close();
  });

  test('disruptive actions during a match need force; csm refusals come back', async ({ request }) => {
    const m = await linkMachine(request, 'live-box');
    const csm = await FakeCsm.connect(m.token, m.hostId, m.machineId);
    await csm.handshake();
    csm.sendEphemeral(
      'host.inventory',
      inventory(m.hostId, [
        inventoryServer('server-1'),
        inventoryServer('server-2', { readyup: { installed: '0.5.0', health: 'ok', phase: 'live', update_safe: false } }),
      ])
    );
    await expect.poll(async () => (await getHost(request, m.hostId)).servers?.[1]?.matchInProgress).toBe(true);

    const refused = await command(request, m.hostId, { type: 'server.stop', payload: { server: 'server-2' } });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'match_in_progress', servers: ['server-2'] });
    const refusedUpdate = await command(request, m.hostId, { type: 'host.update_game', payload: {} });
    expect(refusedUpdate.status).toBe(409);
    expect(refusedUpdate.body.servers).toEqual(['server-2']);
    // Only the targeted servers count.
    const other = await command(request, m.hostId, { type: 'server.restart', payload: { server: 'server-1', reason: 'test' } });
    expect(other.status).toBe(202);
    const otherMsg = await csm.nextCommand('server.restart');
    expect(otherMsg.payload).toEqual({ server: 'server-1', reason: 'test' });
    // A force without a reason is not a force.
    expect((await command(request, m.hostId, { type: 'server.stop', payload: { server: 'server-2' }, force: {} })).status).toBe(400);

    const forced = await command(request, m.hostId, {
      type: 'server.stop',
      payload: { server: 'server-2', grace_s: 5 },
      force: { reason: 'server hung mid-match' },
    });
    expect(forced.status, JSON.stringify(forced.body)).toBe(202);
    expect(forced.body.command).toMatchObject({ forceReason: 'server hung mid-match', server: 'server-2' });
    expect(forced.body.command.forcedBy).toBeTruthy();
    const stop = await csm.nextCommand('server.stop');
    expect(stop.payload).toMatchObject({ server: 'server-2', grace_s: 5, force: { reason: 'server hung mid-match' } });
    expect((stop.payload as { force: { by: string } }).force.by).toBe(forced.body.command.forcedBy);

    // csm has its own view (§18.2): it refuses without force, and says why.
    const restart = await command(request, m.hostId, { type: 'server.restart', payload: { server: 'server-1', reason: 'again' } });
    const msg = await csm.nextCommand('server.restart');
    expect(msg.id).toBe(restart.body.command.id);
    const r = csm.sendReliable(
      'host.result',
      { status: 'rejected', error: { code: 'match_in_progress', message: 'server-1 update_safe is false' } },
      { ref: msg.id }
    );
    await csm.acked(r.seq as number);
    const answered = (await (await request.get(`/api/fleet/hosts/${m.hostId}/commands/${msg.id}`)).json()).command;
    expect(answered).toMatchObject({ status: 'rejected', errorCode: 'match_in_progress' });
    csm.close();
  });

  test('commands sent while csm is offline are replayed after hello; health is stored', async ({ request }) => {
    const m = await linkMachine(request, 'flaky');
    const sent = await command(request, m.hostId, { type: 'host.updates_hold', payload: { mode: 'on' } });
    expect(sent.status).toBe(202);
    expect(sent.body.delivered).toBe(false);

    const csm = await FakeCsm.connect(m.token, m.hostId, m.machineId);
    await csm.handshake();
    const replayed = await csm.nextCommand('host.updates_hold');
    expect(replayed.id).toBe(sent.body.command.id);
    expect(replayed.payload).toEqual({ mode: 'on' });

    const h = csm.sendReliable('host.health', { server: 'server-1', event: 'hung', detail: '/health silent for 30 s' });
    await csm.acked(h.seq as number);
    // A replay of the same seq is not stored twice.
    csm.client.send({ ...h, id: '01J8ZQ4T8W6N3X0F2R5K7M9P1D' });
    await expect.poll(async () => (await getHost(request, m.hostId)).health.length).toBe(1);
    expect((await getHost(request, m.hostId)).health[0]).toMatchObject({ server: 'server-1', event: 'hung' });

    // Reconnect: the acked command is not sent again; resume continues our stream.
    csm.close();
    await csm.client.waitClosed();
    const again = await FakeCsm.connect(m.token, m.hostId, m.machineId);
    again.txSeq = csm.txSeq;
    const welcome = await again.handshake({ stream: { id: 'csm-stream-1', last_tx_seq: csm.txSeq, last_rx_seq: replayed.seq as number } });
    expect(welcome.payload).toMatchObject({ resume: { result: 'resumed', platform_last_rx_seq: csm.txSeq } });
    await expect(again.client.nextOfType('host.updates_hold', 1500)).rejects.toThrow();
    again.close();
  });

  test('rotate the token over the socket; revoke closes it with 4403', async ({ request }) => {
    const m = await linkMachine(request, 'to-revoke');
    const csm = await FakeCsm.connect(m.token, m.hostId, m.machineId);
    await csm.handshake();

    const rotated = await request.post(`/api/fleet/hosts/${m.hostId}/rotate`);
    expect(rotated.status()).toBe(200);
    const rotate = await csm.nextCommand('auth.rotate');
    const newToken = (rotate.payload as { token: string }).token;
    expect(newToken).toMatch(/^rhs_/);
    const ok = csm.sendReliable('auth.rotated', {}, { ref: rotate.id });
    await csm.acked(ok.seq as number);
    csm.close();
    await csm.client.waitClosed();

    const next = await FakeCsm.connect(newToken, m.hostId, m.machineId);
    await next.handshake();

    const revoked = await request.post(`/api/fleet/hosts/${m.hostId}/revoke`);
    expect(revoked.status()).toBe(200);
    expect((await next.client.waitClosed()).code).toBe(4403);
    expect((await getHost(request, m.hostId)).status).toBe('revoked');

    const after = await FleetTestClient.connect(newToken, {}, hostWsUrl());
    expect((await after.waitClosed()).code).toBe(4403);
    // A revoked machine takes no commands.
    expect((await command(request, m.hostId, { type: 'host.servers.list', payload: {} })).status).toBe(409);
    // And it can be removed.
    expect((await request.delete(`/api/fleet/hosts/${m.hostId}`)).status()).toBe(200);
  });

  test('admin routes need auth; enrollment does not', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069' });
    expect((await anon.get('/api/fleet/hosts')).status()).toBe(401);
    expect((await anon.post('/api/fleet/hosts', { data: {} })).status()).toBe(401);
    const bad = await anon.post('/api/fleet/enroll', {
      data: { kind: 'host', code: 'RUE-0000-0000-0000-0000', machine_id: newMachineId(), hostname: 'x', os: 'Linux', csm_version: '2.0.0' },
    });
    expect(bad.status()).toBe(401);
    // A host body that is not valid is a 400 from the host path, not the server one.
    const invalid = await anon.post('/api/fleet/enroll', { data: { kind: 'host', code: 'x', machine_id: 'not-hex', hostname: 'x' } });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error).toBe('Invalid host enrollment request');
    await anon.dispose();
  });
});
