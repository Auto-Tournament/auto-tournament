import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { passkeyName, passkeyRelyingParty } from '../../api/src/services/localAdminPasskeys';
import { signInViaRequest } from '../helpers/auth';

/**
 * Passkeys for local admin accounts (Vikunja 1741): add one on the account
 * page, sign in with it on /login/admin instead of the password and code.
 *
 * The WebAuthn crypto is SimpleWebAuthn's; these tests swap in a fake
 * authenticator (POST /api/test/passkey-verifier) and check the routes around
 * it: one-time challenges on the session, who owns a passkey, the counter,
 * and that a passkey signs its own account in and nothing else.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@auth', '@security'] };
const PASSWORD = 'local admin passkey passphrase';

const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const newContext = () => playwrightRequest.newContext({ baseURL: BASE_URL });

async function createLocalAdmin(username: string): Promise<APIRequestContext> {
  const helper = await newContext();
  try {
    await helper.post('/api/test/login-throttle/reset');
    const res = await helper.post('/api/test/setup-code', { data: { purpose: 'reset' } });
    expect(res.ok(), await res.text()).toBe(true);
    const { code } = (await res.json()) as { code: string };
    const ctx = await newContext();
    const done = await ctx.post('/api/setup/complete', {
      data: { code, username, password: PASSWORD },
    });
    expect(done.status(), await done.text()).toBe(200);
    return ctx;
  } finally {
    await helper.dispose();
  }
}

async function addPasskey(ctx: APIRequestContext, id: string, name?: string) {
  const start = await ctx.post('/api/auth/local/passkeys/register/options', { data: {} });
  expect(start.status(), await start.text()).toBe(200);
  const { options } = (await start.json()) as { options: { challenge: string } };
  return ctx.post('/api/auth/local/passkeys/register/verify', {
    data: {
      name,
      response: {
        id,
        response: { clientDataJSON: options.challenge, attestationObject: 'fake-ok' },
      },
    },
  });
}

async function signInWith(ctx: APIRequestContext, id: string, signature = 'fake-ok') {
  const start = await ctx.post('/api/auth/local/passkeys/login/options', { data: {} });
  expect(start.status(), await start.text()).toBe(200);
  const { options } = (await start.json()) as { options: { challenge: string } };
  return ctx.post('/api/auth/local/passkeys/login/verify', {
    data: { response: { id, response: { clientDataJSON: options.challenge, signature } } },
  });
}

test.describe('Passkey relying party (pure)', () => {
  test('https or localhost only; the RP ID is the hostname', TAGS, () => {
    expect(passkeyRelyingParty('https://tournament.example.com/')).toEqual({
      name: 'Auto Tournament',
      id: 'tournament.example.com',
      origin: 'https://tournament.example.com',
    });
    expect(passkeyRelyingParty('http://localhost:3069')?.origin).toBe('http://localhost:3069');
    expect(passkeyRelyingParty('http://192.168.1.50:3069')).toBeNull();
    expect(passkeyRelyingParty('not a url')).toBeNull();
    expect(passkeyRelyingParty('')).toBeNull();
  });

  test('names are trimmed to 60 characters, empty falls back', TAGS, () => {
    expect(passkeyName('  MacBook  ', 'Passkey 1')).toBe('MacBook');
    expect(passkeyName('', 'Passkey 2')).toBe('Passkey 2');
    expect(passkeyName('x'.repeat(80), 'P')).toHaveLength(60);
  });
});

test.describe.serial('Local admin passkeys', () => {
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await newContext();
    expect(await signInViaRequest(admin)).toBe(true);
    const fake = await admin.post('/api/test/passkey-verifier', { data: { fake: true } });
    test.skip(fake.status() === 404 || fake.status() === 403, 'test endpoints are off');
    expect(fake.ok(), await fake.text()).toBe(true);
    const status = await (await newContext()).get('/api/auth/local/status');
    test.skip(
      !(await status.json()).passkeys,
      'passkeys need FRONTEND_BASE_URL on https or localhost'
    );
  });

  test.afterAll(async () => {
    await admin.post('/api/test/passkey-verifier', { data: { fake: false } });
    await admin.dispose();
  });

  test('add one, sign in with it, remove it', TAGS, async () => {
    const username = `pk-${digits(8)}`;
    const owner = await createLocalAdmin(username);
    const credential = `cred-${digits(12)}`;
    try {
      expect((await (await owner.get('/api/auth/local/passkeys')).json()).passkeys).toEqual([]);

      const added = await addPasskey(owner, credential, '  Laptop ');
      expect(added.status(), await added.text()).toBe(200);
      expect((await added.json()).passkey).toMatchObject({
        id: credential,
        name: 'Laptop',
        lastUsedAt: null,
      });
      // The same passkey twice: refused.
      expect((await addPasskey(owner, credential)).status()).toBe(409);

      // A finished (or never started) ceremony can't be replayed.
      const replay = await owner.post('/api/auth/local/passkeys/register/verify', {
        data: {
          response: {
            id: `cred-${digits(12)}`,
            response: { clientDataJSON: 'old', attestationObject: 'fake-ok' },
          },
        },
      });
      expect(replay.status()).toBe(400);

      // Signed out, on the sign-in page: no username, just the passkey.
      const visitor = await newContext();
      try {
        const res = await signInWith(visitor, credential);
        expect(res.status(), await res.text()).toBe(200);
        const me = await (await visitor.get('/api/auth/admin/me')).json();
        expect(me).toMatchObject({ authenticated: true, steamId: `local-${username}` });
        const list = (await (await owner.get('/api/auth/local/passkeys')).json()).passkeys;
        expect(list[0].lastUsedAt).toBeGreaterThan(0);
      } finally {
        await visitor.dispose();
      }

      // A bad signature, an unknown passkey, or a challenge used twice: no.
      const stranger = await newContext();
      try {
        expect((await signInWith(stranger, credential, 'forged')).status()).toBe(401);
        expect((await signInWith(stranger, `cred-${digits(12)}`)).status()).toBe(401);
        const reused = await stranger.post('/api/auth/local/passkeys/login/verify', {
          data: {
            response: {
              id: credential,
              response: { clientDataJSON: 'stale', signature: 'fake-ok' },
            },
          },
        });
        expect(reused.status()).toBe(401);
        expect((await (await stranger.get('/api/auth/admin/me')).json()).authenticated).toBe(false);
      } finally {
        await stranger.dispose();
      }

      // Someone else's account can't see or remove it.
      const other = await createLocalAdmin(`pk-${digits(8)}`);
      try {
        expect((await (await other.get('/api/auth/local/passkeys')).json()).passkeys).toEqual([]);
        expect((await other.delete(`/api/auth/local/passkeys/${credential}`)).status()).toBe(404);
      } finally {
        await other.dispose();
      }

      // The owner removes it; then it signs nobody in.
      expect((await owner.delete(`/api/auth/local/passkeys/${credential}`)).status()).toBe(200);
      const after = await newContext();
      try {
        expect((await signInWith(after, credential)).status()).toBe(401);
      } finally {
        await after.dispose();
      }
    } finally {
      await admin.post('/api/test/login-throttle/reset');
      await owner.dispose();
    }
  });
});
