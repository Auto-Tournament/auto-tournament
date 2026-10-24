/**
 * After SESSION_SECRET changes with SECRETS_KEY unset, secrets stored under
 * the old value no longer open (utils/secretBox.ts). When the old value was a
 * known default, this names it, so the operator can put it in SECRETS_KEY.
 */
import { decryptSecret } from './secretBox';
import { KNOWN_SESSION_SECRETS } from './sessionSecret';

/** The known default that opens a stored value the current key cannot, or null. */
export function previousSecretsKey(
  stored: Array<string | null | undefined>,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const unreadable = stored.filter((v): v is string => !!v && decryptSecret(v, env) === null);
  if (unreadable.length === 0) return null;
  for (const candidate of KNOWN_SESSION_SECRETS) {
    if (unreadable.some((v) => decryptSecret(v, { SECRETS_KEY: candidate }) !== null)) {
      return candidate;
    }
  }
  return null;
}
