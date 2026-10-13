import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The account each game needs, in the admin's forms (Vikunja 1771): CS2's
 * Steam, a pack's Epic Games, … An admin can enter such an account for a
 * player (kept unverified); when its owner first signs in with that
 * provider they land on that player, and it counts as verified from then on.
 *
 * The sign-in runs through the test-only fake GitHub provider (routes/test.ts),
 * standing in for Epic Games: the same callback code handles every provider.
 *
 * @tag api
 * @tag auth
 * @tag players
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@api', '@auth', '@players'] };

const digits = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const githubId = () => `${1 + Math.floor(Math.random() * 9)}${digits(7)}`;
const codeFor = (id: string) =>
  Buffer.from(
    JSON.stringify({ id: Number(id), login: `octo${id}`, name: `Octo ${id}` }),
    'utf8'
  ).toString('base64url');
const newContext = () => playwrightRequest.newContext({ baseURL: BASE_URL });

async function signInWithGithub(providerUserId: string): Promise<APIRequestContext> {
  const ctx = await newContext();
  const start = await ctx.get('/api/test/oauth/github', { maxRedirects: 0 });
  test.skip(start.status() === 404, 'fake GitHub provider is not available');
  expect(start.status()).toBe(302);
  const state = new URL(start.headers()['location'] ?? '').searchParams.get('state') ?? '';
  const res = await ctx.get(
    `/api/test/oauth/github/callback?${new URLSearchParams({ code: codeFor(providerUserId), state })}`,
    { maxRedirects: 0 }
  );
  expect(res.status()).toBe(302);
  return ctx;
}

test.describe.serial('Game accounts', () => {
  let admin: APIRequestContext;
  const created: string[] = [];

  test.beforeAll(async () => {
    admin = await newContext();
    expect(await signInViaRequest(admin)).toBe(true);
  });

  test.afterAll(async () => {
    for (const id of created) await admin.delete(`/api/players/${encodeURIComponent(id)}`);
    await admin.dispose();
  });

  test('the installed games name their accounts: CS2 uses Steam', TAGS, async () => {
    const res = await admin.get('/api/games/accounts');
    expect(res.ok()).toBe(true);
    const { accounts } = (await res.json()) as {
      accounts: { provider: string; label: string; games: { id: string; name: string }[] }[];
    };
    const steam = accounts.find((a) => a.provider === 'steam');
    expect(steam?.label).toBe('Steam');
    expect(steam?.games.map((g) => g.id)).toContain('cs2');
  });

  test('an admin enters an account; it is unique, clearable, and checked', TAGS, async () => {
    const account = githubId();
    const res = await admin.post('/api/players', {
      data: { name: `Accounts ${account}`, accounts: { github: account } },
    });
    expect(res.status(), await res.text()).toBe(201);
    const player = (await res.json()).player as { id: string };
    created.push(player.id);

    const list = await (await admin.get(`/api/players/${player.id}/accounts`)).json();
    expect(list.accounts).toEqual([{ provider: 'github', externalId: account, verified: false }]);

    // The same account for someone else: refused, and nothing is left behind.
    const twin = await admin.post('/api/players', {
      data: { name: `Twin ${account}`, accounts: { github: account } },
    });
    expect(twin.status()).toBe(409);

    // Unknown providers, Steam (that is the player id) and junk are refused.
    for (const accounts of [
      { nope: 'x' },
      { steam: '76561198000000001' },
      { github: 'a b' },
      { github: 7 },
    ]) {
      const bad = await admin.put(`/api/players/${player.id}`, { data: { accounts } });
      expect(bad.status(), JSON.stringify(accounts)).toBe(400);
    }

    // Cleared.
    expect(
      (await admin.put(`/api/players/${player.id}`, { data: { accounts: { github: null } } })).ok()
    ).toBe(true);
    expect((await (await admin.get(`/api/players/${player.id}/accounts`)).json()).accounts).toEqual(
      []
    );
  });

  test(
    'its owner signs in with it and lands on that player; then it is verified',
    TAGS,
    async () => {
      const account = githubId();
      const res = await admin.post('/api/players', {
        data: { name: `Lands ${account}`, accounts: { github: account } },
      });
      expect(res.status(), await res.text()).toBe(201);
      const player = (await res.json()).player as { id: string };
      created.push(player.id);

      const owner = await signInWithGithub(account);
      try {
        const session = (await (await owner.get('/api/auth/me')).json()) as { steamId?: string };
        expect(session.steamId).toBe(player.id);
      } finally {
        await owner.dispose();
      }

      const list = await (await admin.get(`/api/players/${player.id}/accounts`)).json();
      expect(list.accounts).toEqual([{ provider: 'github', externalId: account, verified: true }]);
      // Verified: the admin can no longer change it.
      const change = await admin.put(`/api/players/${player.id}`, {
        data: { accounts: { github: githubId() } },
      });
      expect(change.status()).toBe(409);
    }
  );
});
