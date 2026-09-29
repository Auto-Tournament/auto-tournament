import { test, expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';
import {
  digestsEqual,
  generateSetupCode,
  hashPassword,
  hashSetupCode,
  normalizeSetupCode,
  normalizeUsername,
  passwordProblem,
  verifyPassword,
} from '../../api/src/utils/localAdminCrypto';
import { base32Decode, base32Encode, totpAt, totpStep, verifyTotp } from '../../api/src/utils/totp';
import { LoginThrottle } from '../../api/src/utils/loginThrottle';
import { parseAdminAccessPatch, shouldImportSetting } from '../../api/src/utils/adminAccessPatch';
import { signInViaRequest } from '../helpers/auth';

/**
 * First-admin setup, local admin login, TOTP, reset-admin and the one-time
 * environment import (api/src/routes/localAdmin.ts,
 * services/localAdminService.ts, services/adminAccessSettings.ts).
 *
 * The real setup code is only logged at boot (reset-admin prints its own);
 * /api/test/setup-code hands one to the test instead.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const TAGS = { tag: ['@api', '@auth', '@security'] };
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const USER = 'e2e-admin';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'another long passphrase here';

test.describe('setup codes and passwords (pure)', () => {
  test('a code is 140 bits in 7 groups, normalised when typed', TAGS, () => {
    const code = generateSetupCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(generateSetupCode()).not.toBe(code);
    const n = normalizeSetupCode(code)!;
    expect(normalizeSetupCode(` ${code.toLowerCase().replace(/-/g, ' ')} `)).toBe(n);
    expect(normalizeSetupCode('too-short')).toBeNull();
    expect(normalizeSetupCode(42)).toBeNull();
    // Only a hash is stored; compare is on digests.
    expect(hashSetupCode(n)).not.toContain(n);
    expect(digestsEqual(hashSetupCode(n), hashSetupCode(n))).toBe(true);
    expect(digestsEqual(hashSetupCode(n), hashSetupCode(normalizeSetupCode(generateSetupCode())!))).toBe(false);
  });

  test('scrypt hash round trip', TAGS, async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(stored).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword('wrong password here', stored)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'garbage')).toBe(false);
  });

  test('username and password rules', TAGS, () => {
    expect(normalizeUsername(' Admin.One ')).toBe('admin.one');
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('has space')).toBeNull();
    expect(passwordProblem('admin', 'short')).toBe('too_short');
    expect(passwordProblem('admin', 'x'.repeat(257))).toBe('too_long');
    expect(passwordProblem('admin', 'my-admin-password')).toBe('contains_username');
    expect(passwordProblem('bob', 'aaaaaaaaaaaaaa')).toBe('too_simple');
    expect(passwordProblem('bob', 'password1234')).toBe('too_simple');
    expect(passwordProblem('bob', PASSWORD)).toBeNull();
  });
});

test.describe('TOTP (pure)', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890", 8-digit codes;
  // the last 6 digits are the 6-digit code.
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  test('matches the RFC 6238 test vectors', TAGS, () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    const vectors: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ];
    for (const [time, code] of vectors) expect(totpAt(secret, Math.floor(time / 30))).toBe(code.slice(-6));
  });

  test('accepts one step of drift, refuses replays and junk', TAGS, () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(secret, totpAt(secret, step), { nowMs: now })).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step + 2), { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), { nowMs: now, lastStep: step })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, 123456, { nowMs: now })).toBeNull();
  });
});

test.describe('login throttle (pure)', () => {
  test('locks a target after 5 failures, doubling; limits an IP', TAGS, () => {
    const th = new LoginThrottle({ ipLimit: 20, ipWindowMs: 900_000, freeFailures: 5, baseLockMs: 30_000, maxLockMs: 3_600_000 });
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) th.recordFailure('1.1.1.1', 'user:a', t0);
    expect(th.retryAfterMs('1.1.1.1', 'user:a', t0)).toBe(0);
    th.recordFailure('1.1.1.1', 'user:a', t0);
    expect(th.retryAfterMs('9.9.9.9', 'user:a', t0)).toBe(30_000);
    th.recordFailure('1.1.1.1', 'user:a', t0 + 30_000);
    expect(th.retryAfterMs('9.9.9.9', 'user:a', t0 + 30_000)).toBe(60_000);
    th.recordSuccess('user:a');
    expect(th.retryAfterMs('9.9.9.9', 'user:a', t0 + 30_000)).toBe(0);

    const ip = new LoginThrottle({ ipLimit: 3, ipWindowMs: 60_000, freeFailures: 100, baseLockMs: 1, maxLockMs: 1 });
    for (let i = 0; i < 3; i++) ip.recordFailure('2.2.2.2', `user:${i}`, t0);
    expect(ip.retryAfterMs('2.2.2.2', 'user:new', t0)).toBe(60_000);
    expect(ip.retryAfterMs('3.3.3.3', 'user:new', t0)).toBe(0);
  });
});

test.describe('environment import rule (pure)', () => {
  test('imports once, only into an empty setting', TAGS, () => {
    expect(shouldImportSetting({ envValue: 'x', saved: null, seen: false })).toBe('import');
    expect(shouldImportSetting({ envValue: 'x', saved: 'y', seen: false })).toBe('mark');
    expect(shouldImportSetting({ envValue: 'x', saved: null, seen: true })).toBe('skip');
    expect(shouldImportSetting({ envValue: ' ', saved: null, seen: false })).toBe('skip');
  });

  test('admin access PUT validation', TAGS, () => {
    expect(parseAdminAccessPatch({ adminSteamIds: '76561198000000001 76561198000000002' })).toEqual({
      ok: true,
      patch: { adminSteamIds: '76561198000000001, 76561198000000002' },
    });
    expect(parseAdminAccessPatch({ adminSteamIds: '123' }).ok).toBe(false);
    expect(parseAdminAccessPatch({ adminEmails: 'nope' }).ok).toBe(false);
    expect(parseAdminAccessPatch({ localAdminLoginEnabled: 'yes' }).ok).toBe(false);
    expect(parseAdminAccessPatch({ other: 1 }).ok).toBe(false);
  });
});

async function fresh(playwright: PlaywrightWorkerArgs['playwright']): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL: BASE });
}

async function testCode(request: APIRequestContext, purpose: 'setup' | 'reset'): Promise<string> {
  const res = await request.post('/api/test/setup-code', { data: { purpose } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { code: string }).code;
}

test.describe.serial('setup, local login, TOTP and reset-admin', () => {
  let totpSecret = '';

  test.beforeAll(async ({ request }) => {
    await request.post('/api/test/login-throttle/reset');
  });

  test.afterAll(async ({ request }) => {
    await request.post('/api/test/login-throttle/reset');
    await signInViaRequest(request);
  });

  test('fresh install: code -> local admin, signed in', TAGS, async ({ request, playwright }) => {
    await request.post('/api/test/clear-admins');
    const status = await request.get('/api/setup/status');
    expect(status.status()).toBe(200);
    expect((await status.json()).mode).toBe('setup');

    const code = await testCode(request, 'setup');
    const anon = await fresh(playwright);
    expect((await anon.post('/api/setup/check', { data: { code: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA' } })).status()).toBe(400);
    expect((await anon.post('/api/setup/check', { data: { code } })).status()).toBe(200);
    // Password rules are checked before the code is used.
    const weak = await anon.post('/api/setup/complete', { data: { code, username: USER, password: 'short' } });
    expect(weak.status()).toBe(400);
    expect((await weak.json()).problem).toBe('too_short');

    const done = await anon.post('/api/setup/complete', { data: { code, username: USER, password: PASSWORD } });
    expect(done.status()).toBe(200);
    const me = await (await anon.get('/api/auth/admin/me')).json();
    expect(me).toMatchObject({ authenticated: true, provider: 'local', steamId: `local-${USER}` });
    await anon.dispose();
  });

  test('/setup answers 404 once an admin exists; the code was single use', TAGS, async ({ request }) => {
    expect((await request.get('/api/setup/status')).status()).toBe(404);
    expect((await request.post('/api/setup/check', { data: { code: generateSetupCode() } })).status()).toBe(404);
    expect(
      (await request.post('/api/setup/complete', { data: { code: generateSetupCode(), username: 'other', password: PASSWORD } })).status()
    ).toBe(404);
  });

  test('an expired code is refused', TAGS, async ({ request }) => {
    const code = await testCode(request, 'reset');
    await request.post('/api/test/setup-code/expire');
    // The only reset code expired, so /setup is closed again.
    expect((await request.post('/api/setup/check', { data: { code } })).status()).toBe(404);
  });

  test('a cross-site setup or login request is refused', TAGS, async ({ request }) => {
    const headers = { Origin: 'https://evil.example' };
    expect((await request.post('/api/auth/local/login', { data: { username: USER, password: PASSWORD }, headers })).status()).toBe(403);
    expect((await request.post('/api/setup/check', { data: { code: 'x' }, headers })).status()).toBe(403);
  });

  test('local login: generic errors, then lockout', TAGS, async ({ request, playwright }) => {
    const anon = await fresh(playwright);
    const ok = await anon.post('/api/auth/local/login', { data: { username: USER, password: PASSWORD } });
    expect(ok.status()).toBe(200);
    expect((await (await anon.get('/api/auth/admin/me')).json()).authenticated).toBe(true);

    const wrongUser = await anon.post('/api/auth/local/login', { data: { username: 'nobody-here', password: PASSWORD } });
    const wrongPass = await anon.post('/api/auth/local/login', { data: { username: USER, password: 'not the password!' } });
    expect(wrongUser.status()).toBe(401);
    expect(wrongPass.status()).toBe(401);
    expect((await wrongUser.json()).error).toBe((await wrongPass.json()).error);

    for (let i = 0; i < 5; i++) {
      await anon.post('/api/auth/local/login', { data: { username: USER, password: 'not the password!' } });
    }
    // Locked: even the right password waits.
    const locked = await anon.post('/api/auth/local/login', { data: { username: USER, password: PASSWORD } });
    expect(locked.status()).toBe(429);
    expect(locked.headers()['retry-after']).toBeTruthy();
    await anon.dispose();
    await request.post('/api/test/login-throttle/reset');
  });

  test('TOTP: enrol, then sign-in asks for the code', TAGS, async ({ playwright }) => {
    const ctx = await fresh(playwright);
    expect((await ctx.post('/api/auth/local/login', { data: { username: USER, password: PASSWORD } })).status()).toBe(200);
    const start = await ctx.post('/api/auth/local/totp/start', { data: {} });
    expect(start.status()).toBe(200);
    const { secret, uri } = (await start.json()) as { secret: string; uri: string };
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    totpSecret = secret;
    expect((await ctx.post('/api/auth/local/totp/confirm', { data: { code: '000000' } })).status()).toBe(400);
    expect((await ctx.post('/api/auth/local/totp/confirm', { data: { code: totpAt(secret, totpStep()) } })).status()).toBe(200);
    expect((await (await ctx.get('/api/auth/local/me')).json()).totpEnabled).toBe(true);
    await ctx.dispose();

    const anon = await fresh(playwright);
    const noCode = await anon.post('/api/auth/local/login', { data: { username: USER, password: PASSWORD } });
    expect(noCode.status()).toBe(401);
    expect((await noCode.json()).totpRequired).toBe(true);
    // The step after the one used to confirm (the same step would be a replay).
    const withCode = await anon.post('/api/auth/local/login', {
      data: { username: USER, password: PASSWORD, totp: totpAt(totpSecret, totpStep() + 1) },
    });
    expect(withCode.status()).toBe(200);
    await anon.dispose();
  });

  test('reset-admin: new password, TOTP removed, old password refused', TAGS, async ({ request, playwright }) => {
    const code = await testCode(request, 'reset');
    const anon = await fresh(playwright);
    expect((await (await anon.get('/api/setup/status')).json()).mode).toBe('reset');
    const done = await anon.post('/api/setup/complete', { data: { code, username: USER, password: NEW_PASSWORD } });
    expect(done.status()).toBe(200);
    // Used once: /setup closes again.
    expect((await anon.post('/api/setup/check', { data: { code } })).status()).toBe(404);
    await anon.dispose();

    const again = await fresh(playwright);
    expect((await again.post('/api/auth/local/login', { data: { username: USER, password: PASSWORD } })).status()).toBe(401);
    expect((await again.post('/api/auth/local/login', { data: { username: USER, password: NEW_PASSWORD } })).status()).toBe(200);
    await again.dispose();
  });

  test('local login cannot be turned off when it would lock everyone out', TAGS, async ({ request }) => {
    await signInViaRequest(request);
    // Steam off (CI has no key anyway): then no admin can sign in with a provider.
    const providers = (await (await request.get('/api/sign-in-providers')).json()).providers as Array<{ id: string; enabled: boolean }>;
    const steamWasOn = providers.find((p) => p.id === 'steam')!.enabled;
    await request.put('/api/sign-in-providers/steam', { data: { enabled: false } });
    try {
      const view = await (await request.get('/api/sign-in-providers/admin-access')).json();
      expect(view.localAdminLoginEnabled).toBe(true);
      expect(view.canDisableLocalAdminLogin).toBe(false);
      const off = await request.put('/api/sign-in-providers/admin-access', { data: { localAdminLoginEnabled: false } });
      expect(off.status()).toBe(409);
      expect((await (await request.get('/api/auth/local/status')).json()).enabled).toBe(true);
    } finally {
      await request.put('/api/sign-in-providers/steam', { data: { enabled: steamWasOn } });
    }
  });

  test('env import happens once, then the database wins', TAGS, async ({ request }) => {
    await signInViaRequest(request);
    const names = ['TWITCH_CLIENT_ID', 'ADMIN_EMAILS'];
    await request.put('/api/sign-in-providers/twitch', { data: { clientId: null } });
    await request.put('/api/sign-in-providers/admin-access', { data: { adminEmails: '' } });

    const first = await request.post('/api/test/env-import', {
      data: { env: { TWITCH_CLIENT_ID: 'env-twitch-id', ADMIN_EMAILS: 'owner@example.com' }, forget: names },
    });
    expect(first.status()).toBe(200);
    const twitch = async () =>
      ((await (await request.get('/api/sign-in-providers')).json()).providers as Array<{ id: string; clientId: string | null }>).find(
        (p) => p.id === 'twitch'
      )!.clientId;
    expect(await twitch()).toBe('env-twitch-id');
    expect((await (await request.get('/api/sign-in-providers/admin-access')).json()).adminEmails).toBe('owner@example.com');

    // Editable in the UI; a later boot with another value does not overwrite it.
    expect((await request.put('/api/sign-in-providers/twitch', { data: { clientId: 'ui-twitch-id' } })).status()).toBe(200);
    await request.post('/api/test/env-import', { data: { env: { TWITCH_CLIENT_ID: 'env-twitch-id-2', ADMIN_EMAILS: 'x@example.com' } } });
    expect(await twitch()).toBe('ui-twitch-id');
    expect((await (await request.get('/api/sign-in-providers/admin-access')).json()).adminEmails).toBe('owner@example.com');

    // Cleared in the UI: still not imported again.
    await request.put('/api/sign-in-providers/twitch', { data: { clientId: null } });
    await request.post('/api/test/env-import', { data: { env: { TWITCH_CLIENT_ID: 'env-twitch-id-3' } } });
    expect(await twitch()).toBeNull();

    await request.put('/api/sign-in-providers/admin-access', { data: { adminEmails: '' } });
  });
});
