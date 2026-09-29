import { test, expect } from '@playwright/test';
import { decryptSecret, encryptSecret, secretsKeySource } from '../../api/src/utils/secretBox';
import {
  parseProviderPatch,
  resolveProviderSettings,
  setStoredProviderSettings,
  signInProviderDefinition,
  type SignInProviderId,
  type StoredProviderSettings,
} from '../../api/src/config/signInProviders';
import { getAuthProvidersConfig } from '../../api/src/config/authProviders';
import { isSignInSetUp, setupCardTarget, SIGN_IN_SETTINGS_PATH } from '../../client/src/utils/signInSetup';
import { signInViaRequest } from '../helpers/auth';

/**
 * Settings -> Sign-in (api/src/routes/signInProviders.ts).
 *
 *  - Pure: the encryption round trip, environment-over-database precedence,
 *    PUT validation, the login page's provider list and the admin home's
 *    "Finish setting up" rule.
 *  - API: the secret is never in a GET response, writes are admin-only and
 *    same-site, a disabled provider is not on the login page, and saving
 *    applies without a restart. Twitch is used because nothing else in the
 *    suite configures it; every test that saves puts it back.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const TAGS = { tag: ['@api', '@auth', '@security'] };

test.describe('secret box (AES-256-GCM)', () => {
  test('round-trips, and the stored form does not contain the secret', TAGS, () => {
    const env = { SESSION_SECRET: 'a-session-secret-for-tests' };
    const stored = encryptSecret('super-secret-value', env);
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain('super-secret-value');
    expect(decryptSecret(stored, env)).toBe('super-secret-value');
    // A fresh IV every time.
    expect(encryptSecret('super-secret-value', env)).not.toBe(stored);
  });

  test('another key, a tampered value or garbage decrypts to null', TAGS, () => {
    const env = { SESSION_SECRET: 'key-one' };
    const stored = encryptSecret('value', env);
    expect(decryptSecret(stored, { SESSION_SECRET: 'key-two' })).toBeNull();
    const parts = stored.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(decryptSecret(parts.join('.'), env)).toBeNull();
    expect(decryptSecret('not-a-secret', env)).toBeNull();
    expect(decryptSecret(null, env)).toBeNull();
  });

  test('SECRETS_KEY wins over SESSION_SECRET', TAGS, () => {
    expect(secretsKeySource({ SECRETS_KEY: 'k', SESSION_SECRET: 's' })).toBe('SECRETS_KEY');
    expect(secretsKeySource({ SESSION_SECRET: 's' })).toBe('SESSION_SECRET');
    expect(secretsKeySource({})).toBe('default');
    const stored = encryptSecret('v', { SECRETS_KEY: 'k', SESSION_SECRET: 's' });
    expect(decryptSecret(stored, { SECRETS_KEY: 'k' })).toBe('v');
    expect(decryptSecret(stored, { SESSION_SECRET: 's' })).toBeNull();
  });
});

test.describe('environment over database', () => {
  const discord = signInProviderDefinition('discord');
  const row: StoredProviderSettings = { enabled: true, clientId: 'db-id', secret: 'db-secret' };

  test('the saved row is used when the environment says nothing', TAGS, () => {
    const s = resolveProviderSettings(discord, {}, row);
    expect(s).toMatchObject({ enabled: true, clientId: 'db-id', secret: 'db-secret', active: true });
    expect(s.source).toEqual({ enabled: 'db', clientId: 'db', secret: 'db' });
  });

  test('each environment variable wins over its field', TAGS, () => {
    const s = resolveProviderSettings(
      discord,
      { AUTH_DISCORD_ENABLED: 'false', DISCORD_CLIENT_ID: 'env-id', DISCORD_CLIENT_SECRET: 'env-secret' },
      row
    );
    expect(s).toMatchObject({ enabled: false, clientId: 'env-id', secret: 'env-secret', active: false });
    expect(s.source).toEqual({ enabled: 'env', clientId: 'env', secret: 'env' });

    const partial = resolveProviderSettings(discord, { DISCORD_CLIENT_SECRET: 'env-secret' }, row);
    expect(partial).toMatchObject({ clientId: 'db-id', secret: 'env-secret' });
    expect(partial.source).toEqual({ enabled: 'db', clientId: 'db', secret: 'env' });
  });

  test('Steam is on by default and needs only its key; Epic is never active', TAGS, () => {
    const steam = signInProviderDefinition('steam');
    expect(resolveProviderSettings(steam, {}, null)).toMatchObject({ enabled: true, configured: false, active: false });
    expect(resolveProviderSettings(steam, { STEAM_API_KEY: 'k' }, null)).toMatchObject({ active: true });
    expect(resolveProviderSettings(steam, { STEAM_API_KEY: 'k', AUTH_STEAM_ENABLED: 'false' }, null).active).toBe(false);

    const epic = signInProviderDefinition('epic');
    expect(resolveProviderSettings(epic, {}, { enabled: true, clientId: 'x', secret: 'y' }).active).toBe(false);
  });
});

test.describe('PUT validation', () => {
  const twitch = signInProviderDefinition('twitch');

  test('accepts the three fields and rejects anything else', TAGS, () => {
    expect(parseProviderPatch(twitch, { enabled: true, clientId: ' abc ', clientSecret: 'def' })).toEqual({
      ok: true,
      patch: { enabled: true, clientId: 'abc', clientSecret: 'def' },
    });
    expect(parseProviderPatch(twitch, { clientSecret: null })).toEqual({ ok: true, patch: { clientSecret: null } });
    expect(parseProviderPatch(twitch, { enabled: 'yes' }).ok).toBe(false);
    expect(parseProviderPatch(twitch, { clientId: 'has space' }).ok).toBe(false);
    expect(parseProviderPatch(twitch, { clientSecret: 'x'.repeat(513) }).ok).toBe(false);
    expect(parseProviderPatch(twitch, { admin: true }).ok).toBe(false);
    expect(parseProviderPatch(twitch, [1]).ok).toBe(false);
    expect(parseProviderPatch(signInProviderDefinition('steam'), { clientId: 'x' }).ok).toBe(false);
  });
});

test.describe('login page list', () => {
  const saved = { ...process.env };
  test.afterEach(() => {
    process.env = { ...saved };
    setStoredProviderSettings(new Map());
  });

  function store(entries: Array<[SignInProviderId, StoredProviderSettings]>) {
    setStoredProviderSettings(new Map(entries));
  }

  test('a provider saved enabled with credentials is listed; disabled is not', TAGS, () => {
    for (const k of ['AUTH_TWITCH_ENABLED', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET']) delete process.env[k];
    store([['twitch', { enabled: true, clientId: 'tw-id', secret: 'tw-secret' }]]);
    const listed = getAuthProvidersConfig();
    expect(listed.map((p) => p.id)).toContain('twitch');
    expect(JSON.stringify(listed)).not.toContain('tw-secret');

    store([['twitch', { enabled: false, clientId: 'tw-id', secret: 'tw-secret' }]]);
    expect(getAuthProvidersConfig().map((p) => p.id)).not.toContain('twitch');
  });

  test('AUTH_<P>_ENABLED=false hides a provider the database enabled', TAGS, () => {
    process.env.AUTH_TWITCH_ENABLED = 'false';
    store([['twitch', { enabled: true, clientId: 'tw-id', secret: 'tw-secret' }]]);
    expect(getAuthProvidersConfig().map((p) => p.id)).not.toContain('twitch');
  });
});

test.describe('admin home: "Finish setting up"', () => {
  test('sign-in is set up once any provider is on the login page', TAGS, () => {
    expect(isSignInSetUp([])).toBe(false);
    expect(isSignInSetUp([{ id: 'steam', enabled: false }])).toBe(false);
    expect(isSignInSetUp([{ id: 'steam', enabled: false }, { id: 'discord', enabled: true }])).toBe(true);
  });

  test('"Open settings" goes to the first unfinished item with a page of its own', TAGS, () => {
    expect(setupCardTarget([{ done: false, to: SIGN_IN_SETTINGS_PATH }, { done: false }])).toBe(SIGN_IN_SETTINGS_PATH);
    expect(setupCardTarget([{ done: true, to: SIGN_IN_SETTINGS_PATH }, { done: false }])).toBe('/settings');
    expect(SIGN_IN_SETTINGS_PATH).toBe('/settings?section=signin');
  });
});

test.describe.serial('Sign-in providers API', () => {
  const json = { 'Content-Type': 'application/json' };
  const SECRET = 'e2e-twitch-secret-value-0123456789';

  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
  });

  test.afterAll(async ({ request }) => {
    await signInViaRequest(request);
    await request.put('/api/sign-in-providers/twitch', {
      data: { enabled: false, clientId: null, clientSecret: null },
      headers: json,
    });
  });

  test('admin only', TAGS, async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    expect((await anonymous.get('/api/sign-in-providers')).status()).toBe(401);
    const put = await anonymous.put('/api/sign-in-providers/twitch', { data: { enabled: true }, headers: json });
    expect([401, 403]).toContain(put.status());
    await anonymous.dispose();
  });

  test('a cross-site write is refused', TAGS, async ({ request }) => {
    const res = await request.put('/api/sign-in-providers/twitch', {
      data: { enabled: true },
      headers: { ...json, Origin: 'https://evil.example' },
    });
    expect(res.status()).toBe(403);
  });

  test('the secret is saved but never returned', TAGS, async ({ request }) => {
    const put = await request.put('/api/sign-in-providers/twitch', {
      data: { clientId: 'e2e-twitch-client', clientSecret: SECRET },
      headers: json,
    });
    expect(put.status()).toBe(200);
    expect(await put.text()).not.toContain(SECRET);

    const get = await request.get('/api/sign-in-providers');
    expect(get.status()).toBe(200);
    const text = await get.text();
    expect(text).not.toContain(SECRET);
    const twitch = (JSON.parse(text) as { providers: Array<Record<string, unknown>> }).providers.find(
      (p) => p.id === 'twitch'
    )!;
    expect(twitch).toMatchObject({ clientId: 'e2e-twitch-client', secretSet: true });
    expect(String(twitch.callbackUrl)).toMatch(/\/api\/auth\/twitch\/callback$/);
    expect(Object.keys(twitch)).not.toContain('clientSecret');
    expect(Object.keys(twitch)).not.toContain('secret');
  });

  test('enabling puts it on the login page at once; disabling takes it off', TAGS, async ({ request }) => {
    const on = await request.put('/api/sign-in-providers/twitch', { data: { enabled: true }, headers: json });
    expect(on.status()).toBe(200);
    let providers = (await (await request.get('/api/auth/providers')).json()).providers as Array<{ id: string }>;
    expect(providers.map((p) => p.id)).toContain('twitch');
    // The strategy is registered without a restart: the start route redirects to Twitch.
    const start = await request.get('/api/auth/twitch', { maxRedirects: 0 });
    expect(start.status()).toBe(302);
    expect(start.headers().location).toContain('id.twitch.tv');

    await request.put('/api/sign-in-providers/twitch', { data: { enabled: false }, headers: json });
    providers = (await (await request.get('/api/auth/providers')).json()).providers as Array<{ id: string }>;
    expect(providers.map((p) => p.id)).not.toContain('twitch');
    expect((await request.get('/api/auth/twitch', { maxRedirects: 0 })).status()).toBe(503);
  });

  test('bad input and unknown providers', TAGS, async ({ request }) => {
    expect(
      (await request.put('/api/sign-in-providers/twitch', { data: { enabled: 'yes' }, headers: json })).status()
    ).toBe(400);
    expect(
      (await request.put('/api/sign-in-providers/myspace', { data: { enabled: true }, headers: json })).status()
    ).toBe(404);
    expect(
      (await request.put('/api/sign-in-providers/epic', { data: { enabled: true }, headers: json })).status()
    ).toBe(409);
  });
});
