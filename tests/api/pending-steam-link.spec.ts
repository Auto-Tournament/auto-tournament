import { test, expect, type APIResponse, type PlaywrightWorkerArgs } from '@playwright/test';

/**
 * Which `pending_steam_link` cookies the Steam callback acts on.
 *
 * When Steam proves an account, `/steam/callback` links the SSO identity named
 * by this cookie to it, re-pointing any existing link. An attacker who could
 * write the cookie could therefore point a victim's Discord login at their own
 * Steam account. The rule these tests pin down:
 *
 *   Only a cookie the server signed, unmodified and unexpired, links anything.
 *   Anything else is ignored and the login is a plain Steam login.
 *
 * A real Steam OpenID login is out of reach, so `/api/test/complete-steam-link`
 * runs the callback's own linking step (`completePendingSteamLink`) as if Steam
 * had just proven the given Steam ID, and `/api/test/pending-steam-link` issues
 * a cookie with the real writer. Every call goes out on a brand-new request
 * context whose only cookies are the ones in its explicit `Cookie` header: an
 * admin cookie for the helper's guard, plus the pending link under test. No
 * session rides along, so the cookie is the only possible source.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TEN_MINUTES_MS = 10 * 60 * 1000;
const TAGS = { tag: ['@api', '@auth', '@security'] };

type Playwright = PlaywrightWorkerArgs['playwright'];
type RequestContext = Awaited<ReturnType<Playwright['request']['newContext']>>;

function digits(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += Math.floor(Math.random() * 10).toString();
  return out;
}

function uniqueSteamId(): string {
  return `7656119${Date.now().toString().slice(-6)}${digits(4)}`;
}

function uniqueDiscordId(): string {
  return `1${Date.now().toString().slice(-8)}${digits(9)}`;
}

/** Raw (still encoded) values of the cookies a response sets; ignores cleared ones. */
function setCookies(res: APIResponse): Map<string, string> {
  const out = new Map<string, string>();
  for (const { name, value } of res.headersArray()) {
    if (name.toLowerCase() !== 'set-cookie') continue;
    const [pair] = value.split(';');
    const eq = pair.indexOf('=');
    const cookieValue = pair.slice(eq + 1).trim();
    if (cookieValue === '' || /expires=Thu, 01 Jan 1970/i.test(value)) continue;
    out.set(pair.slice(0, eq).trim(), cookieValue);
  }
  return out;
}

type CompleteResult = {
  success: boolean;
  linked: boolean;
  source: 'session' | 'cookie' | null;
  link: { provider: string; providerUserId: string } | null;
  cookieRejected: string | null;
};

/** Run one exchange on a fresh request context that carries exactly `cookie`. */
async function withCookie<T>(
  playwright: Playwright,
  cookie: string,
  run: (ctx: RequestContext, headers: Record<string, string>) => Promise<T>
): Promise<T> {
  const ctx = await playwright.request.newContext({ baseURL: BASE_URL });
  try {
    return await run(ctx, cookie ? { Cookie: cookie } : {});
  } finally {
    await ctx.dispose();
  }
}

test.describe('Steam callback: pending Steam link cookie', () => {
  let adminCookie: string;

  test.beforeEach(async ({ playwright }) => {
    // An admin player_steam_id cookie, sent by hand with each helper call.
    adminCookie = await withCookie(playwright, '', async (ctx) => {
      const res = await ctx.post('/api/test/login-admin', { data: {} });
      expect(res.ok(), `login-admin failed: ${await res.text()}`).toBe(true);
      const value = setCookies(res).get('player_steam_id');
      expect(value, 'login-admin set no player_steam_id cookie').toBeTruthy();
      return `player_steam_id=${value}`;
    });
  });

  /** Run the callback's linking step with exactly this pending cookie value. */
  function completeSteamLink(
    playwright: Playwright,
    pendingCookieValue: string,
    steamId: string,
    nowOffsetMs?: number
  ): Promise<CompleteResult> {
    const cookie = `${adminCookie}; pending_steam_link=${pendingCookieValue}`;
    return withCookie(playwright, cookie, async (ctx, headers) => {
      const res = await ctx.post('/api/test/complete-steam-link', {
        headers,
        data: nowOffsetMs === undefined ? { steamId } : { steamId, nowOffsetMs },
      });
      expect(res.ok(), `complete-steam-link failed: ${await res.text()}`).toBe(true);
      return (await res.json()) as CompleteResult;
    });
  }

  function linkedSteamIds(playwright: Playwright, discordId: string): Promise<string[]> {
    return withCookie(playwright, adminCookie, async (ctx, headers) => {
      const res = await ctx.get(
        `/api/test/auth-identities?provider=discord&providerUserId=${encodeURIComponent(discordId)}`,
        { headers }
      );
      expect(res.ok(), `identity lookup failed: ${await res.text()}`).toBe(true);
      return ((await res.json()) as { steamIds: string[] }).steamIds;
    });
  }

  /** A cookie issued by the real writer the SSO callbacks use. */
  function realPendingCookie(playwright: Playwright, discordId: string): Promise<string> {
    return withCookie(playwright, adminCookie, async (ctx, headers) => {
      const res = await ctx.post('/api/test/pending-steam-link', {
        headers,
        data: { provider: 'discord', providerUserId: discordId },
      });
      expect(res.ok(), `pending-steam-link failed: ${await res.text()}`).toBe(true);
      const value = setCookies(res).get('pending_steam_link');
      expect(value, 'pending-steam-link set no pending_steam_link cookie').toBeTruthy();
      return value!;
    });
  }

  /** A victim whose Discord login already resolves to their own Steam account. */
  async function victimWithLink(playwright: Playwright) {
    const discordId = uniqueDiscordId();
    const steamId = uniqueSteamId();
    await withCookie(playwright, adminCookie, async (ctx, headers) => {
      const res = await ctx.post('/api/test/auth-identities', {
        headers,
        data: { provider: 'discord', providerUserId: discordId, steamId },
      });
      expect(res.ok(), `seeding identity failed: ${await res.text()}`).toBe(true);
    });
    expect(await linkedSteamIds(playwright, discordId)).toEqual([steamId]);
    return { discordId, steamId };
  }

  test(
    'a cookie from the real writer links the identity once Steam proves the account',
    TAGS,
    async ({ playwright }) => {
      const discordId = uniqueDiscordId();
      const steamId = uniqueSteamId();
      const cookie = await realPendingCookie(playwright, discordId);
      expect(await linkedSteamIds(playwright, discordId)).toEqual([]);

      const result = await completeSteamLink(playwright, cookie, steamId);
      expect(result).toEqual({
        success: true,
        linked: true,
        source: 'cookie',
        link: { provider: 'discord', providerUserId: discordId },
        cookieRejected: null,
      });
      expect(await linkedSteamIds(playwright, discordId)).toEqual([steamId]);
    }
  );

  test('a forged unsigned JSON cookie links nothing', TAGS, async ({ playwright }) => {
    const victim = await victimWithLink(playwright);
    const attackerSteamId = uniqueSteamId();

    // Exactly what the cookie looked like before it was signed.
    const forged = encodeURIComponent(
      JSON.stringify({ provider: 'discord', providerUserId: victim.discordId })
    );
    const result = await completeSteamLink(playwright, forged, attackerSteamId);

    expect(result.linked).toBe(false);
    expect(result.link).toBeNull();
    expect(result.cookieRejected).toBe('malformed');
    expect(await linkedSteamIds(playwright, victim.discordId)).toEqual([victim.steamId]);
  });

  test(
    'a genuine cookie edited to name someone else links nothing',
    TAGS,
    async ({ playwright }) => {
      const victim = await victimWithLink(playwright);

      // The attacker gets a real cookie for their own Discord account...
      const attackerDiscordId = uniqueDiscordId();
      const attackerSteamId = uniqueSteamId();
      const genuine = await realPendingCookie(playwright, attackerDiscordId);

      // ...and swaps the victim's ID into the readable payload, keeping the signature.
      const [payload, signature] = genuine.split('.');
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      expect(decoded.providerUserId).toBe(attackerDiscordId);
      const edited = Buffer.from(
        JSON.stringify({ ...decoded, providerUserId: victim.discordId }),
        'utf8'
      ).toString('base64url');

      const result = await completeSteamLink(playwright, `${edited}.${signature}`, attackerSteamId);

      expect(result.linked).toBe(false);
      expect(result.link).toBeNull();
      expect(result.cookieRejected).toBe('bad-signature');
      expect(await linkedSteamIds(playwright, victim.discordId)).toEqual([victim.steamId]);
      // The attacker's own pending link was not completed by the edited cookie either.
      expect(await linkedSteamIds(playwright, attackerDiscordId)).toEqual([]);
    }
  );

  test(
    'an expired cookie links nothing, though the same cookie in time would',
    TAGS,
    async ({ playwright }) => {
      const victim = await victimWithLink(playwright);
      const cookie = await realPendingCookie(playwright, victim.discordId);
      const newSteamId = uniqueSteamId();

      const late = await completeSteamLink(playwright, cookie, newSteamId, TEN_MINUTES_MS + 1000);
      expect(late.linked).toBe(false);
      expect(late.link).toBeNull();
      expect(late.cookieRejected).toBe('expired');
      expect(await linkedSteamIds(playwright, victim.discordId)).toEqual([victim.steamId]);

      // Control: the clock is the only thing that made the difference.
      const onTime = await completeSteamLink(playwright, cookie, newSteamId);
      expect(onTime.linked).toBe(true);
      expect(await linkedSteamIds(playwright, victim.discordId)).toEqual([newSteamId]);
    }
  );
});
