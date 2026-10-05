/**
 * Parsing the `ADMIN_STEAM_IDS` environment variable.
 *
 * Kept free of database imports so it can be tested as the pure function it
 * is — importing the seeding service pulls in a connection pool.
 */

/** Steam64 IDs are 17 digits; anything else is a typo, not an ID. */
const STEAM64_PATTERN = /^\d{17}$/;

export function parseAdminSteamIds(raw: string | undefined): {
  valid: string[];
  invalid: string[];
} {
  if (!raw || raw.trim().length === 0) return { valid: [], invalid: [] };

  const tokens = raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const token of tokens) {
    if (STEAM64_PATTERN.test(token)) {
      if (!valid.includes(token)) valid.push(token);
    } else {
      invalid.push(token);
    }
  }

  return { valid, invalid };
}

/*
 * The saved list (Settings -> Sign-in -> Admin Steam IDs), cached in memory
 * so request handlers can check it without a database round trip. Filled by
 * services/adminAccessSettings at boot and after every save.
 */
let savedAdminSteamIds: ReadonlySet<string> = new Set();

export function setSavedAdminSteamIds(raw: string | null | undefined): void {
  savedAdminSteamIds = new Set(parseAdminSteamIds(raw ?? undefined).valid);
}

export function isSavedAdminSteamId(id: string | null | undefined): boolean {
  return !!id && savedAdminSteamIds.has(id);
}
