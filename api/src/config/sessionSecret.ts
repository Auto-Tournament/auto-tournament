/**
 * The secret that signs sessions and our signed cookies (player, impersonation,
 * pending Steam link, OAuth state).
 *
 * SESSION_SECRET when it is set to something of our own. Unset, or left at a
 * value anyone can read in this repository (example.env's placeholder, the old
 * built-in fallbacks), anyone could sign an admin cookie, so a random secret is
 * made once and kept in DATA_DIR instead: it survives restarts and updates.
 * Sessions signed with the old value end, once; people sign in again.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './dataDir';
import { log } from '../utils/logger';

export const PUBLIC_SESSION_SECRETS = new Set([
  'change-this-session-secret',
  'auto-tournament-dev-session-secret',
  'matchzy-dev-session-secret',
]);

let cached: string | null = null;

export function sessionSecret(): string {
  return (cached ??= resolveSessionSecret(process.env, DATA_DIR));
}

/** SESSION_SECRET, or the one kept in `dataDir` (made the first time). */
export function resolveSessionSecret(env: NodeJS.ProcessEnv, dataDir: string): string {
  const set = env.SESSION_SECRET?.trim();
  if (set && !PUBLIC_SESSION_SECRETS.has(set)) return set;

  const file = path.join(dataDir, 'session-secret');
  let secret = '';
  try {
    secret = fs.readFileSync(file, 'utf8').trim();
  } catch {
    // not made yet
  }
  if (!secret) {
    secret = crypto.randomBytes(32).toString('base64url');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
  }
  log.warn(
    `[SECURITY] SESSION_SECRET is ${set ? 'a public placeholder' : 'not set'}; using the random secret in ${file}`
  );
  return secret;
}
