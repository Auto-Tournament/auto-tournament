import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  createFleetKey,
  createPendingServer,
  enroll,
  newInstallId,
  resetEnrollRateLimit,
  wsUrl,
} from '../helpers/fleet';
import { validateEnrollResponse } from '../../api/src/integrations/cs2/fleet/protocol/v1';

/**
 * Ready Up fleet enrollment (FLEET.md §4.1-4.3, D2, D3), through the API:
 *
 * - a one-time code enrolls exactly one server, once;
 * - a fleet key enrolls many; the same install_id gets its record back and a
 *   new token (the old one stops working);
 * - key limits, revocation, and the lock after repeated wrong secrets;
 * - the admin endpoints need an admin, and never return hashes or secrets
 *   after creation;
 * - revoking a server kills its token and keeps it from re-enrolling by key.
 *
 * Token acceptance is checked by opening the fleet WebSocket (./fleet-gateway
 * covers the socket itself).
 *
 * @tag api
 */

async function tokenCloseCode(token: string): Promise<number | 'open'> {
  const { default: WebSocket } = await import('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(), { headers: { Authorization: `Bearer ${token}` } });
    // An accepted token leaves the socket open, waiting for hello.
    const timer = setTimeout(() => {
      ws.close();
      resolve('open');
    }, 1500);
    ws.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 1005 ? 'open' : code);
    });
    ws.on('error', reject);
  });
}

test.describe.serial('Fleet enrollment', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test('admin endpoints require an admin', async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    for (const [method, url] of [
      ['get', '/api/fleet/servers'],
      ['post', '/api/fleet/servers'],
      ['get', '/api/fleet/keys'],
      ['post', '/api/fleet/keys'],
    ] as const) {
      const res = await anon[method](url, { data: {} });
      expect(res.status(), `${method} ${url}`).toBe(401);
    }
    // Enrollment itself is public: a bad body is a 400, not a 401.
    const res = await anon.post('/api/fleet/enroll', { data: {} });
    expect(res.status()).toBe(400);
    await anon.dispose();
  });

  test('one-time code: enrolls once, then is spent', async ({ request }) => {
    const { serverId, code } = await createPendingServer(request, 'code-server');
    expect(code).toMatch(/^RUE-(?:[0-9A-Z]{4}-){3}[0-9A-Z]{4}$/);

    // The pending server is listed, without its code.
    let list = await (await request.get('/api/fleet/servers')).json();
    const pending = list.servers.find((s: { id: string }) => s.id === serverId);
    expect(pending.status).toBe('pending');
    expect(pending.codeExpiresAt).toBeGreaterThan(Date.now() / 1000);
    expect(JSON.stringify(list)).not.toContain(code);

    const installId = newInstallId();
    const first = await enroll(request, { code: code.toLowerCase() }, installId);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(validateEnrollResponse(first.body)).toEqual({ ok: true, errors: [] });
    expect(first.body.server_id).toBe(serverId);
    expect(first.body.reenrolled).toBe(false);
    expect(first.body.ws_url).toMatch(/^ws:\/\/.+\/api\/fleet\/ws$/);
    expect(await tokenCloseCode(first.body.token)).toBe('open');

    // Spent.
    const again = await enroll(request, { code }, newInstallId());
    expect(again.status).toBe(401);
    expect(again.body.code).toBe('invalid_code');

    list = await (await request.get('/api/fleet/servers')).json();
    const enrolled = list.servers.find((s: { id: string }) => s.id === serverId);
    expect(enrolled.status).toBe('enrolled');
    expect(enrolled.installId).toBe(installId);
    expect(enrolled.enrolledVia).toBe('code');
    expect(enrolled.versions.cs2_build).toBe(14032);
    expect(enrolled.token.id).toBe(first.body.token.split('_')[1]);
    expect(JSON.stringify(list)).not.toContain(first.body.token);
    expect(JSON.stringify(list)).not.toMatch(/secret|hash/i);
  });

  test('a wrong code is refused', async ({ request }) => {
    const res = await enroll(request, { code: 'RUE-0000-0000-0000-0000' }, newInstallId());
    expect(res.status).toBe(401);
    const bad = await enroll(request, { code: 'nonsense' }, newInstallId());
    expect(bad.status).toBe(401);
  });

  test('fleet key: many servers; the same install_id gets its record back', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'csm-key', namePrefix: 'lan-' });
    expect(key.value).toMatch(/^rfk_[0-9a-z]{12}_[A-Za-z0-9_-]{43}$/);

    const a = newInstallId();
    const b = newInstallId();
    const ea = await enroll(request, { key: key.value }, a, { name: 'server-1' });
    const eb = await enroll(request, { key: key.value }, b, { name: 'server-2' });
    expect(ea.status).toBe(201);
    expect(eb.status).toBe(201);
    expect(ea.body.server_id).not.toBe(eb.body.server_id);
    expect(ea.body.name).toBe('lan-server-1');

    // Enroll again with the same install_id: same record, new token, old token dead.
    const again = await enroll(request, { key: key.value }, a, { name: 'renamed' });
    expect(again.status).toBe(201);
    expect(again.body.server_id).toBe(ea.body.server_id);
    expect(again.body.reenrolled).toBe(true);
    expect(again.body.name).toBe('lan-server-1');
    expect(again.body.token).not.toBe(ea.body.token);
    expect(await tokenCloseCode(ea.body.token)).toBe(4403);
    expect(await tokenCloseCode(again.body.token)).toBe('open');

    const keys = await (await request.get('/api/fleet/keys')).json();
    const listed = keys.keys.find((k: { id: string }) => k.id === key.id);
    expect(listed.enrolledServers).toBe(2);
    expect(listed.useCount).toBe(3);
    expect(JSON.stringify(keys)).not.toContain(key.value);

    // Revoking the key stops new enrollments but not the servers it enrolled.
    expect((await request.delete(`/api/fleet/keys/${key.id}`)).ok()).toBe(true);
    const after = await enroll(request, { key: key.value }, newInstallId());
    expect(after.status).toBe(403);
    expect(after.body.code).toBe('key_revoked');
    expect(await tokenCloseCode(eb.body.token)).toBe('open');
  });

  test('fleet key limit', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'one-only', maxServers: 1 });
    expect((await enroll(request, { key: key.value }, newInstallId())).status).toBe(201);
    const second = await enroll(request, { key: key.value }, newInstallId());
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('key_limit');
  });

  test('a key is locked after 5 wrong secrets', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'lock-me' });
    const wrong = `${key.value.slice(0, 17)}${'A'.repeat(43)}`;
    for (let i = 0; i < 5; i++) {
      const res = await enroll(request, { key: wrong }, newInstallId());
      expect(res.status).toBe(401);
    }
    const locked = await enroll(request, { key: key.value }, newInstallId());
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe('key_locked');
    const keys = await (await request.get('/api/fleet/keys')).json();
    expect(keys.keys.find((k: { id: string }) => k.id === key.id).locked).toBe(true);
  });

  test('enrollment is rate limited per IP', async ({ request }) => {
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const res = await enroll(request, { code: 'RUE-0000-0000-0000-0000' }, newInstallId());
      if (res.status === 429) limited++;
    }
    expect(limited).toBe(2);
  });

  test('revoke: the token dies and the server cannot re-enroll by key', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'revoke-test' });
    const installId = newInstallId();
    const enrolled = await enroll(request, { key: key.value }, installId);
    expect(enrolled.status).toBe(201);

    const res = await request.post(`/api/fleet/servers/${enrolled.body.server_id}/revoke`);
    expect(res.ok()).toBe(true);
    expect((await res.json()).server.status).toBe('revoked');
    expect(await tokenCloseCode(enrolled.body.token)).toBe(4403);

    const again = await enroll(request, { key: key.value }, installId);
    expect(again.status).toBe(403);
    expect(again.body.code).toBe('server_revoked');

    // Deleting the record lets it enroll again, as a new server.
    expect((await request.delete(`/api/fleet/servers/${enrolled.body.server_id}`)).ok()).toBe(true);
    const fresh = await enroll(request, { key: key.value }, installId);
    expect(fresh.status).toBe(201);
    expect(fresh.body.server_id).not.toBe(enrolled.body.server_id);
  });

  test('a code for an install that already has a record reuses it', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'reuse' });
    const installId = newInstallId();
    const byKey = await enroll(request, { key: key.value }, installId);
    const { serverId: placeholder, code } = await createPendingServer(request, 'placeholder');
    const byCode = await enroll(request, { code }, installId);
    expect(byCode.status).toBe(201);
    expect(byCode.body.server_id).toBe(byKey.body.server_id);
    expect(byCode.body.reenrolled).toBe(true);
    const list = await (await request.get('/api/fleet/servers')).json();
    expect(list.servers.some((s: { id: string }) => s.id === placeholder)).toBe(false);
  });
});
