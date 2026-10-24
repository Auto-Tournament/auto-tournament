import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import {
  PLAYER_COOKIE_TTL_MS,
  getVerifiedPlayerSteamId,
  signPlayerSteamId,
} from '../../api/src/utils/signedPlayerCookie';

/**
 * The signed player_steam_id cookie carries its issue and expiry times under
 * the signature, and the signature is namespaced (`player:`), so a value
 * signed for anything else never reads as a player.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const TAGS = { tag: ['@api', '@auth', '@security'] };
const ID = '76561198000000002';
const header = (value: string) => `player_steam_id=${encodeURIComponent(value)}`;

test.describe('player cookie expiry (pure)', () => {
  test('a fresh cookie verifies; an expired one does not', TAGS, () => {
    const t0 = Date.UTC(2026, 0, 1);
    const value = signPlayerSteamId(ID, t0);
    expect(getVerifiedPlayerSteamId(header(value), t0 + 1000)).toBe(ID);
    expect(getVerifiedPlayerSteamId(header(value), t0 + PLAYER_COOKIE_TTL_MS - 1000)).toBe(ID);
    expect(getVerifiedPlayerSteamId(header(value), t0 + PLAYER_COOKIE_TTL_MS + 1000)).toBeNull();
    expect(PLAYER_COOKIE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  test('the old id.signature form is rejected', TAGS, () => {
    const sig = crypto
      .createHmac(
        'sha256',
        process.env.SESSION_SECRET?.trim() || 'auto-tournament-dev-session-secret'
      )
      .update(ID, 'utf8')
      .digest('base64url');
    expect(getVerifiedPlayerSteamId(header(`${ID}.${sig}`))).toBeNull();
  });

  test('the times cannot be changed without the signature', TAGS, () => {
    const t0 = Date.UTC(2026, 0, 1);
    const value = signPlayerSteamId(ID, t0);
    const [body, sig] = [
      value.slice(0, value.lastIndexOf('.')),
      value.slice(value.lastIndexOf('.') + 1),
    ];
    const [id, iat] = body.split('|');
    const later = `${id}|${iat}|${Number(body.split('|')[2]) + 86_400}.${sig}`;
    expect(getVerifiedPlayerSteamId(header(later), t0 + PLAYER_COOKIE_TTL_MS + 1000)).toBeNull();
  });
});
