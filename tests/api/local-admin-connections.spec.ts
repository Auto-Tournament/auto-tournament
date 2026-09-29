import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { checkRemoveSignInMethod } from '../../api/src/utils/accountConnections';
import { LOCAL_REAUTH_WINDOW_MS, isReauthRecordFresh } from '../../api/src/utils/localReauth';
import { signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * The local admin (created on /setup, player id `local-<username>`) is a user
 * like any other: it connects sign-in methods on /me/connections.
 *
 * GitHub runs through the test-only fake provider (routes/test.ts). Steam
 * OpenID cannot be faked the same way, so POST /api/test/steam-link/start and
 * /callback run the real start checks and completion code with a Steam ID the
 * test names, in place of the Steam round trip.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@auth', '@security'] };
const PASSWORD = 'local admin connections passphrase';

function digits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}

const randomSteamId = () => `7656119${digits(10)}`;
const githubId = () => `${1 + Math.floor(Math.random() * 9)}${digits(7)}`;
const newUsername = () => `lac-${digits(8)}`;

function codeFor(id: string): string {
  const profile = { id: Number(id), login: `octo${id}`, name: `Octo ${id}` };
  return Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');
}

const newContext = () => playwrightRequest.newContext({ baseURL: BASE_URL });

/** A new local admin, created with a reset code; returns its signed-in context. */
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

async function adminMe(
  ctx: APIRequestContext
): Promise<{ authenticated: boolean; steamId?: string }> {
  return (await ctx.get('/api/auth/admin/me')).json();
}

/** Link the fake GitHub provider to the account signed in in `ctx`; returns the outcome flag. */
async function linkGithub(ctx: APIRequestContext, providerUserId: string): Promise<string | null> {
  const start = await ctx.post('/api/test/oauth/github/link', { maxRedirects: 0 });
  test.skip(
    start.status() === 404,
    'fake GitHub provider is not available (ENABLE_TEST_ENDPOINTS off?)'
  );
  expect(start.status(), await start.text()).toBe(302);
  const location = new URL(start.headers()['location'] ?? '', BASE_URL);
  if (location.pathname === '/me/connections') return location.searchParams.get('link');
  const state = location.searchParams.get('state') ?? '';
  const res = await ctx.get(
    `/api/test/oauth/github/callback?${new URLSearchParams({ code: codeFor(providerUserId), state })}`,
    { maxRedirects: 0 }
  );
  expect(res.status()).toBe(302);
  return new URL(res.headers()['location'] ?? '', BASE_URL).searchParams.get('link');
}

/** Sign in with the fake GitHub provider in a new context. */
async function signInWithGithub(providerUserId: string): Promise<APIRequestContext> {
  const ctx = await newContext();
  const start = await ctx.get('/api/test/oauth/github', { maxRedirects: 0 });
  expect(start.status()).toBe(302);
  const state = new URL(start.headers()['location'] ?? '').searchParams.get('state') ?? '';
  const res = await ctx.get(
    `/api/test/oauth/github/callback?${new URLSearchParams({ code: codeFor(providerUserId), state })}`,
    { maxRedirects: 0 }
  );
  expect(res.status()).toBe(302);
  return ctx;
}

async function startSteamLink(ctx: APIRequestContext, headers?: Record<string, string>) {
  const res = await ctx.post('/api/test/steam-link/start', { maxRedirects: 0, headers });
  test.skip(res.status() === 404, 'test endpoints are off');
  return res;
}

/** Complete the Steam step; returns the outcome flag of the redirect to /me/connections. */
async function steamCallback(ctx: APIRequestContext, steamId: string): Promise<string | null> {
  const res = await ctx.post('/api/test/steam-link/callback', {
    data: { steamId },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  const url = new URL(res.headers()['location'] ?? '', BASE_URL);
  expect(url.pathname).toBe('/me/connections');
  return url.searchParams.get('link');
}

async function localLogin(username: string): Promise<APIRequestContext> {
  const ctx = await newContext();
  const res = await ctx.post('/api/auth/local/login', { data: { username, password: PASSWORD } });
  expect(res.status(), await res.text()).toBe(200);
  return ctx;
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

interface Connections {
  account: { uid: string; steamId: string };
  signInMethods: Array<{
    provider: string;
    linked: boolean;
    primary: boolean;
    canConnect: boolean;
    username?: string;
  }>;
  gameAccounts: Array<{ provider: string; linked: boolean }>;
  localLogin: { username: string; totpEnabled: boolean; reauthFresh: boolean } | null;
  pendingMerge: { steamId: string; name: string } | null;
}

async function connections(ctx: APIRequestContext): Promise<Connections> {
  const res = await ctx.get('/api/me/connections');
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as Connections;
}

test.describe('local admin connections (pure)', () => {
  test('the password login counts as a method; no Steam until connected', TAGS, () => {
    const enabled = ['steam', 'local', 'github'];
    // Only the password login: it cannot go.
    expect(
      checkRemoveSignInMethod({
        provider: 'local',
        linkedProviders: ['local'],
        enabledProviders: enabled,
        hasSteam: false,
      })
    ).toEqual({ ok: false, reason: 'last_method' });
    // With GitHub connected it can.
    expect(
      checkRemoveSignInMethod({
        provider: 'local',
        linkedProviders: ['github', 'local'],
        enabledProviders: enabled,
        hasSteam: false,
      })
    ).toEqual({ ok: true });
    // GitHub is not the last method while the password login works.
    expect(
      checkRemoveSignInMethod({
        provider: 'github',
        linkedProviders: ['github', 'local'],
        enabledProviders: enabled,
        hasSteam: false,
      })
    ).toEqual({ ok: true });
    // Steam is not linked to a local account, so there is nothing to remove.
    expect(
      checkRemoveSignInMethod({
        provider: 'steam',
        linkedProviders: ['local'],
        enabledProviders: enabled,
        hasSteam: false,
      })
    ).toEqual({ ok: false, reason: 'not_linked' });
    // After connecting Steam, the password login can go (Steam remains).
    expect(
      checkRemoveSignInMethod({
        provider: 'local',
        linkedProviders: ['local'],
        enabledProviders: enabled,
      })
    ).toEqual({ ok: true });
  });

  test('a password re-confirmation lasts 10 minutes, for that account only', TAGS, () => {
    const now = 1_700_000_000_000;
    const record = { playerId: 'local-a', at: now };
    expect(isReauthRecordFresh(record, 'local-a', now + LOCAL_REAUTH_WINDOW_MS)).toBe(true);
    expect(isReauthRecordFresh(record, 'local-a', now + LOCAL_REAUTH_WINDOW_MS + 1)).toBe(false);
    expect(isReauthRecordFresh(record, 'local-b', now)).toBe(false);
    expect(isReauthRecordFresh(undefined, 'local-a', now)).toBe(false);
    expect(isReauthRecordFresh(record, 'local-a', now - 1)).toBe(false);
  });
});

test.describe.serial('local admin connects sign-in methods', () => {
  test.afterAll(async () => {
    const ctx = await newContext();
    await ctx.post('/api/test/login-throttle/reset');
    await ctx.dispose();
  });

  test('the admin login is a sign-in method; Steam can be connected', TAGS, async () => {
    const username = newUsername();
    const ctx = await createLocalAdmin(username);
    try {
      const body = await connections(ctx);
      expect(body.account.steamId).toBe(`local-${username}`);
      expect(body.localLogin).toMatchObject({ username, totpEnabled: false, reauthFresh: true });
      const local = body.signInMethods.find((m) => m.provider === 'local');
      expect(local).toMatchObject({ linked: true, username });
      const steam = body.signInMethods.find((m) => m.provider === 'steam');
      expect(steam).toMatchObject({ linked: false, primary: false });
      expect(body.gameAccounts.find((a) => a.provider === 'steam')?.linked ?? false).toBe(false);
      expect(body.pendingMerge).toBeNull();

      // The only way in: the password login cannot be removed.
      const remove = await ctx.post('/api/me/connections/local/remove', { data: {} });
      expect(remove.status()).toBe(409);
    } finally {
      await ctx.dispose();
    }
  });

  test('connects GitHub, then GitHub signs in as the admin', TAGS, async () => {
    const username = newUsername();
    const providerUserId = githubId();
    const ctx = await createLocalAdmin(username);
    try {
      expect(await linkGithub(ctx, providerUserId)).toBe('ok');
      expect(await linkedSteamIds(providerUserId)).toEqual([`local-${username}`]);
    } finally {
      await ctx.dispose();
    }

    const viaGithub = await signInWithGithub(providerUserId);
    try {
      expect(await adminMe(viaGithub)).toMatchObject({
        authenticated: true,
        steamId: `local-${username}`,
      });

      // A GitHub session has not entered the password: connecting more needs it first.
      expect((await connections(viaGithub)).localLogin?.reauthFresh).toBe(false);
      expect(await linkGithub(viaGithub, githubId())).toBe('reauth');
      const steamStart = await startSteamLink(viaGithub);
      expect(steamStart.status()).toBe(302);
      expect(new URL(steamStart.headers()['location'] ?? '').searchParams.get('link')).toBe(
        'reauth'
      );

      const wrong = await viaGithub.post('/api/auth/local/reauth', {
        data: { password: 'not the password' },
      });
      expect(wrong.status()).toBe(401);
      const right = await viaGithub.post('/api/auth/local/reauth', {
        data: { password: PASSWORD },
      });
      expect(right.status()).toBe(200);
      expect((await connections(viaGithub)).localLogin?.reauthFresh).toBe(true);
      expect((await startSteamLink(viaGithub)).status()).toBe(200);
    } finally {
      await viaGithub.dispose();
    }
  });

  test('connecting Steam no player has: the account becomes that Steam player', TAGS, async () => {
    const username = newUsername();
    const providerUserId = githubId();
    const steamId = randomSteamId();
    const ctx = await createLocalAdmin(username);
    try {
      expect(await linkGithub(ctx, providerUserId)).toBe('ok');
      expect((await startSteamLink(ctx)).status()).toBe(200);
      expect(await steamCallback(ctx, steamId)).toBe('ok');

      // This browser is now signed in as the Steam player, still an admin.
      expect(await adminMe(ctx)).toMatchObject({ authenticated: true, steamId });
      const body = await connections(ctx);
      expect(body.account.steamId).toBe(steamId);
      expect(body.signInMethods.find((m) => m.provider === 'steam')).toMatchObject({
        linked: true,
        primary: true,
      });
      expect(body.localLogin?.username).toBe(username);
      // The sign-in methods moved with the account; the local-* row is gone.
      expect(await linkedSteamIds(providerUserId)).toEqual([steamId]);
      expect((await ctx.get(`/api/players/local-${username}/summary`)).status()).toBe(404);
    } finally {
      await ctx.dispose();
    }

    // The password login and GitHub both land on the Steam player, as admin.
    const again = await localLogin(username);
    expect(await adminMe(again)).toMatchObject({ authenticated: true, steamId });
    await again.dispose();
    const viaGithub = await signInWithGithub(providerUserId);
    expect(await adminMe(viaGithub)).toMatchObject({ authenticated: true, steamId });
    await viaGithub.dispose();
  });

  test(
    'connecting Steam that already has a player: confirm, then merge keeps that player',
    TAGS,
    async () => {
      const username = newUsername();
      const steamId = randomSteamId();

      // A player who has played here before, not an admin.
      const player = await newContext();
      expect(await signInAsPlayerViaRequest(player, steamId, 'Returning Player')).toBe(true);
      const before = await connections(player);
      expect((await adminMe(player)).authenticated).toBe(false);

      const ctx = await createLocalAdmin(username);
      try {
        expect((await startSteamLink(ctx)).status()).toBe(200);
        expect(await steamCallback(ctx, steamId)).toBe('merge');
        // Nothing merged yet: the account is still the local one, and it is asked.
        const pending = await connections(ctx);
        expect(pending.account.steamId).toBe(`local-${username}`);
        expect(pending.pendingMerge).toMatchObject({ steamId, name: 'Returning Player' });

        // Needs a same-site JSON request.
        const crossSite = await ctx.post('/api/me/connections/steam/merge', {
          data: {},
          headers: { Origin: 'https://evil.example' },
        });
        expect(crossSite.status()).toBe(403);

        const merge = await ctx.post('/api/me/connections/steam/merge', { data: {} });
        expect(merge.status(), await merge.text()).toBe(200);
        expect(await adminMe(ctx)).toMatchObject({ authenticated: true, steamId });
        expect((await connections(ctx)).pendingMerge).toBeNull();
      } finally {
        await ctx.dispose();
      }

      // The Steam player kept its account (same uid, same name) and is an admin now.
      const after = await connections(player);
      expect(after.account.uid).toBe(before.account.uid);
      expect(
        (await (await player.get(`/api/players/${steamId}/summary`)).json()).player?.name
      ).toBe('Returning Player');
      expect(await adminMe(player)).toMatchObject({ authenticated: true, steamId });
      await player.dispose();

      const again = await localLogin(username);
      expect(await adminMe(again)).toMatchObject({ authenticated: true, steamId });
      await again.dispose();

      // That Steam player has an admin login of its own now: another local admin cannot take it.
      const other = await createLocalAdmin(newUsername());
      try {
        expect((await startSteamLink(other)).status()).toBe(200);
        expect(await steamCallback(other, steamId)).toBe('taken');
        expect((await connections(other)).pendingMerge).toBeNull();
      } finally {
        await other.dispose();
      }
    }
  );

  test('refusals', TAGS, async () => {
    // Anonymous, and a Steam account (it already is one).
    const anon = await newContext();
    expect((await startSteamLink(anon)).status()).toBe(401);
    expect(
      (await anon.post('/api/auth/local/reauth', { data: { password: PASSWORD } })).status()
    ).toBe(404);
    await anon.dispose();
    const steamPlayer = await newContext();
    expect(await signInAsPlayerViaRequest(steamPlayer, randomSteamId())).toBe(true);
    expect((await startSteamLink(steamPlayer)).status()).toBe(400);
    await steamPlayer.dispose();

    const username = newUsername();
    const ctx = await createLocalAdmin(username);
    try {
      // Cross-site start.
      expect((await startSteamLink(ctx, { Origin: 'https://evil.example' })).status()).toBe(403);
      // A Steam answer nobody asked for.
      expect(await steamCallback(ctx, randomSteamId())).toBe('failed');
      // No merge waiting.
      expect((await ctx.post('/api/me/connections/steam/merge', { data: {} })).status()).toBe(404);

      // A GitHub account already connected to another account.
      const takenId = githubId();
      const owner = await newContext();
      expect(await signInAsPlayerViaRequest(owner, randomSteamId())).toBe(true);
      expect(await linkGithub(owner, takenId)).toBe('ok');
      await owner.dispose();
      expect(await linkGithub(ctx, takenId)).toBe('taken');

      // The account is still the local one, with only its password login.
      const body = await connections(ctx);
      expect(body.account.steamId).toBe(`local-${username}`);
      expect(body.signInMethods.filter((m) => m.linked).map((m) => m.provider)).toEqual(['local']);
    } finally {
      await ctx.dispose();
    }
  });
});
