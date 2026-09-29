/**
 * The rules for who is an admin, as pure functions so the tests can check
 * them without a database. Admin is a flag on the account (`players.is_admin`),
 * whatever the account signs in with. Ways to get it:
 *
 *  - an admin ticks "Admin" on the Players page (routes/players.ts);
 *  - ADMIN_STEAM_IDS, applied at every boot (services/adminSeedService.ts);
 *  - ADMIN_EMAILS, at sign-in with a provider-verified address (utils/adminEmails.ts);
 *  - a fresh install or recovery: the setup code the server logs, which
 *    creates a local admin account (services/localAdminService.ts).
 */

/**
 * "Allow local admin login" may be turned off only while another way in
 * exists: at least one admin who can sign in with a provider that is on the
 * login page right now (a Steam admin with Steam on, or an admin with a linked
 * Discord/Google/GitHub/Twitch sign-in whose provider is on). Otherwise
 * turning it off would lock every admin out.
 */
export function canDisableLocalAdminLogin(input: { adminsWithActiveProviderLogin: number }): boolean {
  return input.adminsWithActiveProviderLogin > 0;
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
