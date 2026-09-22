import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Service tokens against the running API.
 *
 * These deliberately never sign in. The whole point of a service token is that
 * a Discord bot or a cron job has no Steam login and no browser session, so a
 * test that authenticated first would prove nothing — the `request` fixture
 * gets a clean cookie jar per test, and every call here carries a token or
 * nothing at all.
 *
 * The token values come from the environment the stack was started with; see
 * scripts/test-e2e-*.sh and the CI workflow, which set both variables.
 *
 * @tag api
 * @tag auth
 */

const ADMIN_TOKEN = (process.env.API_TOKENS || 'ci-admin:ci-admin-token-0123456789abcdef')
  .split(/[\s,;]+/)[0]
  .split(':')
  .slice(1)
  .join(':');

const READONLY_TOKEN = (
  process.env.API_TOKENS_READONLY || 'ci-readonly:ci-readonly-token-0123456789abcdef'
)
  .split(/[\s,;]+/)[0]
  .split(':')
  .slice(1)
  .join(':');

/** An admin-guarded read. Chosen because it changes nothing. */
const ADMIN_READ_PATH = '/api/settings';
/** An admin-guarded write. Never reached when scope check rejects first. */
const ADMIN_WRITE_PATH = '/api/teams';

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

test.describe('service token authentication', () => {
  test('an admin token reads an admin endpoint with no session at all', {
    tag: ['@api', '@auth'],
  }, async ({ request }) => {
    const response = await request.get(ADMIN_READ_PATH, { headers: bearer(ADMIN_TOKEN) });

    expect(response.status()).toBe(200);
  });

  test('the same endpoint refuses an unauthenticated request', {
    tag: ['@api', '@auth'],
  }, async ({ request }) => {
    // Guards against the test above passing for the wrong reason — i.e. the
    // endpoint having quietly become public.
    const response = await request.get(ADMIN_READ_PATH);

    expect(response.status()).toBe(401);
  });

  test('X-API-Token works as well as Authorization: Bearer', {
    tag: ['@api', '@auth'],
  }, async ({ request }) => {
    const response = await request.get(ADMIN_READ_PATH, {
      headers: { 'X-API-Token': ADMIN_TOKEN },
    });

    expect(response.status()).toBe(200);
  });

  test('an admin token can write, and clean up after itself', {
    tag: ['@api', '@auth'],
  }, async ({ request }) => {
    const id = `svc-token-team-${Date.now()}`;

    const created = await request.post(ADMIN_WRITE_PATH, {
      headers: bearer(ADMIN_TOKEN),
      data: {
        id,
        name: `Service Token Team ${id}`,
        players: [{ steamId: '76561198000000001', name: 'Player 1' }],
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();

    const deleted = await request.delete(`/api/teams/${id}`, { headers: bearer(ADMIN_TOKEN) });
    expect(deleted.ok()).toBeTruthy();
  });

  test('a read-only token reads but cannot write', {
    tag: ['@api', '@auth'],
  }, async ({ request }) => {
    const read = await request.get(ADMIN_READ_PATH, { headers: bearer(READONLY_TOKEN) });
    expect(read.status()).toBe(200);

    // 403, not 401: the token is fine, the scope is not. A bot author needs to
    // tell "rotate my secret" apart from "ask for a wider scope".
    const write = await request.post(ADMIN_WRITE_PATH, {
      headers: bearer(READONLY_TOKEN),
      data: { id: 'should-never-exist', name: 'Should Never Exist', players: [] },
    });
    expect(write.status()).toBe(403);
    expect((await write.json()).error).toContain('read-only');

    // The rejection happened in middleware, so nothing was created.
    const check = await request.get('/api/teams/should-never-exist', {
      headers: bearer(ADMIN_TOKEN),
    });
    expect(check.status()).toBe(404);
  });

  test('an unknown token is rejected outright', {
    tag: ['@api', '@auth'],
  }, async ({ request }) => {
    const response = await request.get(ADMIN_READ_PATH, {
      headers: bearer('definitely-not-a-configured-token-0123456789'),
    });

    expect(response.status()).toBe(401);
  });

  test('a bad token does not fall back to a valid session', {
    tag: ['@api', '@auth'],
  }, async ({ request }) => {
    // Sign in properly, then present a wrong token on top. Falling through to
    // the session here would mean a bot with a rotated-out secret keeps working
    // whenever it happens to hold a cookie, and would report "not signed in"
    // for what is really a bad token.
    expect(await signInViaRequest(request)).toBeTruthy();

    const withSessionOnly = await request.get(ADMIN_READ_PATH);
    expect(withSessionOnly.status()).toBe(200);

    const withBadToken = await request.get(ADMIN_READ_PATH, {
      headers: bearer('definitely-not-a-configured-token-0123456789'),
    });
    expect(withBadToken.status()).toBe(401);
  });

  test('an empty Authorization header still falls through to session auth', {
    tag: ['@api', '@auth'],
  }, async ({ request }) => {
    // Several helpers send `Authorization: ''`. That has to read as "no token
    // presented" rather than "invalid token", or every one of those callers
    // breaks.
    expect(await signInViaRequest(request)).toBeTruthy();

    const response = await request.get(ADMIN_READ_PATH, { headers: { Authorization: '' } });
    expect(response.status()).toBe(200);
  });
});

test.describe('service token identity', () => {
  test('admin/me reports the token label and scope', {
    tag: ['@api', '@auth'],
  }, async ({ request }) => {
    const response = await request.get('/api/auth/admin/me', { headers: bearer(ADMIN_TOKEN) });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.authenticated).toBe(true);
    expect(body.provider).toBe('service-token');
    expect(body.steamId).toBeNull();
    expect(body.serviceToken.scope).toBe('admin');
    expect(body.serviceToken.label).toBeTruthy();
    // The response must never echo the secret back.
    expect(JSON.stringify(body)).not.toContain(ADMIN_TOKEN);
  });

  test('admin/me reports readonly scope for a readonly token', {
    tag: ['@api', '@auth'],
  }, async ({ request }) => {
    const response = await request.get('/api/auth/admin/me', { headers: bearer(READONLY_TOKEN) });

    const body = await response.json();
    expect(body.authenticated).toBe(true);
    expect(body.serviceToken.scope).toBe('readonly');
  });

  test('admin/me explains a bad token rather than saying "not signed in"', {
    tag: ['@api', '@auth'],
  }, async ({ request }: { request: APIRequestContext }) => {
    const response = await request.get('/api/auth/admin/me', {
      headers: bearer('definitely-not-a-configured-token-0123456789'),
    });

    const body = await response.json();
    expect(body.authenticated).toBe(false);
    expect(body.reason).toBe('invalid_service_token');
  });
});
