import { test, expect, type APIResponse, type Playwright } from '@playwright/test';

/**
 * Admin access needs the Passport session (or an API token). The signed
 * player_steam_id cookie names a player for player-facing endpoints and never
 * grants admin, whatever the account's is_admin says.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@auth', '@security'] };

function setCookie(res: APIResponse, name: string): string | undefined {
  for (const { name: header, value } of res.headersArray()) {
    if (header.toLowerCase() !== 'set-cookie') continue;
    const [pair] = value.split(';');
    const eq = pair.indexOf('=');
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

async function adminLogin(playwright: Playwright) {
  const ctx = await playwright.request.newContext({ baseURL: BASE_URL });
  const res = await ctx.post('/api/test/login-admin', { data: {} });
  expect(res.ok(), `login-admin failed: ${await res.text()}`).toBe(true);
  return {
    ctx,
    player: setCookie(res, 'player_steam_id'),
    session: setCookie(res, 'at.sid'),
  };
}

test.describe('admin needs a session', () => {
  test(
    'the player cookie of an admin, without a session, is not admin',
    TAGS,
    async ({ playwright }) => {
      const login = await adminLogin(playwright);
      expect(login.player, 'login-admin set no player cookie').toBeTruthy();
      expect(login.session, 'login-admin set no session cookie').toBeTruthy();
      const cookieOnly = await playwright.request.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { Cookie: `player_steam_id=${login.player}` },
      });
      try {
        const guarded = await cookieOnly.get(
          '/api/test/auth-identities?provider=discord&providerUserId=x'
        );
        expect([401, 403]).toContain(guarded.status());

        const me = await (await cookieOnly.get('/api/auth/admin/me')).json();
        expect(me.authenticated).toBe(false);

        const status = await (await cookieOnly.get('/api/auth/admin-status')).json();
        expect(status.isAdmin).toBe(false);

        const self = await (await cookieOnly.get('/api/auth/me')).json();
        expect(self.impersonation).toEqual({ active: false });
      } finally {
        await cookieOnly.dispose();
        await login.ctx.dispose();
      }
    }
  );

  test('the session alone is enough', TAGS, async ({ playwright }) => {
    const login = await adminLogin(playwright);
    const sessionOnly = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Cookie: `at.sid=${login.session}` },
    });
    try {
      const me = await (await sessionOnly.get('/api/auth/admin/me')).json();
      expect(me.authenticated).toBe(true);
      const guarded = await sessionOnly.get(
        '/api/test/auth-identities?provider=discord&providerUserId=x'
      );
      expect(guarded.ok()).toBe(true);
    } finally {
      await sessionOnly.dispose();
      await login.ctx.dispose();
    }
  });

  test('a signed-in jar keeps working', TAGS, async ({ playwright }) => {
    const login = await adminLogin(playwright);
    try {
      const me = await (await login.ctx.get('/api/auth/admin/me')).json();
      expect(me.authenticated).toBe(true);
    } finally {
      await login.ctx.dispose();
    }
  });

  test('a player cookie still identifies a non-admin player', TAGS, async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      const login = await ctx.post('/api/test/login-player', { data: {} });
      expect(login.ok()).toBe(true);
      const me = await (await ctx.get('/api/auth/me')).json();
      expect(me.authenticated).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });

  test(
    'admin-status ignores a session that belongs to someone else',
    TAGS,
    async ({ playwright }) => {
      const idA = `7656119${Math.floor(Math.random() * 1e10)
        .toString()
        .padStart(10, '0')}`;
      const a = await playwright.request.newContext({ baseURL: BASE_URL });
      const b = await adminLogin(playwright);
      try {
        expect((await a.post('/api/test/login-admin', { data: { steamId: idA } })).ok()).toBe(true);
        const demote = await b.ctx.put(`/api/players/${idA}`, { data: { isAdmin: false } });
        expect(demote.ok(), await demote.text()).toBe(true);
        const sessionA = (await a.storageState()).cookies.filter((c) => c.name === 'at.sid');
        const cookieB = (await b.ctx.storageState()).cookies.filter(
          (c) => c.name === 'player_steam_id'
        );
        const mixed = await playwright.request.newContext({
          baseURL: BASE_URL,
          storageState: { cookies: [...sessionA, ...cookieB], origins: [] },
        });
        try {
          const status = await (await mixed.get('/api/auth/admin-status')).json();
          expect(status.isAdmin).toBe(false);
        } finally {
          await mixed.dispose();
        }
      } finally {
        await a.dispose();
        await b.ctx.dispose();
      }
    }
  );
});
