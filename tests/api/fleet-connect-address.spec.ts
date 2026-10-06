import type { IncomingMessage } from 'http';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { FleetTestClient, createFleetKey, enroll, newInstallId, resetEnrollRateLimit } from '../helpers/fleet';
import {
  chooseConnectAddress,
  formatConnectAddress,
  isPrivateOrLoopback,
  parseAddr,
  peerAddressOf,
} from '../../api/src/integrations/cs2/fleet/address';
import type { HelloPayload } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * Where players connect to a Ready Up server (FLEET.md §6.1 "Connect
 * address", fleet/address.ts, fleet/link.ts). The hello `hostname` (the
 * machine's name, e.g. "cs2") is never the connect host. In order: the
 * admin's override, `host.public_addr`, the link's peer address (after the
 * trusted proxy hop); a private `public_addr` loses to a public peer.
 *
 * @tag api
 * @tag fleet
 */

function fakeReq(remoteAddress: string | undefined, xff?: string): IncomingMessage {
  return { socket: { remoteAddress }, headers: xff ? { 'x-forwarded-for': xff } : {} } as unknown as IncomingMessage;
}

test.describe('connect address: choosing it (no server)', () => {
  test('parses host, host:port, IPv6 and rejects wildcards and junk', () => {
    expect(parseAddr('203.0.113.7:27055')).toEqual({ host: '203.0.113.7', port: 27055 });
    expect(parseAddr('play.example.com')).toEqual({ host: 'play.example.com', port: null });
    expect(parseAddr('[2001:db8::7]:27020')).toEqual({ host: '2001:db8::7', port: 27020 });
    expect(parseAddr('2001:db8::7')).toEqual({ host: '2001:db8::7', port: null });
    expect(parseAddr('::ffff:198.51.100.4')).toEqual({ host: '198.51.100.4', port: null });
    for (const bad of ['', '0.0.0.0:27015', '::', 'bad host', 'h:0', 'h:70000', 'http://x', 'a/b', undefined, null]) {
      expect(parseAddr(bad as string)).toBeNull();
    }
  });

  test('private and loopback addresses', () => {
    for (const p of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.50.196', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', 'localhost', '::ffff:10.0.0.1']) {
      expect(isPrivateOrLoopback(p), p).toBe(true);
    }
    for (const p of ['203.0.113.7', '172.32.0.1', '8.8.8.8', '2001:db8::7', 'play.example.com']) {
      expect(isPrivateOrLoopback(p), p).toBe(false);
    }
  });

  test('peer address honours the trusted proxy hops, like Express trust proxy', () => {
    expect(peerAddressOf(fakeReq('198.51.100.4'), 1)).toBe('198.51.100.4');
    expect(peerAddressOf(fakeReq('::ffff:127.0.0.1', '203.0.113.9'), 1)).toBe('203.0.113.9');
    // Only the last hop is trusted: a client-supplied entry further left is ignored.
    expect(peerAddressOf(fakeReq('127.0.0.1', '6.6.6.6, 203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(peerAddressOf(fakeReq('127.0.0.1', '6.6.6.6, 203.0.113.9'), 0)).toBe('127.0.0.1');
    expect(peerAddressOf(fakeReq('127.0.0.1', '6.6.6.6, 203.0.113.9'), 2)).toBe('6.6.6.6');
    expect(peerAddressOf(fakeReq('127.0.0.1', 'not-an-ip'), 1)).toBeNull();
    expect(peerAddressOf(fakeReq(undefined), 1)).toBeNull();
  });

  test('order: public_addr, then the peer; never the hostname', () => {
    const host = { game_port: 27055 };
    expect(chooseConnectAddress({ ...host, public_addr: '198.51.100.7:27100' }, '203.0.113.9')).toEqual({
      host: '198.51.100.7',
      port: 27100,
      source: 'public_addr',
    });
    expect(chooseConnectAddress({ ...host, public_addr: 'play.example.com' }, '203.0.113.9')).toEqual({
      host: 'play.example.com',
      port: 27055,
      source: 'public_addr',
    });
    // Behind NAT: the server reports the LAN address it binds to, players need the public one.
    expect(chooseConnectAddress({ ...host, public_addr: '192.168.1.5:27055' }, '203.0.113.9')).toEqual({
      host: '203.0.113.9',
      port: 27055,
      source: 'peer',
    });
    // LAN: both private, the server's own report wins.
    expect(chooseConnectAddress({ ...host, public_addr: '192.168.50.196' }, '192.168.50.10')).toEqual({
      host: '192.168.50.196',
      port: 27055,
      source: 'public_addr',
    });
    expect(chooseConnectAddress(host, '192.168.50.196')).toEqual({ host: '192.168.50.196', port: 27055, source: 'peer' });
    expect(chooseConnectAddress(host, '::ffff:203.0.113.9')).toEqual({ host: '203.0.113.9', port: 27055, source: 'peer' });
    expect(chooseConnectAddress({ ...host, public_addr: '0.0.0.0' }, null)).toBeNull();
    expect(chooseConnectAddress(null, null)).toBeNull();
    expect(chooseConnectAddress(null, '203.0.113.9')).toEqual({ host: '203.0.113.9', port: 27015, source: 'peer' });
    expect(formatConnectAddress('2001:db8::7', 27015)).toBe('[2001:db8::7]:27015');
    expect(formatConnectAddress('203.0.113.9', 27055)).toBe('203.0.113.9:27055');
  });

  test("the csm machine's address comes before the peer (NTLAN 2026-10-05: the peer was the proxy)", () => {
    const host = { game_port: 27025 };
    // The link came through a proxy on .147; the machine is .196.
    expect(chooseConnectAddress(host, '192.168.50.147', '192.168.50.196')).toEqual({
      host: '192.168.50.196',
      port: 27025,
      source: 'machine',
    });
    // The server's own public_addr still wins.
    expect(chooseConnectAddress({ ...host, public_addr: 'play.example.com' }, '192.168.50.147', '192.168.50.196')).toEqual({
      host: 'play.example.com',
      port: 27025,
      source: 'public_addr',
    });
    // A machine behind NAT (private address, public link): players need the public one.
    expect(chooseConnectAddress(host, '203.0.113.9', '10.0.0.4')).toEqual({ host: '203.0.113.9', port: 27025, source: 'peer' });
    // No usable machine address: the peer, as before.
    expect(chooseConnectAddress(host, '192.168.50.147', '')).toEqual({ host: '192.168.50.147', port: 27025, source: 'peer' });
    expect(chooseConnectAddress(host, null, '192.168.50.196')).toEqual({ host: '192.168.50.196', port: 27025, source: 'machine' });
  });
});

let key: { id: string; value: string };

interface Listed {
  id: string;
  name: string;
  peerAddr: string | null;
  linkedServerId: string | null;
  connect: { host: string; port: number; address: string; source: string | null } | null;
}

async function listed(request: APIRequestContext, id: string): Promise<Listed> {
  const res = await request.get('/api/fleet/servers', { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).servers.find((s: Listed) => s.id === id);
}

async function cs2Row(request: APIRequestContext, id: string): Promise<{ host: string; port: number; hostOverride?: boolean }> {
  const res = await request.get(`/api/servers/${id}`, { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  return body.server ?? body;
}

test.describe.serial('connect address: link and hello', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
    if (!key) key = await createFleetKey(request, { name: 'fleet-connect-address-tests' });
  });

  test.afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
  });

  async function connected(
    installId: string,
    serverId: string,
    token: string,
    host: HelloPayload['host']
  ): Promise<FleetTestClient> {
    const client = await FleetTestClient.connect(token);
    cleanup.push(() => client.close());
    await client.handshake(serverId, installId, { host });
    return client;
  }

  test('a linked server connects players to its public_addr or peer, never its hostname; admins can override', async ({
    request,
  }) => {
    const installId = newInstallId();
    const res = await enroll(request, { key: key.value }, installId, { host: { hostname: 'cs2', game_port: 27055 } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { server_id: id, token } = res.body;
    cleanup.push(async () => {
      await request.delete(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader() });
    });

    // No public_addr: the peer address. What it is depends on where the test
    // runs (a proxy in front of the API in CI), so it is read back; the
    // X-Forwarded-For handling itself is covered above.
    let client = await connected(installId, id, token, { hostname: 'cs2', game_port: 27055 });
    const before = await listed(request, id);
    expect(before.peerAddr).toBeTruthy();
    const peer = before.peerAddr as string;
    expect(before.connect).toMatchObject({ address: formatConnectAddress(peer, 27055), source: 'peer' });
    const link = await request.post(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader(), data: {} });
    expect([200, 201], await link.text()).toContain(link.status());
    expect(await cs2Row(request, id)).toMatchObject({ host: peer, port: 27055, hostOverride: false });
    expect((await listed(request, id)).connect).toMatchObject({ address: formatConnectAddress(peer, 27055), source: 'peer' });

    // A hello with public_addr moves the row.
    client.close();
    client = await connected(installId, id, token, {
      hostname: 'cs2',
      game_port: 27055,
      public_addr: '198.51.100.7:27100',
    });
    await expect.poll(async () => (await cs2Row(request, id)).host).toBe('198.51.100.7');
    expect(await cs2Row(request, id)).toMatchObject({ port: 27100 });
    expect((await listed(request, id)).connect).toMatchObject({ address: '198.51.100.7:27100', source: 'public_addr' });

    // An admin's address sticks through later hellos.
    const bad = await request.put(`/api/fleet/servers/${id}/address`, {
      headers: getAuthHeader(),
      data: { host: 'not a host', port: 27015 },
    });
    expect(bad.status()).toBe(400);
    const set = await request.put(`/api/fleet/servers/${id}/address`, {
      headers: getAuthHeader(),
      data: { host: 'play.example.com', port: 27200 },
    });
    expect(set.status(), await set.text()).toBe(200);
    expect(await set.json()).toMatchObject({ address: 'play.example.com:27200', override: true });
    client.close();
    client = await connected(installId, id, token, {
      hostname: 'cs2',
      game_port: 27055,
      public_addr: '198.51.100.8:27055',
    });
    await expect.poll(async () => (await listed(request, id)).connect?.source).toBe('override');
    expect(await cs2Row(request, id)).toMatchObject({ host: 'play.example.com', port: 27200, hostOverride: true });

    // Back to automatic: the detected address right away.
    const auto = await request.put(`/api/fleet/servers/${id}/address`, { headers: getAuthHeader(), data: { host: null } });
    expect(auto.status(), await auto.text()).toBe(200);
    expect(await auto.json()).toMatchObject({ address: '198.51.100.8:27055', override: false });
    expect(await cs2Row(request, id)).toMatchObject({ host: '198.51.100.8', port: 27055, hostOverride: false });
  });

  test('link with an address sets it by hand; a bad one is refused; an unlinked server has no address route', async ({
    request,
  }) => {
    const installId = newInstallId();
    const res = await enroll(request, { key: key.value }, installId, { host: { hostname: 'cs2', game_port: 27055 } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.server_id;
    cleanup.push(async () => {
      await request.delete(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader() });
    });

    const notLinked = await request.put(`/api/fleet/servers/${id}/address`, {
      headers: getAuthHeader(),
      data: { host: 'play.example.com' },
    });
    expect(notLinked.status()).toBe(404);
    const refused = await request.post(`/api/fleet/servers/${id}/link`, {
      headers: getAuthHeader(),
      data: { host: 'cs2:27055' },
    });
    expect(refused.status()).toBe(400);
    const linked = await request.post(`/api/fleet/servers/${id}/link`, {
      headers: getAuthHeader(),
      data: { host: 'play.example.com' },
    });
    expect([200, 201], await linked.text()).toContain(linked.status());
    // No port given: the server's game port.
    expect(await cs2Row(request, id)).toMatchObject({ host: 'play.example.com', port: 27055, hostOverride: true });
    expect((await listed(request, id)).connect).toMatchObject({ address: 'play.example.com:27055', source: 'override' });
  });
  test('the server status route answers a linked Ready Up server from the fleet link, not RCON', async ({
    request,
  }) => {
    const installId = newInstallId();
    const res = await enroll(request, { key: key.value }, installId, { host: { hostname: 'cs2', game_port: 27056 } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { server_id: id, token } = res.body;
    cleanup.push(async () => {
      await request.delete(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader() });
    });
    const client = await connected(installId, id, token, { hostname: 'cs2', game_port: 27056 });
    const link = await request.post(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader(), data: {} });
    expect([200, 201], await link.text()).toContain(link.status());

    const status = async () =>
      (await (await request.get(`/api/servers/${id}/status`, { headers: getAuthHeader() })).json()) as {
        status: string;
        isAvailable: boolean;
        currentMatch: string | null;
      };
    expect(await status()).toMatchObject({ status: 'online', isAvailable: true, currentMatch: null });
    client.close();
    await expect.poll(async () => (await status()).status).toBe('offline');
  });

  test('rename: the fleet server and the row it plays matches as get the new name', async ({ request }) => {
    const installId = newInstallId();
    const res = await enroll(request, { key: key.value }, installId, { host: { hostname: 'cs2', game_port: 27055 } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.server_id;
    cleanup.push(async () => {
      await request.delete(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader() });
    });

    // Not linked yet: only the fleet server has a name.
    const first = await request.patch(`/api/fleet/servers/${id}`, {
      headers: getAuthHeader(),
      data: { name: 'Practice server #1' },
    });
    expect(first.ok(), await first.text()).toBe(true);
    expect((await listed(request, id)).name).toBe('Practice server #1');

    const linked = await request.post(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader(), data: {} });
    expect([200, 201], await linked.text()).toContain(linked.status());
    const renamed = await request.patch(`/api/fleet/servers/${id}`, {
      headers: getAuthHeader(),
      data: { name: 'Main stage' },
    });
    expect(renamed.ok(), await renamed.text()).toBe(true);
    expect((await listed(request, id)).name).toBe('Main stage');
    expect(((await cs2Row(request, id)) as { name?: string }).name).toBe('Main stage');

    const empty = await request.patch(`/api/fleet/servers/${id}`, { headers: getAuthHeader(), data: { name: '  ' } });
    expect(empty.status()).toBe(400);
  });
});
