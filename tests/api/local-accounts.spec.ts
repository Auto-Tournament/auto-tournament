import { test, expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Local accounts an admin manages (api/src/routes/localAdmin.ts,
 * localAccountsRouter): create, sign in, make admin, set a password, remove.
 *
 * @tag api
 * @tag auth
 */

const TAGS = { tag: ['@api', '@auth'] };
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

function fresh(playwright: PlaywrightWorkerArgs['playwright']) {
  return playwright.request.newContext({ baseURL: BASE });
}

test.describe.serial('local accounts', () => {
  const user = `e2e-acct-${Date.now().toString(36)}`;
  const password = 'a long first passphrase';
  const next = 'a different second passphrase';

  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const on = await request.put('/api/sign-in-providers/admin-access', {
      data: { localAdminLoginEnabled: true },
    });
    expect(on.status(), await on.text()).toBe(200);
  });

  test(
    'an admin creates a player account; it signs in as a regular player',
    TAGS,
    async ({ request, playwright }) => {
      const created = await request.post('/api/local-accounts', {
        data: { username: user, password, name: 'E2E Player' },
      });
      expect(created.status(), await created.text()).toBe(201);
      const { account } = (await created.json()) as {
        account: { username: string; isAdmin: boolean; name: string };
      };
      expect(account).toMatchObject({ username: user, isAdmin: false, name: 'E2E Player' });

      expect(
        (await request.post('/api/local-accounts', { data: { username: user, password } })).status()
      ).toBe(409);
      expect(
        (await request.post('/api/local-accounts', { data: { username: 'A!', password } })).status()
      ).toBe(400);
      expect(
        (
          await request.post('/api/local-accounts', {
            data: { username: `${user}x`, password: '' },
          })
        ).status()
      ).toBe(400);

      const list = (await (await request.get('/api/local-accounts')).json()) as {
        accounts: { username: string }[];
      };
      expect(list.accounts.map((a) => a.username)).toContain(user);

      const anon = await fresh(playwright);
      const login = await anon.post('/api/auth/local/login', {
        data: { username: user, password },
      });
      expect(login.status(), await login.text()).toBe(200);
      expect((await (await anon.get('/api/auth/admin/me')).json()).authenticated).toBeFalsy();
      await anon.dispose();
    }
  );

  test(
    'an admin makes it an admin, then sets a new password',
    TAGS,
    async ({ request, playwright }) => {
      const made = await request.put(`/api/local-accounts/${user}`, { data: { isAdmin: true } });
      expect(made.status(), await made.text()).toBe(200);
      expect(((await made.json()) as { account: { isAdmin: boolean } }).account.isAdmin).toBe(true);

      const reset = await request.put(`/api/local-accounts/${user}/password`, {
        data: { password: next },
      });
      expect(reset.status(), await reset.text()).toBe(200);

      const anon = await fresh(playwright);
      expect(
        (await anon.post('/api/auth/local/login', { data: { username: user, password } })).status()
      ).toBe(401);
      expect(
        (
          await anon.post('/api/auth/local/login', { data: { username: user, password: next } })
        ).status()
      ).toBe(200);
      expect((await (await anon.get('/api/auth/admin/me')).json()).authenticated).toBe(true);
      await anon.dispose();
    }
  );

  test(
    'removing the account stops its sign-in; players and outsiders cannot manage accounts',
    TAGS,
    async ({ request, playwright }) => {
      expect(
        (await request.put(`/api/local-accounts/${user}`, { data: { isAdmin: false } })).status()
      ).toBe(200);
      expect((await request.delete(`/api/local-accounts/${user}`)).status()).toBe(200);
      expect((await request.delete(`/api/local-accounts/${user}`)).status()).toBe(404);

      const anon = await fresh(playwright);
      expect(
        (
          await anon.post('/api/auth/local/login', { data: { username: user, password: next } })
        ).status()
      ).toBe(401);
      expect((await anon.get('/api/local-accounts')).status()).toBe(401);
      expect(
        (
          await request.post('/api/local-accounts', {
            data: { username: `${user}y`, password },
            headers: { Origin: 'https://evil.example' },
          })
        ).status()
      ).toBe(403);
      await anon.dispose();
    }
  );
});
