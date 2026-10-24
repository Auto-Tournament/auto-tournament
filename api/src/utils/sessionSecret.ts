/**
 * SESSION_SECRET signs the session cookie and every signed cookie, and keys
 * secretBox when SECRETS_KEY is unset. Outside production an unset value
 * falls back to a fixed development secret; in production the API refuses to
 * start without a real one (index.ts).
 */

const DEV_SESSION_SECRET = 'auto-tournament-dev-session-secret';
/** The development fallback and example.env's placeholder: an install that never set its own used one. */
export const KNOWN_SESSION_SECRETS = [DEV_SESSION_SECRET, 'change-this-session-secret'] as const;
const PLACEHOLDERS = new Set<string>(KNOWN_SESSION_SECRETS);
export const MIN_SESSION_SECRET_LENGTH = 32;

export function getSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SESSION_SECRET?.trim();
  if (secret) return secret;
  return DEV_SESSION_SECRET;
}

/** Why this environment's secret is not fit for production, or null when it is (or this is not production). */
export function sessionSecretProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV !== 'production') return null;
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) return 'SESSION_SECRET is not set';
  if (PLACEHOLDERS.has(secret)) return 'SESSION_SECRET is a placeholder value';
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    return `SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_LENGTH} characters`;
  }
  return null;
}
