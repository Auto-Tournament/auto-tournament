/**
 * The rules for who is an admin, as pure functions so the tests can check
 * them without a database. Admin is a flag on the account (`players.is_admin`),
 * whatever the account signs in with. Ways to get it:
 *
 *  - an admin ticks "Admin" on the Players page (routes/players.ts);
 *  - ADMIN_STEAM_IDS, applied at every boot (services/adminSeedService.ts);
 *  - ADMIN_EMAILS, at sign-in with a provider-verified address (utils/adminEmails.ts);
 *  - a fresh install: the first account to sign in (below).
 */

/**
 * Fresh install: the first account to sign in becomes admin, but only while
 * no admin exists and this account is the only one. An upgraded instance that
 * has players and no admin is never handed to whoever signs in next; it uses
 * ADMIN_STEAM_IDS or ADMIN_EMAILS instead.
 */
export function shouldPromoteFirstAdmin(input: {
  adminExists: boolean;
  totalPlayers: number;
  firstPlayerId: string | null;
  accountId: string;
}): boolean {
  return (
    !input.adminExists &&
    input.totalPlayers === 1 &&
    input.firstPlayerId !== null &&
    input.firstPlayerId === input.accountId
  );
}

/**
 * Would this change leave the site with no admin? True when `targetIsAdmin`
 * and it is the only admin, and the change removes admin from it (demote or
 * delete). The API refuses such a change with 409.
 */
export function removesLastAdmin(input: { targetIsAdmin: boolean; adminCount: number }): boolean {
  return input.targetIsAdmin && input.adminCount <= 1;
}

/** Same, for deleting several accounts at once. */
export function bulkRemovesEveryAdmin(input: { adminIdsToRemove: number; adminCount: number }): boolean {
  return input.adminCount > 0 && input.adminIdsToRemove >= input.adminCount;
}
