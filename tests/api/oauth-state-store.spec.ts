import { test, expect } from '@playwright/test';
import {
  createOAuthState,
  verifyOAuthState,
  oauthStateCookieName,
  OAUTH_STATE_TTL_MS,
  SignedCookieStateStore,
  type StateStoreRequest,
} from '../../api/src/utils/oauthStateCookie';

/**
 * Signed cookie OAuth `state` store.
 *
 * Without a state check, a `code` obtained in an attacker's browser could be
 * completed at our callback by a victim (login CSRF). These tests pin down that
 * only the browser holding the signed cookie for that exact state gets through.
 *
 * @tag api
 * @tag auth
 */
const SECRET = 'unit-test-secret';

test.describe('OAuth state signing', () => {
  test('a round trip verifies', () => {
    const { state, cookieValue } = createOAuthState('discord', SECRET);
    expect(verifyOAuthState('discord', cookieValue, state, SECRET)).toEqual({ ok: true });
  });

  test('a tampered cookie fails', () => {
    const { state, cookieValue } = createOAuthState('discord', SECRET);
    const [nonce, exp, sig] = cookieValue.split('.');
    // Push the expiry out: signature no longer matches.
    const tamperedExpiry = `${nonce}.${Number(exp) + 1_000_000}.${sig}`;
    expect(verifyOAuthState('discord', tamperedExpiry, state, SECRET)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    // Swap in an attacker-chosen nonce with the old signature.
    const tamperedNonce = `attackernonce.${exp}.${sig}`;
    expect(verifyOAuthState('discord', tamperedNonce, 'attackernonce', SECRET)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyOAuthState('discord', 'garbage', state, SECRET)).toEqual({
      ok: false,
      reason: 'malformed_cookie',
    });
  });

  test('a cookie signed for another provider fails', () => {
    const { state, cookieValue } = createOAuthState('github', SECRET);
    expect(verifyOAuthState('discord', cookieValue, state, SECRET)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('wrong secret fails', () => {
    const { state, cookieValue } = createOAuthState('discord', SECRET);
    expect(verifyOAuthState('discord', cookieValue, state, 'other-secret')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  test('expired fails', () => {
    const start = 1_700_000_000_000;
    const { state, cookieValue } = createOAuthState('discord', SECRET, start);
    expect(
      verifyOAuthState('discord', cookieValue, state, SECRET, start + OAUTH_STATE_TTL_MS - 1)
    ).toEqual({ ok: true });
    expect(
      verifyOAuthState('discord', cookieValue, state, SECRET, start + OAUTH_STATE_TTL_MS + 1)
    ).toEqual({ ok: false, reason: 'expired' });
  });

  test('a state that does not match the cookie nonce fails', () => {
    const mine = createOAuthState('discord', SECRET);
    const attackers = createOAuthState('discord', SECRET);
    expect(verifyOAuthState('discord', mine.cookieValue, attackers.state, SECRET)).toEqual({
      ok: false,
      reason: 'state_mismatch',
    });
    expect(verifyOAuthState('discord', mine.cookieValue, undefined, SECRET)).toEqual({
      ok: false,
      reason: 'missing_state',
    });
  });

  test('a missing cookie fails', () => {
    const { state } = createOAuthState('discord', SECRET);
    expect(verifyOAuthState('discord', undefined, state, SECRET)).toEqual({
      ok: false,
      reason: 'missing_cookie',
    });
  });
});

/** Tiny cookie jar standing in for a browser + Express response. */
function fakeBrowser() {
  const jar = new Map<string, string>();
  const setCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const cleared: Array<{ name: string; options: Record<string, unknown> }> = [];
  const req = (): StateStoreRequest => ({
    headers: {
      cookie: [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '),
    },
    res: {
      cookie: (name, value, options) => {
        jar.set(name, value);
        setCookies.push({ name, value, options });
      },
      clearCookie: (name, options) => {
        jar.delete(name);
        cleared.push({ name, options });
      },
    },
  });
  return { jar, req, setCookies, cleared };
}

function storeState(store: SignedCookieStateStore, req: StateStoreRequest): string {
  let out: string | undefined;
  store.store(req, {}, (err, state) => {
    expect(err).toBeNull();
    out = state;
  });
  return out!;
}

function verifyState(store: SignedCookieStateStore, req: StateStoreRequest, state: string) {
  let out: { ok?: boolean; info?: { message: string } } = {};
  store.verify(req, state, (err, ok, info) => {
    expect(err).toBeNull();
    out = { ok, info };
  });
  return out;
}

test.describe('SignedCookieStateStore (passport-oauth2 store)', () => {
  const callbackURL = 'https://tournament.example.com/api/auth/discord/callback';
  const secret = () => SECRET;

  test('uses the signatures passport-oauth2 dispatches on', () => {
    const store = new SignedCookieStateStore({ provider: 'discord', callbackURL, secret });
    // passport-oauth2 picks the call shape from Function.length.
    expect(store.store.length).toBe(3);
    expect(store.verify.length).toBe(3);
  });

  test('sets a path-scoped, httpOnly, lax cookie and verifies once', () => {
    const store = new SignedCookieStateStore({ provider: 'discord', callbackURL, secret });
    const browser = fakeBrowser();

    const state = storeState(store, browser.req());
    expect(state).toBeTruthy();
    expect(browser.setCookies).toHaveLength(1);
    expect(browser.setCookies[0].name).toBe(oauthStateCookieName('discord'));
    expect(browser.setCookies[0].options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth/discord/callback',
      maxAge: OAUTH_STATE_TTL_MS,
    });

    expect(verifyState(store, browser.req(), state).ok).toBe(true);
    expect(browser.cleared.map((c) => c.name)).toEqual([oauthStateCookieName('discord')]);
    expect(browser.cleared[0].options).toMatchObject({ path: '/api/auth/discord/callback' });

    // The cookie is gone, so the same state cannot be replayed.
    const replay = verifyState(store, browser.req(), state);
    expect(replay.ok).toBe(false);
    expect(replay.info?.message).toContain('missing_cookie');
  });

  test("a victim's browser rejects the attacker's state", () => {
    const store = new SignedCookieStateStore({ provider: 'discord', callbackURL, secret });
    const attacker = fakeBrowser();
    const victim = fakeBrowser();

    const attackerState = storeState(store, attacker.req());
    // Victim has no state cookie at all.
    expect(verifyState(store, victim.req(), attackerState).ok).toBe(false);

    // Victim started their own login, then is lured to the attacker's callback URL.
    storeState(store, victim.req());
    const result = verifyState(store, victim.req(), attackerState);
    expect(result.ok).toBe(false);
    expect(result.info?.message).toContain('state_mismatch');
  });
});
