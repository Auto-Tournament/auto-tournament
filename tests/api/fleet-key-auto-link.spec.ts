import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { FleetTestClient, createFleetKey, enroll, newInstallId, resetEnrollRateLimit } from '../helpers/fleet';

/**
 * A fleet key set to auto-link (`autoLink` on `POST /api/fleet/keys`): a
 * Ready Up server it enrolled is linked for matches on its first hello, once.
 * An admin's unlink or deleting the server afterwards sticks through later
 * hellos. A key revoked or expired since enrollment links nothing. Without
 * the setting, enrolled servers wait for an admin's "Use for matches".
 *
 * @tag api
 * @tag fleet
 */

interface ListedKey {
  id: string;
  autoLink: boolean;
}

async function linkedServerId(request: APIRequestContext, id: string): Promise<string | null> {
  const res = await request.get('/api/fleet/servers', { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBeTruthy();
  const server = (await res.json()).servers.find((s: { id: string }) => s.id === id);
  expect(server, `fleet server ${id} listed`).toBeTruthy();
  return server.linkedServerId;
}

async function listedKey(request: APIRequestContext, id: string): Promise<ListedKey> {
  const res = await request.get('/api/fleet/keys', { headers: getAuthHeader() });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).keys.find((k: ListedKey) => k.id === id);
}

test.describe.serial('Fleet key auto-link', () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    await resetEnrollRateLimit(request);
  });

  test.afterEach(async () => {
    while (cleanup.length) await cleanup.pop()?.();
  });

  async function enrollServer(request: APIRequestContext, keyValue: string): Promise<{
    id: string;
    hello: () => Promise<void>;
  }> {
    const installId = newInstallId();
    const res = await enroll(request, { key: keyValue }, installId);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const { server_id: id, token } = res.body;
    cleanup.push(async () => {
      await request.delete(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader() });
    });
    let client: FleetTestClient | null = null;
    cleanup.push(() => client?.close());
    const hello = async () => {
      client?.close();
      client = await FleetTestClient.connect(token);
      await client.handshake(id, installId);
    };
    return { id, hello };
  }

  async function enrollAndHello(request: APIRequestContext, keyValue: string) {
    const server = await enrollServer(request, keyValue);
    await server.hello();
    return server;
  }

  /** Linking runs after the welcome: give it the time an auto-link takes. */
  async function expectStaysUnlinked(request: APIRequestContext, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await linkedServerId(request, id)).toBeNull();
  }

  test('the key listing says whether a key auto-links; a non-boolean autoLink is refused', async ({ request }) => {
    const on = await createFleetKey(request, { name: 'fleet-auto-link-on', autoLink: true });
    const off = await createFleetKey(request, { name: 'fleet-auto-link-off' });
    expect(await listedKey(request, on.id)).toMatchObject({ autoLink: true });
    expect(await listedKey(request, off.id)).toMatchObject({ autoLink: false });

    for (const autoLink of ['true', 1, {}]) {
      const res = await request.post('/api/fleet/keys', {
        headers: getAuthHeader(),
        data: { name: 'fleet-auto-link-bad', autoLink },
      });
      expect(res.status(), JSON.stringify(autoLink)).toBe(400);
    }
  });

  test('a server enrolled with an auto-link key is linked on its first hello', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'fleet-auto-link', autoLink: true });
    const { id } = await enrollAndHello(request, key.value);
    await expect.poll(() => linkedServerId(request, id)).toBe(id);
  });

  test('a server enrolled with a plain key is not linked', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'fleet-no-auto-link' });
    const { id } = await enrollAndHello(request, key.value);
    await expectStaysUnlinked(request, id);
  });

  test("an admin's unlink sticks through later hellos", async ({ request }) => {
    const key = await createFleetKey(request, { name: 'fleet-auto-link-unlink', autoLink: true });
    const { id, hello } = await enrollAndHello(request, key.value);
    await expect.poll(() => linkedServerId(request, id)).toBe(id);

    const unlink = await request.delete(`/api/fleet/servers/${id}/link`, { headers: getAuthHeader() });
    expect(unlink.ok(), await unlink.text()).toBeTruthy();
    expect(await linkedServerId(request, id)).toBeNull();

    await hello();
    await expectStaysUnlinked(request, id);
  });

  test('deleting the linked server sticks through later hellos', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'fleet-auto-link-delete', autoLink: true });
    const { id, hello } = await enrollAndHello(request, key.value);
    await expect.poll(() => linkedServerId(request, id)).toBe(id);

    const removed = await request.delete(`/api/servers/${id}`, { headers: getAuthHeader() });
    expect(removed.ok(), await removed.text()).toBeTruthy();
    expect(await linkedServerId(request, id)).toBeNull();

    await hello();
    await expectStaysUnlinked(request, id);
  });

  test('a key revoked after the server enrolled does not link it', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'fleet-auto-link-revoked', autoLink: true });
    const { id, hello } = await enrollServer(request, key.value);
    const revoked = await request.delete(`/api/fleet/keys/${key.id}`, { headers: getAuthHeader() });
    expect(revoked.ok(), await revoked.text()).toBeTruthy();

    await hello();
    await expectStaysUnlinked(request, id);
  });

  test('a key expired after the server enrolled does not link it', async ({ request }) => {
    const key = await createFleetKey(request, { name: 'fleet-auto-link-expired', autoLink: true });
    const { id, hello } = await enrollServer(request, key.value);
    const expired = await request.post('/api/test/fleet/expire-key', {
      headers: getAuthHeader(),
      data: { keyId: key.id },
    });
    expect(expired.ok(), await expired.text()).toBeTruthy();

    await hello();
    await expectStaysUnlinked(request, id);
  });
});
