import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import {
  PLAYER_COOKIE_MAX_AGE_MS,
  getVerifiedPlayerSteamId,
  signPlayerSteamId,
} from '../../api/src/utils/signedPlayerCookie';
import { sessionSecret } from '../../api/src/config/sessionSecret';

/**
 * The signed player cookie carries its own expiry, so a copied value stops
 * working after 30 days.
 *
 * @tag api
 * @tag auth
 */

const TAGS = { tag: ['@api', '@auth'] };
const STEAM_ID = '76561198000000001';
const cookie = (value: string) => `x=1; player_steam_id=${encodeURIComponent(value)}`;

test.describe('Signed player cookie expiry', () => {
  test('is valid until it expires, then refused', TAGS, () => {
    const now = Date.now();
    const value = signPlayerSteamId(STEAM_ID, now);
    expect(getVerifiedPlayerSteamId(cookie(value), now)).toBe(STEAM_ID);
    expect(getVerifiedPlayerSteamId(cookie(value), now + PLAYER_COOKIE_MAX_AGE_MS - 1000)).toBe(
      STEAM_ID
    );
    expect(
      getVerifiedPlayerSteamId(cookie(value), now + PLAYER_COOKIE_MAX_AGE_MS + 1000)
    ).toBeNull();
  });

  test('a changed expiry or the old form without one is refused', TAGS, () => {
    const value = signPlayerSteamId(STEAM_ID);
    const [id, expires, sig] = value.split('.');
    expect(getVerifiedPlayerSteamId(cookie(`${id}.${Number(expires) + 86400}.${sig}`))).toBeNull();
    const oldForm = crypto
      .createHmac('sha256', sessionSecret())
      .update(STEAM_ID)
      .digest('base64url');
    expect(getVerifiedPlayerSteamId(cookie(`${STEAM_ID}.${oldForm}`))).toBeNull();
  });
});
