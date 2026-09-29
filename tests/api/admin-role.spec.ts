import { test, expect } from '@playwright/test';
import { bulkRemovesEveryAdmin, canDisableLocalAdminLogin, removesLastAdmin } from '../../api/src/utils/adminRules';
import { isAdminEmail, parseAdminEmails } from '../../api/src/utils/adminEmails';
import {
  discordVerifiedEmail,
  githubProfileToUser,
  googleProfileToUser,
} from '../../api/src/config/passport';
import { signPendingSteamLink, verifyPendingSteamLink } from '../../api/src/utils/signedPendingSteamLink';
import { signInViaRequest } from '../helpers/auth';

/**
 * Admin is a flag on the account, whatever it signs in with. The ways to get
 * it, and the guard that keeps the site from losing its last admin
 * (api/src/utils/adminRules.ts, utils/adminEmails.ts, routes/players.ts).
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const TAGS = { tag: ['@api', '@auth', '@security'] };

test.describe('local admin login switch', () => {
  test('can only be turned off while another admin can sign in with a provider', TAGS, () => {
    expect(canDisableLocalAdminLogin({ adminsWithActiveProviderLogin: 0 })).toBe(false);
    expect(canDisableLocalAdminLogin({ adminsWithActiveProviderLogin: 1 })).toBe(true);
  });
});

test.describe('last admin guard', () => {
  test('demoting or deleting the only admin is refused', TAGS, () => {
    expect(removesLastAdmin({ targetIsAdmin: true, adminCount: 1 })).toBe(true);
    expect(removesLastAdmin({ targetIsAdmin: true, adminCount: 2 })).toBe(false);
    expect(removesLastAdmin({ targetIsAdmin: false, adminCount: 1 })).toBe(false);
  });

  test('a bulk delete may not remove every admin', TAGS, () => {
    expect(bulkRemovesEveryAdmin({ adminIdsToRemove: 2, adminCount: 2 })).toBe(true);
    expect(bulkRemovesEveryAdmin({ adminIdsToRemove: 1, adminCount: 2 })).toBe(false);
    expect(bulkRemovesEveryAdmin({ adminIdsToRemove: 0, adminCount: 0 })).toBe(false);
  });
});

test.describe('ADMIN_EMAILS', () => {
  const env = { ADMIN_EMAILS: 'Owner@Example.com, ops@example.org;not-an-email' };
  const list = env.ADMIN_EMAILS;

  test('parses a list, case-insensitively, and drops junk', TAGS, () => {
    expect([...parseAdminEmails(env.ADMIN_EMAILS)]).toEqual(['owner@example.com', 'ops@example.org']);
    expect(isAdminEmail('owner@example.com', list)).toBe(true);
    expect(isAdminEmail('OPS@example.org', list)).toBe(true);
    expect(isAdminEmail('someone@example.com', list)).toBe(false);
    expect(isAdminEmail(undefined, list)).toBe(false);
    expect(isAdminEmail('owner@example.com', '')).toBe(false);
  });

  test('only a provider-verified address is offered', TAGS, () => {
    expect(discordVerifiedEmail({ id: '1', email: 'owner@example.com', verified: true })).toBe('owner@example.com');
    expect(discordVerifiedEmail({ id: '1', email: 'owner@example.com', verified: false })).toBeUndefined();

    const google = (verified: boolean) =>
      googleProfileToUser({ id: 'sub', emails: [{ value: 'owner@example.com', verified }] }).verifiedEmail;
    expect(google(true)).toBe('owner@example.com');
    expect(google(false)).toBeUndefined();

    const github = (emails: Array<{ value: string; primary?: boolean; verified?: boolean }>) =>
      githubProfileToUser({ id: '1', emails }).verifiedEmail;
    expect(github([{ value: 'owner@example.com', primary: true, verified: true }])).toBe('owner@example.com');
    // Primary but unverified, or verified but not primary: no.
    expect(github([{ value: 'owner@example.com', primary: true, verified: false }])).toBeUndefined();
    expect(
      github([
        { value: 'other@example.com', primary: true, verified: false },
        { value: 'owner@example.com', primary: false, verified: true },
      ])
    ).toBeUndefined();
  });

  test('the pending Steam link carries the match as a signed flag, never the address', TAGS, () => {
    const secret = 'test-secret';
    const signed = signPendingSteamLink(
      { provider: 'google', providerUserId: 'sub-1', adminEmail: true },
      { secret }
    );
    expect(Buffer.from(signed.split('.')[0], 'base64url').toString()).not.toContain('@');
    const read = verifyPendingSteamLink(signed, { secret });
    expect(read.ok && read.link.adminEmail).toBe(true);

    const plain = verifyPendingSteamLink(signPendingSteamLink({ provider: 'google', providerUserId: 'sub-1' }, { secret }), {
      secret,
    });
    expect(plain.ok && plain.link.adminEmail).toBeFalsy();
  });
});

test.describe('Players page: grant and remove admin', () => {
  const json = { 'Content-Type': 'application/json' };

  test('an admin can promote and demote another account', TAGS, async ({ request }) => {
    await signInViaRequest(request);
    const id = `7656119${String(Date.now()).slice(-10)}`;
    const created = await request.post('/api/players', { data: { id, name: 'Admin role e2e' }, headers: json });
    expect(created.ok()).toBe(true);
    try {
      const promote = await request.put(`/api/players/${id}`, { data: { isAdmin: true }, headers: json });
      expect(promote.status()).toBe(200);
      expect((await promote.json()).player.isAdmin).toBe(true);

      // There is at least one other admin (the test admin), so this is allowed.
      const demote = await request.put(`/api/players/${id}`, { data: { isAdmin: false }, headers: json });
      expect(demote.status()).toBe(200);
      expect((await demote.json()).player.isAdmin).toBe(false);

      const bad = await request.put(`/api/players/${id}`, { data: { isAdmin: 'yes' }, headers: json });
      expect(bad.status()).toBe(400);
    } finally {
      await request.delete(`/api/players/${id}`);
    }
  });
});
