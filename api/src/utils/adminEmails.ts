/**
 * Admin emails (Settings -> Sign-in; `ADMIN_EMAILS` is imported once): a comma (or space / semicolon) separated list of email
 * addresses that get admin when their owner signs in with a provider that has
 * verified that address (Google, Discord, GitHub's primary address). A
 * bootstrap path next to `ADMIN_STEAM_IDS`, for operators who do not want
 * admin tied to a Steam ID they have to look up.
 *
 * Additive only, like ADMIN_STEAM_IDS: removing an address never demotes
 * anyone. Only a provider-verified address counts; an unverified one is
 * ignored, so nobody gets admin by typing someone else's address into a
 * provider profile. Accounts are never linked by email.
 */

/** Lower-cased, trimmed addresses from `raw`; anything without an @ is dropped. */
export function parseAdminEmails(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? '').split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) out.add(email);
  }
  return out;
}

/*
 * The saved list (app_settings `admin_emails`, edited on Settings -> Sign-in;
 * imported once from ADMIN_EMAILS). Cached here so the sign-in callbacks can
 * read it synchronously; services/adminAccessSettings.ts keeps it current.
 */
let savedAdminEmails: string | null = null;

export function setSavedAdminEmails(raw: string | null): void {
  savedAdminEmails = raw;
}

export function adminEmailsConfigured(raw: string | null | undefined = savedAdminEmails): boolean {
  return parseAdminEmails(raw).size > 0;
}

/**
 * Whether a provider-verified address is on the list. Pass only an address
 * the provider verified (see the `*VerifiedEmail` helpers in config/passport).
 */
export function isAdminEmail(
  verifiedEmail: string | undefined | null,
  raw: string | null | undefined = savedAdminEmails
): boolean {
  if (!verifiedEmail) return false;
  return parseAdminEmails(raw).has(verifiedEmail.trim().toLowerCase());
}
