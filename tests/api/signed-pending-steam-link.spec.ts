import crypto from 'crypto';
import { test, expect } from '@playwright/test';
import {
  PENDING_STEAM_LINK_TTL_MS,
  signPendingSteamLink,
  verifyPendingSteamLink,
} from '../../api/src/utils/signedPendingSteamLink';

/**
 * Signing and verifying the `pending_steam_link` cookie.
 *
 * The Steam callback re-points an SSO login to whatever Steam account just
 * signed in, for the identity this cookie names. So the only acceptable input
 * is one the server wrote itself, recently. Pure unit tests: no server, and an
 * explicit secret and clock so they do not depend on the environment.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const SECRET = 'unit-test-secret';
const NOW = 1_800_000_000_000;
const LINK = { provider: 'discord' as const, providerUserId: '123456789012345678' };

function sign(options: { secret?: string; now?: number; expiresAt?: number } = {}) {
  return signPendingSteamLink(LINK, { secret: SECRET, now: NOW, ...options });
}

function verify(raw: string | undefined, options: { secret?: string; now?: number } = {}) {
  return verifyPendingSteamLink(raw, { secret: SECRET, now: NOW, ...options });
}

/** Re-sign an arbitrary payload object with the test secret (a "we wrote this" payload). */
function signRawPayload(payload: unknown): string {
  // Same format and namespace as the real signer, but over any payload, so the
  // shape checks can be tested separately from the signature check.
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SECRET)
    .update(`pending_steam_link:${encoded}`, 'utf8')
    .digest('base64url');
  return `${encoded}.${sig}`;
}

test.describe('Signed pending Steam link cookie', () => {
  test('a freshly signed cookie round-trips', { tag: ['@api', '@auth', '@security'] }, () => {
    const result = verify(sign());
    expect(result).toEqual({ ok: true, link: LINK, expiresAt: NOW + PENDING_STEAM_LINK_TTL_MS });

    // Still fine a moment before expiry.
    expect(verify(sign(), { now: NOW + PENDING_STEAM_LINK_TTL_MS - 1 }).ok).toBe(true);
  });

  test('the payload names the providers we write', { tag: ['@api', '@auth'] }, () => {
    for (const provider of ['discord', 'keycloak', 'github', 'google'] as const) {
      const value = signPendingSteamLink(
        { provider, providerUserId: 'abc' },
        { secret: SECRET, now: NOW }
      );
      expect(verify(value)).toMatchObject({ ok: true, link: { provider, providerUserId: 'abc' } });
    }
  });

  test('a modified payload is rejected', { tag: ['@api', '@auth', '@security'] }, () => {
    const [, sig] = sign().split('.');
    const otherPayload = Buffer.from(
      JSON.stringify({ ...LINK, providerUserId: '999999999999999999', exp: NOW + 60_000 }),
      'utf8'
    ).toString('base64url');
    expect(verify(`${otherPayload}.${sig}`)).toEqual({ ok: false, reason: 'bad-signature' });

    // A single flipped character in the payload, too.
    const value = sign();
    const flipped = (value[0] === 'e' ? 'f' : 'e') + value.slice(1);
    expect(verify(flipped).ok).toBe(false);
  });

  test('a modified signature is rejected', { tag: ['@api', '@auth', '@security'] }, () => {
    const value = sign();
    const [payload, sig] = value.split('.');
    // Every position, including the last character whose low bits base64
    // decoding would otherwise ignore.
    for (let i = 0; i < sig.length; i++) {
      const replacement = sig[i] === 'A' ? 'B' : 'A';
      const tampered = `${payload}.${sig.slice(0, i)}${replacement}${sig.slice(i + 1)}`;
      expect(verify(tampered), `position ${i}`).toEqual({ ok: false, reason: 'bad-signature' });
    }
    expect(verify(`${payload}.${sig.slice(0, -1)}`).ok).toBe(false);
    expect(verify(`${payload}.`).ok).toBe(false);
  });

  test('a cookie signed with another secret is rejected', { tag: ['@api', '@auth', '@security'] }, () => {
    expect(verify(sign({ secret: 'some-other-secret' }))).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
  });

  test('an expired cookie is rejected', { tag: ['@api', '@auth', '@security'] }, () => {
    expect(verify(sign(), { now: NOW + PENDING_STEAM_LINK_TTL_MS })).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(verify(sign({ expiresAt: NOW - 1 }))).toEqual({ ok: false, reason: 'expired' });
  });

  test('the old unsigned JSON cookie is rejected', { tag: ['@api', '@auth', '@security'] }, () => {
    const legacy = JSON.stringify(LINK);
    expect(verify(legacy).ok).toBe(false);
    expect(verify(encodeURIComponent(legacy)).ok).toBe(false);
    // The payload half alone, with no signature.
    expect(verify(sign().split('.')[0]).ok).toBe(false);
  });

  test(
    'a correctly signed payload of the wrong shape is rejected',
    { tag: ['@api', '@auth', '@security'] },
    () => {
      const exp = NOW + 60_000;
      expect(verify(signRawPayload({ provider: 'steam', providerUserId: 'x', exp }))).toEqual({
        ok: false,
        reason: 'invalid-payload',
      });
      expect(verify(signRawPayload({ provider: 'DISCORD', providerUserId: 'x', exp })).ok).toBe(
        false
      );
      expect(verify(signRawPayload({ provider: 'discord', providerUserId: '', exp })).ok).toBe(
        false
      );
      expect(verify(signRawPayload({ provider: 'discord', providerUserId: '  ', exp })).ok).toBe(
        false
      );
      expect(verify(signRawPayload({ provider: 'discord', providerUserId: 42, exp })).ok).toBe(
        false
      );
      expect(verify(signRawPayload({ provider: 'discord', providerUserId: 'x' })).ok).toBe(false);
      expect(
        verify(signRawPayload({ provider: 'discord', providerUserId: 'x', exp: String(exp) })).ok
      ).toBe(false);
      expect(verify(signRawPayload(['discord', 'x', exp])).ok).toBe(false);
      expect(verify(signRawPayload(null)).ok).toBe(false);

      // Sanity: the helper does produce acceptable values when the shape is right.
      expect(verify(signRawPayload({ ...LINK, exp })).ok).toBe(true);
    }
  );

  test('empty and garbage input is rejected', { tag: ['@api', '@auth', '@security'] }, () => {
    expect(verify(undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyPendingSteamLink(null, { secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(verify('')).toEqual({ ok: false, reason: 'missing' });

    for (const garbage of [
      '.',
      '..',
      'abc',
      'abc.def.ghi',
      '%%%.%%%',
      'a b.c d',
      '{"provider":"discord"}.sig',
      `${'A'.repeat(10_000)}.${'A'.repeat(43)}`,
    ]) {
      const result = verify(garbage);
      expect(result.ok, garbage.slice(0, 40)).toBe(false);
    }
  });
});
