/**
 * Pure rules for Settings -> Sign-in, "Admin access" (the store is
 * services/adminAccessSettings.ts): what a `PUT` may contain, and when an
 * environment variable is imported into a setting. No database here, so the
 * tests import it directly.
 */
import { parseAdminEmails } from './adminEmails';
import { parseAdminSteamIds } from './adminSteamIds';

export interface AdminAccessPatch {
  localAdminLoginEnabled?: boolean;
  adminSteamIds?: string;
  adminEmails?: string;
}

/** Check a `PUT` body. Pure. */
export function parseAdminAccessPatch(body: unknown): { ok: true; patch: AdminAccessPatch } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'Send a JSON object' };
  const input = body as Record<string, unknown>;
  const allowed = new Set(['localAdminLoginEnabled', 'adminSteamIds', 'adminEmails']);
  const unknown = Object.keys(input).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { ok: false, error: `Unknown field: ${unknown[0]}` };
  const patch: AdminAccessPatch = {};
  if (input.localAdminLoginEnabled !== undefined) {
    if (typeof input.localAdminLoginEnabled !== 'boolean') return { ok: false, error: 'localAdminLoginEnabled must be true or false' };
    patch.localAdminLoginEnabled = input.localAdminLoginEnabled;
  }
  if (input.adminSteamIds !== undefined) {
    if (typeof input.adminSteamIds !== 'string' || input.adminSteamIds.length > 10_000) {
      return { ok: false, error: 'adminSteamIds must be a list of Steam64 IDs' };
    }
    const { valid, invalid } = parseAdminSteamIds(input.adminSteamIds);
    if (invalid.length > 0) return { ok: false, error: `Not a Steam64 ID: ${invalid[0]}` };
    patch.adminSteamIds = valid.join(', ');
  }
  if (input.adminEmails !== undefined) {
    if (typeof input.adminEmails !== 'string' || input.adminEmails.length > 10_000) {
      return { ok: false, error: 'adminEmails must be a list of email addresses' };
    }
    const bad = input.adminEmails
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter((e) => e && parseAdminEmails(e).size === 0);
    if (bad.length > 0) return { ok: false, error: `Not an email address: ${bad[0]}` };
    patch.adminEmails = [...parseAdminEmails(input.adminEmails)].join(', ');
  }
  return { ok: true, patch };
}

/** A setting's env import rule, pure for the tests: import when set, unseen, and nothing is saved. */
export function shouldImportSetting(input: {
  envValue: string | undefined;
  saved: string | null;
  seen: boolean;
}): 'import' | 'mark' | 'skip' {
  const value = input.envValue?.trim();
  if (!value || input.seen) return 'skip';
  return input.saved && input.saved.trim() ? 'mark' : 'import';
}
