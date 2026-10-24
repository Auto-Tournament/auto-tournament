import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Only a root admin (utils/rootAccess.ts: an admin API token, a local admin
 * account, a listed admin Steam ID) changes who is root: the Admin Steam IDs
 * list, and local accounts that are or become admins. Other admins get 403.
 *
 * @tag api
 * @tag auth
 */

const TAGS = { tag: ['@api', '@auth'] };
const ADMIN_TOKEN = (process.env.API_TOKENS || 'ci-admin:ci-admin-token-0123456789abcdef')
  .split(',')[0]
  .split(':')
  .slice(1)
  .join(':');
const ROOT = { Authorization: `Bearer ${ADMIN_TOKEN}` };
/** Signed in through the test helper; not on the Admin Steam IDs list. */
const PLAIN_ADMIN = '76561198000000071';

async function plainAdmin(request: APIRequestContext): Promise<void> {
  expect(await signInViaRequest(request, PLAIN_ADMIN)).toBe(true);
  expect((await (await request.get('/api/auth/me')).json()).root).toBe(false);
}

test.describe.serial('root-only grants', () => {
  const user = `e2e-root-${Date.now().toString(36)}`;
  const password = 'a long root-only passphrase';

  test.beforeAll(async ({ request }) => {
    const on = await request.put('/api/sign-in-providers/admin-access', {
      headers: ROOT,
      data: { localAdminLoginEnabled: true },
    });
    expect(on.status(), await on.text()).toBe(200);
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`/api/local-accounts/${user}`, { headers: ROOT });
    await request.delete(`/api/local-accounts/${user}a`, { headers: ROOT });
    await request.delete(`/api/local-accounts/${user}p`, { headers: ROOT });
    for (const id of [`local-${user}-new`, `local-${user}-bulk`]) {
      await request.delete(`/api/players/${id}`, { headers: ROOT });
    }
  });

  test(
    'Admin Steam IDs: root only; other fields stay open to admins',
    TAGS,
    async ({ request }) => {
      await plainAdmin(request);
      const view = (await (await request.get('/api/sign-in-providers/admin-access')).json()) as {
        adminSteamIds: string;
        adminEmails: string;
      };
      const ids = await request.put('/api/sign-in-providers/admin-access', {
        data: { adminSteamIds: `${view.adminSteamIds}\n${PLAIN_ADMIN}`.trim() },
      });
      expect(ids.status(), await ids.text()).toBe(403);
      const emails = await request.put('/api/sign-in-providers/admin-access', {
        data: { adminEmails: view.adminEmails },
      });
      expect(emails.status(), await emails.text()).toBe(200);
      expect((await (await request.get('/api/auth/me')).json()).root).toBe(false);

      const asRoot = await request.put('/api/sign-in-providers/admin-access', {
        headers: ROOT,
        data: { adminSteamIds: view.adminSteamIds },
      });
      expect(asRoot.status(), await asRoot.text()).toBe(200);
    }
  );

  test(
    'local admin accounts: root only to create, grant or set a password',
    TAGS,
    async ({ request }) => {
      await plainAdmin(request);
      const admin = await request.post('/api/local-accounts', {
        data: { username: `${user}a`, password, isAdmin: true },
      });
      expect(admin.status(), await admin.text()).toBe(403);

      const player = await request.post('/api/local-accounts', {
        data: { username: user, password },
      });
      expect(player.status(), await player.text()).toBe(201);
      const grant = await request.put(`/api/local-accounts/${user}`, { data: { isAdmin: true } });
      expect(grant.status(), await grant.text()).toBe(403);
      const playerPassword = await request.put(`/api/local-accounts/${user}/password`, {
        data: { password: `${password} two` },
      });
      expect(playerPassword.status(), await playerPassword.text()).toBe(200);

      const rootGrant = await request.put(`/api/local-accounts/${user}`, {
        headers: ROOT,
        data: { isAdmin: true },
      });
      expect(rootGrant.status(), await rootGrant.text()).toBe(200);
      const adminPassword = await request.put(`/api/local-accounts/${user}/password`, {
        data: { password: `${password} three` },
      });
      expect(adminPassword.status(), await adminPassword.text()).toBe(403);
      const revoke = await request.put(`/api/local-accounts/${user}`, { data: { isAdmin: false } });
      expect(revoke.status(), await revoke.text()).toBe(200);

      const rootCreate = await request.post('/api/local-accounts', {
        headers: ROOT,
        data: { username: `${user}a`, password, isAdmin: true },
      });
      expect(rootCreate.status(), await rootCreate.text()).toBe(201);
    }
  );

  test('players API: root only to make a local account an admin', TAGS, async ({ request }) => {
    await plainAdmin(request);
    const created = await request.post('/api/local-accounts', {
      data: { username: `${user}p`, password },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { playerId } = (await created.json()).account as { playerId: string };
    expect(playerId.startsWith('local-')).toBe(true);

    const grant = await request.put(`/api/players/${playerId}`, { data: { isAdmin: true } });
    expect(grant.status(), await grant.text()).toBe(403);
    expect((await (await request.get(`/api/players/${playerId}`)).json()).player.isAdmin).toBe(
      false
    );

    const create = await request.post('/api/players', {
      data: { id: `local-${user}-new`, name: 'Local new', isAdmin: true },
    });
    expect(create.status(), await create.text()).toBe(403);
    const bulk = await request.post('/api/players/bulk-import', {
      data: [{ id: `local-${user}-bulk`, name: 'Local bulk', isAdmin: true }],
    });
    expect(bulk.status(), await bulk.text()).toBe(403);
    expect((await request.get(`/api/players/local-${user}-new`)).status()).toBe(404);
    expect((await request.get(`/api/players/local-${user}-bulk`)).status()).toBe(404);

    const rename = await request.put(`/api/players/${playerId}`, { data: { name: 'Renamed' } });
    expect(rename.status(), await rename.text()).toBe(200);

    const rootGrant = await request.put(`/api/players/${playerId}`, {
      headers: ROOT,
      data: { isAdmin: true },
    });
    expect(rootGrant.status(), await rootGrant.text()).toBe(200);
    const revoke = await request.put(`/api/players/${playerId}`, { data: { isAdmin: false } });
    expect(revoke.status(), await revoke.text()).toBe(200);
  });

  test(
    'API tokens made in Settings: an admin-scope one is root only',
    TAGS,
    async ({ request }) => {
      await plainAdmin(request);
      const admin = await request.post('/api/settings/api-tokens', {
        data: { label: `e2e-root-token-${Date.now()}`, scope: 'admin' },
      });
      expect(admin.status(), await admin.text()).toBe(403);
      const readonly = await request.post('/api/settings/api-tokens', {
        data: { label: `e2e-ro-token-${Date.now()}`, scope: 'readonly' },
      });
      expect(readonly.status(), await readonly.text()).toBe(201);
      const made = (await readonly.json()) as { id?: number; token?: { id?: number } };
      const id = made.id ?? made.token?.id;
      if (id !== undefined) await request.delete(`/api/settings/api-tokens/${id}`);
    }
  );
});
