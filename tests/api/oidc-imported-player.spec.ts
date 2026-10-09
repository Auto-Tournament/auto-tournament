import { test, expect, request as playwrightRequest } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';

/**
 * Integrators (NTLAN) import players with their OpenID Connect login's `sub`
 * (`oidcSubject`), through the players API or the teams API. An OpenID
 * Connect sign-in with that sub lands on the imported player. An import never
 * touches an existing player's rating: only the name and missing IDs.
 */

const TAGS = { tag: ['@api'] };
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

const stamp = String(Date.now()).slice(-7);
const sid = (n: number) => `765611980${stamp}${n}`;
const codeFor = (profile: object) =>
  Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');

/** Sign in through the fake OpenID Connect provider as `sub`; the response of the callback. */
async function oidcSignIn(sub: string, name: string) {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const start = await ctx.get('/api/test/oauth/oidc', { maxRedirects: 0 });
  test.skip(
    start.status() !== 302,
    `fake OpenID Connect provider not available (${start.status()})`
  );
  const state = new URL(start.headers()['location'] ?? '').searchParams.get('state') ?? '';
  const query = new URLSearchParams({
    code: codeFor({ sub, name, preferred_username: name }),
    state,
  });
  const res = await ctx.get(`/api/test/oauth/oidc/callback?${query}`, { maxRedirects: 0 });
  await ctx.dispose();
  return res;
}

async function linkedTo(
  request: Parameters<typeof signInViaRequest>[0],
  sub: string
): Promise<string[]> {
  const res = await request.get(
    `/api/test/auth-identities?provider=oidc&providerUserId=${encodeURIComponent(sub)}`
  );
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { steamIds: string[] }).steamIds;
}

test(
  'players API: create, then an import never changes rating; oidcSubject is added once',
  TAGS,
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const headers = getAuthHeader();
    // An existing player with a rating of their own.
    const seeded = await request.post('/api/players/bulk-import', {
      headers,
      data: [{ id: sid(1), name: 'Seeded', elo: 1850 }],
    });
    expect(seeded.ok(), await seeded.text()).toBe(true);

    expect((await request.post('/api/players/import', { headers, data: [] })).status()).toBe(400);
    expect(
      (
        await request.post('/api/players/import', {
          headers,
          data: [{ steamId: 'abc', name: 'x' }],
        })
      ).status()
    ).toBe(400);

    const res = await request.post('/api/players/import', {
      headers,
      data: [
        {
          steamId: sid(1),
          name: 'Seeded Renamed',
          oidcSubject: `kc-${stamp}-1`,
          discordId: '123456789012345678',
        },
        { steamId: sid(2), name: 'New Kid' },
      ],
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toMatchObject({ created: 1, updated: 1 });

    const player = (await (await request.get(`/api/players/${sid(1)}`, { headers })).json())
      .player as {
      name: string;
      currentElo: number;
    };
    expect(player.name).toBe('Seeded Renamed');
    expect(player.currentElo).toBe(1850);

    // A second, different subject is not stored; one taken by another player neither.
    const again = await request.post('/api/players/import', {
      headers,
      data: [
        { steamId: sid(1), name: 'Seeded Renamed', oidcSubject: `kc-${stamp}-other` },
        { steamId: sid(2), name: 'New Kid', oidcSubject: `kc-${stamp}-1` },
      ],
    });
    const body = (await again.json()) as { warnings?: string[] };
    expect(body.warnings?.join(' ')).toMatch(/already has an OpenID Connect login/);
    expect(body.warnings?.join(' ')).toMatch(/belongs to player/);
  }
);

test(
  'an OpenID Connect sign-in with an imported sub lands on that player',
  TAGS,
  async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const headers = getAuthHeader();
    // Through the teams API this time.
    const team = await request.post('/api/teams?upsert=true', {
      headers,
      data: {
        id: `oidc-team-${stamp}`,
        name: `OIDC Team ${stamp}`,
        players: [
          { steamId: sid(5), name: 'Parent', oidcSubject: `kc-${stamp}-5` },
          { steamId: sid(6), name: 'Child without a login' },
        ],
      },
    });
    expect(team.ok(), await team.text()).toBe(true);
    // The sub never lands in the roster JSON.
    expect(JSON.stringify(await team.json())).not.toContain(`kc-${stamp}-5`);

    const res = await oidcSignIn(`kc-${stamp}-5`, 'Parent on Keycloak');
    expect(res.status()).toBe(302);
    expect(await linkedTo(request, `kc-${stamp}-5`)).toEqual([sid(5)]);

    // Signing in again resolves through the stored link.
    expect((await oidcSignIn(`kc-${stamp}-5`, 'Parent on Keycloak')).status()).toBe(302);
    expect(await linkedTo(request, `kc-${stamp}-5`)).toEqual([sid(5)]);

    // A sub nobody imported is not linked to any imported player.
    await oidcSignIn(`kc-${stamp}-unknown`, 'Stranger');
    expect(await linkedTo(request, `kc-${stamp}-unknown`)).not.toContain(sid(6));
  }
);
