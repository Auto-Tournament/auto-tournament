import { test, expect, request as playwrightRequest } from '@playwright/test';
import { playerCookieOnlyContext, signInViaRequest } from '../helpers/auth';

/**
 * An admin account's player cookie, without the session, cannot be used to
 * attach a sign-in method or an email to that account: either would later sign
 * in (or reset the password) as the admin.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@auth', '@security'] };

const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const codeFor = (profile: object) =>
  Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');

async function adminPair(playwright: Parameters<typeof playerCookieOnlyContext>[0]) {
  const steamId = `7656119${digits(10)}`;
  const admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
  expect(await signInViaRequest(admin, steamId)).toBe(true);
  const cookieOnly = await playerCookieOnlyContext(playwright, admin, BASE_URL);
  return { steamId, admin, cookieOnly };
}

async function linkedSteamIds(admin: Awaited<ReturnType<typeof adminPair>>['admin'], id: string) {
  const res = await admin.get(`/api/test/auth-identities?provider=github&providerUserId=${id}`);
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { steamIds: string[] }).steamIds;
}

test.describe('admin account without a session', () => {
  test(
    'finishing a sign-in with the cookie links nothing and signs nobody in as admin',
    TAGS,
    async ({ playwright }) => {
      const { admin, cookieOnly } = await adminPair(playwright);
      try {
        const start = await cookieOnly.get('/api/test/oauth/github', { maxRedirects: 0 });
        test.skip(start.status() !== 302, 'fake GitHub provider is not available');
        const state = new URL(start.headers()['location'] ?? '').searchParams.get('state') ?? '';
        const id = `${1 + Math.floor(Math.random() * 9)}${digits(7)}`;
        const query = new URLSearchParams({
          code: codeFor({ id: Number(id), login: `octo${id}`, name: 'Octo' }),
          state,
        });
        await cookieOnly.get(`/api/test/oauth/github/callback?${query}`, { maxRedirects: 0 });

        expect((await (await cookieOnly.get('/api/auth/admin/me')).json()).authenticated).toBe(
          false
        );
        expect(await linkedSteamIds(admin, id)).toEqual([]);
      } finally {
        await cookieOnly.dispose();
        await admin.dispose();
      }
    }
  );

  test('starting a provider link needs the session', TAGS, async ({ playwright }) => {
    const { admin, cookieOnly } = await adminPair(playwright);
    try {
      const withCookie = await cookieOnly.post('/api/test/oauth/github/link', { maxRedirects: 0 });
      test.skip(withCookie.status() === 404, 'fake GitHub provider is not available');
      expect(withCookie.status()).toBe(401);
      const withSession = await admin.post('/api/test/oauth/github/link', { maxRedirects: 0 });
      expect(withSession.status()).toBe(302);
    } finally {
      await cookieOnly.dispose();
      await admin.dispose();
    }
  });

  test('setting an email needs the session', TAGS, async ({ playwright }) => {
    const { admin, cookieOnly } = await adminPair(playwright);
    try {
      const email = `a${digits(8)}@example.com`;
      const put = await cookieOnly.put('/api/me/email', { data: { email } });
      expect(put.status()).toBe(401);
      const notifications = await cookieOnly.put('/api/me/email/notifications', {
        data: { enabled: true },
      });
      expect(notifications.status()).toBe(401);
      const remove = await cookieOnly.delete('/api/me/email');
      expect(remove.status()).toBe(401);
      const withSession = await admin.put('/api/me/email', { data: { email } });
      expect(withSession.status()).not.toBe(401);
    } finally {
      await cookieOnly.dispose();
      await admin.dispose();
    }
  });

  test('removing a sign-in method needs the session', TAGS, async ({ playwright }) => {
    const { admin, cookieOnly } = await adminPair(playwright);
    try {
      const withCookie = await cookieOnly.post('/api/me/connections/github/remove', { data: {} });
      expect(withCookie.status()).toBe(401);
      const withSession = await admin.post('/api/me/connections/github/remove', { data: {} });
      expect(withSession.status()).not.toBe(401);
    } finally {
      await cookieOnly.dispose();
      await admin.dispose();
    }
  });

  test(
    'a plain player keeps linking and email with the cookie alone',
    TAGS,
    async ({ playwright }) => {
      const player = await playwrightRequest.newContext({ baseURL: BASE_URL });
      try {
        const login = await player.post('/api/test/login-player', { data: {} });
        expect(login.ok()).toBe(true);
        const cookieOnly = await playerCookieOnlyContext(playwright, player, BASE_URL);
        try {
          const get = await cookieOnly.get('/api/me/email');
          expect(get.status()).toBe(200);
          const put = await cookieOnly.put('/api/me/email/notifications', {
            data: { enabled: false },
          });
          expect(put.status()).not.toBe(401);
        } finally {
          await cookieOnly.dispose();
        }
      } finally {
        await player.dispose();
      }
    }
  );
});
