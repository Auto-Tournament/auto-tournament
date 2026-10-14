/**
 * Service tokens — machine authentication for the admin API.
 *
 * Admin auth is otherwise entirely browser-shaped: a Passport session cookie,
 * or the signed `player_steam_id` cookie as a fallback when a reverse proxy
 * drops the session. Both of those assume a human who has been through Steam
 * login, which a Discord bot or a cron job has not and cannot.
 *
 * Service tokens are the way in for those. A token is a shared secret held by
 * one integration; presenting it grants the same access an admin session
 * would, without a Steam ID behind it.
 *
 * Three variables, so scope is decided by *which* one you put the token in
 * rather than by parsing a scope out of the value:
 *   - `API_TOKENS`          — full admin. Every route an admin can reach.
 *   - `API_TOKENS_READONLY` — GET/HEAD/OPTIONS only. Enough to read matches,
 *                             scoreboards and brackets; nothing that changes
 *                             state. Most bots only ever need this one.
 *   - `API_TOKENS_INTEGRATOR` — the integrations API only (`/api/integrations`,
 *                             e.g. the teams API an event website pushes its
 *                             teams through). Refused everywhere else. The
 *                             label is the integrator's *source*: the
 *                             namespace its `externalId`s live in, so keep
 *                             it stable.
 *
 * Entries are separated by commas, semicolons or whitespace. Each entry is
 * either `label:secret` or a bare `secret`. The label is only ever used in
 * logs, so an operator can tell which integration made a call — the secret
 * itself is never logged, only a short fingerprint of its hash.
 *
 * Kept free of Express and database imports so it can be tested as the pure
 * function it is.
 */

import crypto from 'crypto';

export type ServiceTokenScope = 'admin' | 'readonly' | 'integrator';

export interface ServiceToken {
  /** Human-readable name for logs. Falls back to `token-<fingerprint>`. */
  label: string;
  scope: ServiceTokenScope;
  /** SHA-256 of the secret. The secret itself is never retained. */
  hash: Buffer;
  /** First 8 hex chars of the hash — safe to log, enough to correlate. */
  fingerprint: string;
}

export interface ParsedServiceTokens {
  tokens: ServiceToken[];
  /** Human-readable complaints about entries that were skipped. */
  problems: string[];
}

/**
 * Short enough to type, long enough that guessing it is hopeless.
 * `openssl rand -hex 32` gives 64 chars and is what the docs recommend.
 */
export const MIN_TOKEN_LENGTH = 16;

/** Labels stay boring so `label:secret` can never be ambiguous to split. */
const LABEL_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function fingerprintOf(hash: Buffer): string {
  return hash.toString('hex').slice(0, 8);
}

/**
 * Split one entry into label and secret.
 *
 * The separator is the *first* colon, and only when what precedes it looks
 * like a label. Hex and base64 secrets contain no colons, so a bare secret is
 * never mistaken for a labelled one.
 */
function splitEntry(entry: string): { label: string | null; secret: string } {
  const i = entry.indexOf(':');
  if (i <= 0) return { label: null, secret: entry };

  const label = entry.slice(0, i);
  const secret = entry.slice(i + 1);
  if (!LABEL_PATTERN.test(label) || secret.length === 0) {
    return { label: null, secret: entry };
  }
  return { label, secret };
}

function parseOne(
  raw: string | undefined,
  scope: ServiceTokenScope,
  envName: string,
  seen: Set<string>,
  tokens: ServiceToken[],
  problems: string[]
): void {
  if (!raw || raw.trim().length === 0) return;

  const entries = raw
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  for (const entry of entries) {
    const { label, secret } = splitEntry(entry);

    if (secret.length < MIN_TOKEN_LENGTH) {
      problems.push(
        `${envName}: ignoring ${label ? `"${label}"` : 'an entry'} — the secret is ` +
          `${secret.length} characters, minimum is ${MIN_TOKEN_LENGTH}`
      );
      continue;
    }

    const hash = sha256(secret);
    const fingerprint = fingerprintOf(hash);
    const key = hash.toString('hex');

    if (seen.has(key)) {
      problems.push(
        `${envName}: ignoring a duplicate of token ${fingerprint} — it is already configured`
      );
      continue;
    }
    seen.add(key);

    tokens.push({
      label: label ?? `token-${fingerprint}`,
      scope,
      hash,
      fingerprint,
    });
  }
}

/**
 * Parse both token variables into one registry.
 *
 * Never throws: a malformed value should not stop the server from starting,
 * it should say so and carry on. A token that was skipped simply does not
 * authenticate, which surfaces as a 401 the first time the bot calls.
 */
export function parseServiceTokens(
  adminRaw: string | undefined,
  readonlyRaw: string | undefined,
  integratorRaw?: string | undefined
): ParsedServiceTokens {
  const tokens: ServiceToken[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();

  // Admin first, so that a secret listed in both variables keeps the wider
  // scope rather than being silently downgraded by ordering.
  parseOne(adminRaw, 'admin', 'API_TOKENS', seen, tokens, problems);
  parseOne(readonlyRaw, 'readonly', 'API_TOKENS_READONLY', seen, tokens, problems);
  parseOne(integratorRaw, 'integrator', 'API_TOKENS_INTEGRATOR', seen, tokens, problems);

  return { tokens, problems };
}

/**
 * Find the configured token matching a presented secret.
 *
 * Compares SHA-256 digests rather than the secrets themselves: the digests are
 * always the same length, so `timingSafeEqual` never has to be skipped for a
 * length mismatch and the comparison leaks nothing about how much of a guess
 * was right.
 */
export function findServiceToken(presented: string, tokens: ServiceToken[]): ServiceToken | null {
  if (!presented || presented.length === 0) return null;

  const presentedHash = sha256(presented);
  for (const token of tokens) {
    if (crypto.timingSafeEqual(presentedHash, token.hash)) return token;
  }
  return null;
}

/** Methods a readonly token is allowed to use. */
export function isReadOnlyMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/**
 * Pull the presented secret out of request headers.
 *
 * `Authorization: Bearer <token>` is the documented form — it is what the
 * OpenAPI spec has always advertised. `X-API-Token: <token>` is accepted too,
 * for clients whose HTTP layer reserves the Authorization header.
 */
export function extractPresentedToken(headers: {
  authorization?: string | string[];
  'x-api-token'?: string | string[];
}): string | null {
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const auth = first(headers.authorization);
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) {
      const value = match[1].trim();
      if (value.length > 0) return value;
    }
  }

  const header = first(headers['x-api-token']);
  if (typeof header === 'string' && header.trim().length > 0) return header.trim();

  return null;
}

/**
 * The registry, rebuilt whenever the environment changes.
 *
 * Parsing is cheap but not free, and this runs on every admin request, so the
 * result is cached against the raw values it was built from. Keying on the
 * values rather than caching once also means tests can set the variables and
 * see the change without reaching into module internals.
 */
let cache: { key: string; parsed: ParsedServiceTokens } | null = null;

/** Tokens an admin made in Settings (services/apiTokenService), loaded from the database. */
let stored: ServiceToken[] = [];

/** Replace the Settings-made tokens (services/apiTokenService calls this after every change). */
export function setStoredServiceTokens(tokens: ServiceToken[]): void {
  stored = tokens;
  cache = null;
}

/** The env tokens and the Settings-made ones together; an env token wins a duplicate. */
export function getServiceTokens(): ParsedServiceTokens {
  const adminRaw = process.env.API_TOKENS;
  const readonlyRaw = process.env.API_TOKENS_READONLY;
  const integratorRaw = process.env.API_TOKENS_INTEGRATOR;
  const key = `${adminRaw ?? ''} ${readonlyRaw ?? ''} ${integratorRaw ?? ''}`;

  if (cache && cache.key === key) return cache.parsed;

  const parsed = parseServiceTokens(adminRaw, readonlyRaw, integratorRaw);
  const seen = new Set(parsed.tokens.map((t) => t.hash.toString('hex')));
  for (const token of stored) {
    if (!seen.has(token.hash.toString('hex'))) parsed.tokens.push(token);
  }
  cache = { key, parsed };
  return parsed;
}

/** Whether a token was made in Settings (so its last use is worth noting). */
export function isStoredServiceToken(fingerprint: string): boolean {
  return stored.some((t) => t.fingerprint === fingerprint);
}

/** SHA-256 and fingerprint of a new secret, for storing it (the secret is never kept). */
export function hashServiceToken(secret: string): { hash: Buffer; fingerprint: string } {
  const hash = sha256(secret);
  return { hash, fingerprint: fingerprintOf(hash) };
}

/** True when at least one usable token is configured. */
export function hasServiceTokens(): boolean {
  return getServiceTokens().tokens.length > 0;
}
