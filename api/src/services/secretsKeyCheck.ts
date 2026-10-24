import { db } from '../config/database';
import { log } from '../utils/logger';
import { previousSecretsKey } from '../utils/secretsKeyHint';

/** Boot: warn when stored secrets open only with a known default key. Never throws. */
export async function checkStoredSecretsKey(): Promise<void> {
  try {
    const rows = await db.queryAsync<{ v: string }>(
      `SELECT client_secret_enc AS v FROM auth_provider_settings WHERE client_secret_enc IS NOT NULL
       UNION ALL SELECT totp_secret_enc FROM local_admins WHERE totp_secret_enc IS NOT NULL
       UNION ALL SELECT password_enc FROM email_settings WHERE password_enc IS NOT NULL`,
      []
    );
    const key = previousSecretsKey(rows.map((r) => r.v));
    if (key) {
      log.warn(
        `[SECRETS] Saved secrets (sign-in provider secrets, the Steam Web API key, two-step verification, the SMTP password) do not open with the current key, but do with "${key}": the key they were saved with changed (usually SESSION_SECRET, with SECRETS_KEY unset). Set SECRETS_KEY=${key} and restart to read them again.`
      );
    }
  } catch (error) {
    log.warn('[SECRETS] Could not check the saved secrets', { error });
  }
}
