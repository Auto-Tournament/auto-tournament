import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { checkRemoveSignInMethod, isSameSiteRequest } from '../../api/src/utils/accountConnections';
import {
  OAUTH_STATE_TTL_MS,
  createOAuthState,
  peekOAuthLinkIntent,
  verifyOAuthState,
} from '../../api/src/utils/oauthStateCookie';
import { impersonatePlayer, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Account connections (/me/connections): linking a sign-in provider to the
 * signed-in account, and removing one.
 *
 * The link flow runs through the test-only fake GitHub/Google provider
 * (routes/test.ts): POST /api/test/oauth/<provider>/link is the test twin of
 * POST /api/auth/<provider>/link and runs the same start code with the fake
 * strategy, and its callback runs the same callback route. The authorization
 * `code` is the base64url JSON of the profile the "provider" returns.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@auth', '@security'] };

type Ctx = APIRequestContext;

function digits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}

function randomSteamId(): string {
  return `7656119${digits(10)}`;
}

function githubId(): string {
  return `${1 + Math.floor(Math.random() * 9)}${digits(7)}`;
}

/** GitHub /user profile -> authorization code for the fake provider. */
function codeFor(id: string): string {
  const profile = { id: Number(id), login: `octo${id}`, name: `Octo ${id}` };
  return Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');
}

async function newContext(): Promise<Ctx> {
  return playwrightRequest.newContext({ baseURL: BASE_URL });
}

/** Start a link in `ctx`; returns the state sent to the provider (skips if the fake is off). */
async function startLink(ctx: Ctx): Promise<string> {
  const res = await ctx.post('/api/test/oauth/github/link', { maxRedirects: 0 });
  test.skip(
    res.status() === 404,
    'fake GitHub provider is not available (ENABLE_TEST_ENDPOINTS off?)'
  );
  expect(res.status(), await res.text()).toBe(302);
  const location = new URL(res.headers()['location'] ?? '');
  expect(location.pathname).toBe('/api/test/fake-oauth/github/authorize');
  const state = location.searchParams.get('state') ?? '';
  expect(state).toBeTruthy();
  return state;
}

async function callback(ctx: Ctx, code: string, state: string) {
  const query = new URLSearchParams({ code, state });
  return ctx.get(`/api/test/oauth/github/callback?${query}`, { maxRedirects: 0 });
}

/** The outcome flag a link callback redirected to /me/connections with. */
function linkOutcome(location: string | undefined): string | null {
  const url = new URL(location ?? '', BASE_URL);
  expect(url.pathname).toBe('/me/connections');
  return url.searchParams.get('link');
}

async function linkedSteamIds(providerUserId: string): Promise<string[]> {
  const admin = await newContext();
  try {
    expect(await signInViaRequest(admin)).toBe(true);
    const res = await admin.get(
      `/api/test/auth-identities?provider=github&providerUserId=${providerUserId}`
    );
    expect(res.ok(), await res.text()).toBe(true);
    return ((await res.json()) as { steamIds: string[] }).steamIds;
  } finally {
    await admin.dispose();
  }
}

async function seedIdentity(providerUserId: string, steamId: string): Promise<void> {
  const admin = await newContext();
  try {
    expect(await signInViaRequest(admin)).toBe(true);
    const res = await admin.post('/api/test/auth-identities', {
      data: { provider: 'github', providerUserId, steamId },
    });
    expect(res.ok(), await res.text()).toBe(true);
  } finally {
    await admin.dispose();
  }
}

interface SignInMethod {
  provider: string;
  linked: boolean;
  primary: boolean;
  removable: boolean;
  linkedAt: number | null;
}

test.describe('Account connections: linking a provider', () => {
  test('a signed-in player links a provider to their own account', TAGS, async () => {
    const steamId = randomSteamId();
    const providerUserId = githubId();
    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, steamId, 'Connections Test Player')).toBe(true);
      // login-player's optional `name` is only applied when the player is created.
      const summary = await (await ctx.get(`/api/players/${steamId}/summary`)).json();
      expect(summary.player?.name).toBe('Connections Test Player');
      const state = await startLink(ctx);
      const res = await callback(ctx, codeFor(providerUserId), state);
      expect(res.status()).toBe(302);
      expect(linkOutcome(res.headers()['location'])).toBe('ok');
      expect(await linkedSteamIds(providerUserId)).toEqual([steamId]);

      // The link did not switch who is signed in.
      const me = await (await ctx.get('/api/auth/me')).json();
      expect(me.steamId).toBe(steamId);

      const connections = await ctx.get('/api/me/connections');
      expect(connections.ok()).toBe(true);
      const body = (await connections.json()) as { signInMethods: SignInMethod[] };
      const github = body.signInMethods.find((m) => m.provider === 'github');
      expect(github?.linked).toBe(true);
      expect(typeof github?.linkedAt).toBe('number');
    } finally {
      await ctx.dispose();
    }
  });

  test('an identity owned by another account is refused and left alone', TAGS, async () => {
    const owner = randomSteamId();
    const other = randomSteamId();
    const providerUserId = githubId();
    await seedIdentity(providerUserId, owner);

    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, other)).toBe(true);
      const state = await startLink(ctx);
      const res = await callback(ctx, codeFor(providerUserId), state);
      expect(res.status()).toBe(302);
      expect(linkOutcome(res.headers()['location'])).toBe('taken');
      expect(await linkedSteamIds(providerUserId)).toEqual([owner]);
    } finally {
      await ctx.dispose();
    }
  });

  test('a replayed state is refused', TAGS, async () => {
    const steamId = randomSteamId();
    const first = githubId();
    const second = githubId();
    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, steamId)).toBe(true);
      const state = await startLink(ctx);
      // Keep the state cookie so it can be presented again after it was used.
      const cookies = (await ctx.storageState()).cookies.filter((c) =>
        c.name.startsWith('oauth_state_')
      );
      expect(cookies).toHaveLength(1);
      const stateCookie = `${cookies[0].name}=${cookies[0].value}`;

      const ok = await callback(ctx, codeFor(first), state);
      expect(linkOutcome(ok.headers()['location'])).toBe('ok');

      const query = new URLSearchParams({ code: codeFor(second), state });
      const replay = await ctx.get(`/api/test/oauth/github/callback?${query}`, {
        maxRedirects: 0,
        headers: { cookie: `${stateCookie}; ${await playerCookie(ctx)}` },
      });
      expect(linkOutcome(replay.headers()['location'])).toBe('failed');
      expect(await linkedSteamIds(second)).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test('a forged state is refused', TAGS, async () => {
    const steamId = randomSteamId();
    const providerUserId = githubId();
    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, steamId)).toBe(true);
      await startLink(ctx);
      const res = await callback(ctx, codeFor(providerUserId), 'forged-state');
      expect(linkOutcome(res.headers()['location'])).toBe('failed');
      expect(await linkedSteamIds(providerUserId)).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test('a tampered or expired state cookie is refused', TAGS, async () => {
    const steamId = randomSteamId();
    const providerUserId = githubId();
    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, steamId)).toBe(true);
      const state = await startLink(ctx);
      const [cookie] = (await ctx.storageState()).cookies.filter((c) =>
        c.name.startsWith('oauth_state_')
      );
      const [nonce, expiresAt, intent, sig] = decodeURIComponent(cookie.value).split('.');
      expect(sig).toBeTruthy();

      // Already expired, with the signature left as it was.
      const expired = [nonce, String(Number(expiresAt) - 11 * 60 * 1000), intent, sig].join('.');
      // The intent rewritten to point at another account.
      const otherIntent = Buffer.from(
        JSON.stringify({ purpose: 'link', steamId: randomSteamId() })
      ).toString('base64url');
      const retargeted = [nonce, expiresAt, otherIntent, sig].join('.');

      for (const value of [expired, retargeted]) {
        const query = new URLSearchParams({ code: codeFor(providerUserId), state });
        const res = await ctx.get(`/api/test/oauth/github/callback?${query}`, {
          maxRedirects: 0,
          headers: {
            cookie: `${cookie.name}=${encodeURIComponent(value)}; ${await playerCookie(ctx)}`,
          },
        });
        expect(res.status()).toBe(302);
        // Not a link any more as far as the server can tell, so it is the
        // login path's failure, or the link path's: either way nothing linked.
        expect(res.headers()['location']).toMatch(/\/login$|link=failed/);
      }
      expect(await linkedSteamIds(providerUserId)).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test('the callback refuses when a different account is signed in by then', TAGS, async () => {
    const starter = randomSteamId();
    const switched = randomSteamId();
    const providerUserId = githubId();
    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, starter)).toBe(true);
      const state = await startLink(ctx);
      expect(await signInAsPlayerViaRequest(ctx, switched)).toBe(true);
      const res = await callback(ctx, codeFor(providerUserId), state);
      expect(linkOutcome(res.headers()['location'])).toBe('failed');
      expect(await linkedSteamIds(providerUserId)).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test('anonymous visitors cannot start a link', TAGS, async () => {
    const ctx = await newContext();
    try {
      const res = await ctx.post('/api/test/oauth/github/link', { maxRedirects: 0 });
      test.skip(res.status() === 404, 'fake GitHub provider is not available');
      expect(res.status()).toBe(401);
      expect((await ctx.get('/api/me/connections')).status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test('a cross-site link start is refused', TAGS, async () => {
    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, randomSteamId())).toBe(true);
      const res = await ctx.post('/api/test/oauth/github/link', {
        maxRedirects: 0,
        headers: { origin: 'https://evil.example' },
      });
      test.skip(res.status() === 404, 'fake GitHub provider is not available');
      expect(res.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });

  test('an impersonating admin cannot link or remove', TAGS, async () => {
    const target = randomSteamId();
    const ctx = await newContext();
    try {
      // Create the target player, then impersonate it as an admin.
      const seed = await newContext();
      expect(await signInAsPlayerViaRequest(seed, target)).toBe(true);
      await seed.dispose();

      expect(await signInViaRequest(ctx)).toBe(true);
      expect(await impersonatePlayer(ctx, target)).toBe(true);

      const link = await ctx.post('/api/test/oauth/github/link', { maxRedirects: 0 });
      test.skip(link.status() === 404, 'fake GitHub provider is not available');
      expect(link.status()).toBe(403);

      const remove = await ctx.post('/api/me/connections/github/remove', { data: {} });
      expect(remove.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });
});

/** The signed player cookie of `ctx`, as a Cookie header fragment. */
async function playerCookie(ctx: Ctx): Promise<string> {
  const c = (await ctx.storageState()).cookies.find((x) => x.name === 'player_steam_id');
  return c ? `${c.name}=${c.value}` : '';
}

test.describe('Account connections: removing a sign-in method', () => {
  test('a linked non-Steam provider can be removed', TAGS, async () => {
    const steamId = randomSteamId();
    const providerUserId = githubId();
    await seedIdentity(providerUserId, steamId);

    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, steamId)).toBe(true);
      const res = await ctx.post('/api/me/connections/github/remove', { data: {} });
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as { signInMethods: SignInMethod[] };
      expect(body.signInMethods.find((m) => m.provider === 'github')?.linked ?? false).toBe(false);
      expect(await linkedSteamIds(providerUserId)).toEqual([]);

      // Gone now.
      const again = await ctx.post('/api/me/connections/github/remove', { data: {} });
      expect(again.status()).toBe(404);
    } finally {
      await ctx.dispose();
    }
  });

  test('Steam cannot be removed', TAGS, async () => {
    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, randomSteamId())).toBe(true);
      const res = await ctx.post('/api/me/connections/steam/remove', { data: {} });
      expect(res.status()).toBe(400);

      const connections = (await (await ctx.get('/api/me/connections')).json()) as {
        signInMethods: SignInMethod[];
      };
      const steam = connections.signInMethods.find((m) => m.provider === 'steam');
      expect(steam).toMatchObject({ primary: true, linked: true, removable: false });
    } finally {
      await ctx.dispose();
    }
  });

  test('removal needs a same-site JSON request and a sign-in', TAGS, async () => {
    const steamId = randomSteamId();
    const providerUserId = githubId();
    await seedIdentity(providerUserId, steamId);

    const anon = await newContext();
    try {
      expect((await anon.post('/api/me/connections/github/remove', { data: {} })).status()).toBe(
        401
      );
    } finally {
      await anon.dispose();
    }

    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, steamId)).toBe(true);
      const crossSite = await ctx.post('/api/me/connections/github/remove', {
        data: {},
        headers: { origin: 'https://evil.example' },
      });
      expect(crossSite.status()).toBe(403);
      const form = await ctx.post('/api/me/connections/github/remove', {
        form: { provider: 'github' },
      });
      expect(form.status()).toBe(415);
      expect(await linkedSteamIds(providerUserId)).toEqual([steamId]);
    } finally {
      await ctx.dispose();
    }
  });

  test('game accounts come from the installed game modules', TAGS, async () => {
    const steamId = randomSteamId();
    const ctx = await newContext();
    try {
      expect(await signInAsPlayerViaRequest(ctx, steamId)).toBe(true);
      const body = (await (await ctx.get('/api/me/connections')).json()) as {
        gameAccounts: Array<{ provider: string; externalId: string; games: Array<{ id: string }> }>;
      };
      const steam = body.gameAccounts.find((a) => a.provider === 'steam');
      expect(steam?.externalId).toBe(steamId);
      expect(steam?.games.map((g) => g.id)).toContain('cs2');
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe('Account connections: rules (unit)', () => {
  test('the last usable sign-in method cannot be removed', TAGS, () => {
    // Steam sign-in off on this site, GitHub is the only way in.
    expect(
      checkRemoveSignInMethod({
        provider: 'github',
        linkedProviders: ['github'],
        enabledProviders: ['github'],
      })
    ).toEqual({ ok: false, reason: 'last_method' });
    // Steam on: GitHub can go.
    expect(
      checkRemoveSignInMethod({
        provider: 'github',
        linkedProviders: ['github'],
        enabledProviders: ['steam', 'github'],
      })
    ).toEqual({ ok: true });
    // Another usable method left.
    expect(
      checkRemoveSignInMethod({
        provider: 'github',
        linkedProviders: ['github', 'discord'],
        enabledProviders: ['github', 'discord'],
      })
    ).toEqual({ ok: true });
    // A linked provider the site no longer offers cannot sign anyone in, so
    // removing it locks nobody out; it does not count as a way in either.
    expect(
      checkRemoveSignInMethod({
        provider: 'google',
        linkedProviders: ['google', 'github'],
        enabledProviders: ['github'],
      })
    ).toEqual({ ok: true });
    expect(
      checkRemoveSignInMethod({
        provider: 'github',
        linkedProviders: ['google', 'github'],
        enabledProviders: ['github'],
      })
    ).toEqual({ ok: false, reason: 'last_method' });
    expect(
      checkRemoveSignInMethod({ provider: 'steam', linkedProviders: [], enabledProviders: ['steam'] })
    ).toEqual({ ok: false, reason: 'primary' });
    expect(
      checkRemoveSignInMethod({ provider: 'github', linkedProviders: [], enabledProviders: [] })
    ).toEqual({ ok: false, reason: 'not_linked' });
  });

  test('a link state carries a signed intent and expires', TAGS, () => {
    const secret = 'unit-secret';
    const steamId = randomSteamId();
    const start = Date.now();
    const { state, cookieValue } = createOAuthState('github', secret, start, {
      purpose: 'link',
      steamId,
    });
    expect(cookieValue.split('.')).toHaveLength(4);
    expect(peekOAuthLinkIntent('github', `oauth_state_github=${cookieValue}`, secret)).toEqual({
      purpose: 'link',
      steamId,
    });
    expect(verifyOAuthState('github', cookieValue, state, secret, start + 60_000)).toEqual({
      ok: true,
    });
    expect(
      verifyOAuthState('github', cookieValue, state, secret, start + OAUTH_STATE_TTL_MS + 1)
    ).toEqual({ ok: false, reason: 'expired' });
    // Another provider's namespace, or another secret: not ours.
    expect(peekOAuthLinkIntent('google', `oauth_state_google=${cookieValue}`, secret)).toBeNull();
    expect(peekOAuthLinkIntent('github', `oauth_state_github=${cookieValue}`, 'other')).toBeNull();
    // Dropping the intent segment breaks the signature.
    const [nonce, exp, , sig] = cookieValue.split('.');
    expect(verifyOAuthState('github', [nonce, exp, sig].join('.'), state, secret, start)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('same-site check', TAGS, () => {
    const req = (headers: Record<string, string>) => ({
      get: (name: string) => headers[name.toLowerCase()],
    });
    expect(isSameSiteRequest(req({ host: 'app.example' }))).toBe(true);
    expect(isSameSiteRequest(req({ host: 'app.example', origin: 'https://app.example' }))).toBe(true);
    // Dev proxy: same hostname, different port.
    expect(
      isSameSiteRequest(req({ host: 'localhost:3000', origin: 'http://localhost:5173' }))
    ).toBe(true);
    expect(isSameSiteRequest(req({ host: 'app.example', origin: 'https://evil.example' }))).toBe(
      false
    );
    expect(isSameSiteRequest(req({ host: 'app.example', origin: 'null' }))).toBe(false);
    expect(
      isSameSiteRequest(req({ host: 'app.example', referer: 'https://evil.example/x' }))
    ).toBe(false);
    expect(isSameSiteRequest(req({ host: 'app.example', 'sec-fetch-site': 'cross-site' }))).toBe(
      false
    );
  });
});
