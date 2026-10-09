import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { createFleetKey, enroll, newInstallId, resetEnrollRateLimit } from '../helpers/fleet';

/**
 * A fleet key can turn skins on for the servers it enrolls (fleet/link.ts):
 * the row a server gets when it is first used for matches starts with
 * "Skins on this server" as the key says, unless the key was revoked or has
 * expired by then. A row taken over from an earlier link keeps what an admin
 * set.
 *
 * @tag api
 * @tag fleet
 */

async function enrolledWith(request: APIRequestContext, key: { value: string }): Promise<string> {
  const res = await enroll(request, { key: key.value }, newInstallId());
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.server_id;
}

async function link(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.post(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader(), data: {} });
  expect([200, 201], await res.text()).toContain(res.status());
}

async function skinsOf(request: APIRequestContext, id: string): Promise<boolean> {
  const res = await request.get(`/api/servers/${id}`, { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  return (body.server ?? body).skins;
}

test.describe.serial('fleet key: skins', () => {
  const linked: string[] = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test.afterEach(async ({ request }) => {
    while (linked.length) {
      await request.delete(`/api/fleet/servers/${linked.pop()}/link`, { headers: getAuthHeader() });
    }
  });

  test('the key listing says whether a key turns skins on; skins must be a boolean', async ({ request }) => {
    const on = await createFleetKey(request, { name: 'skins-on', skins: true });
    const off = await createFleetKey(request, { name: 'skins-off' });
    const res = await request.get('/api/fleet/keys', { headers: getAuthHeader() });
    expect(res.ok(), await res.text()).toBeTruthy();
    const keys = (await res.json()).keys as Array<{ id: string; skins: boolean }>;
    expect(keys.find((k) => k.id === on.id)?.skins).toBe(true);
    expect(keys.find((k) => k.id === off.id)?.skins).toBe(false);

    const bad = await request.post('/api/fleet/keys', { headers: getAuthHeader(), data: { name: 'bad', skins: 'yes' } });
    expect(bad.status()).toBe(400);
  });

  test('a server enrolled with a skins key starts with skins on', async ({ request }) => {
    const id = await enrolledWith(request, await createFleetKey(request, { name: 'skins-key', skins: true }));
    linked.push(id);
    await link(request, id);
    expect(await skinsOf(request, id)).toBe(true);
  });

  test('a server enrolled with a key without skins starts with skins off', async ({ request }) => {
    const id = await enrolledWith(request, await createFleetKey(request, { name: 'plain-key' }));
    linked.push(id);
    await link(request, id);
    expect(await skinsOf(request, id)).toBe(false);
  });

  test('a key revoked before the server is linked turns no skins on', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'skins-revoked', skins: true });
    const id = await enrolledWith(request, key);
    linked.push(id);
    const revoke = await request.delete(`/api/fleet/keys/${key.id}`, { headers: getAuthHeader() });
    expect(revoke.ok(), await revoke.text()).toBeTruthy();
    await link(request, id);
    expect(await skinsOf(request, id)).toBe(false);
  });

  test('a key expired before the server is linked turns no skins on', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'skins-expired', skins: true });
    const id = await enrolledWith(request, key);
    linked.push(id);
    const expire = await request.post('/api/test/fleet/expire-key', { headers: getAuthHeader(), data: { keyId: key.id } });
    expect(expire.ok(), await expire.text()).toBeTruthy();
    await link(request, id);
    expect(await skinsOf(request, id)).toBe(false);
  });

  test('an admin turning skins off sticks through unlink and link again', async ({ request }) => {
    const id = await enrolledWith(request, await createFleetKey(request, { name: 'skins-relink', skins: true }));
    linked.push(id);
    await link(request, id);
    expect(await skinsOf(request, id)).toBe(true);

    const off = await request.put(`/api/servers/${id}`, { headers: getAuthHeader(), data: { skins: false } });
    expect(off.ok(), await off.text()).toBeTruthy();
    const unlink = await request.delete(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader() });
    expect(unlink.ok(), await unlink.text()).toBeTruthy();
    await link(request, id);
    expect(await skinsOf(request, id)).toBe(false);
  });
});
