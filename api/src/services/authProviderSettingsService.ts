/**
 * Sign-in providers set up from Settings -> Sign-in.
 *
 * Each provider has an enabled flag, a client id and a client secret (Steam:
 * only the Web API key, kept as its "secret"). They are stored in
 * `auth_provider_settings`, the secret encrypted with `utils/secretBox`.
 *
 * Environment variables win, field by field: `AUTH_<P>_ENABLED`,
 * `<P>_CLIENT_ID`, `<P>_CLIENT_SECRET` (Steam: `AUTH_STEAM_ENABLED`,
 * `STEAM_API_KEY`). A field set by the environment is read-only in the UI.
 *
 * The rows are cached in memory so the synchronous readers (the Passport
 * setup, `/api/auth/providers`) can use them; `load()` fills the cache at
 * boot and after every save. Secrets never leave this module except to the
 * Passport strategies and the provider tests; `listForAdmin` returns only
 * whether one is set.
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { decryptSecret, encryptSecret, secretsKeySource, type SecretsKeySource } from '../utils/secretBox';
import {
  SIGN_IN_PROVIDERS,
  effectiveProviderSettings,
  getStoredProviderSettings,
  isSignInProviderId,
  setStoredProviderSettings,
  signInProviderDefinition,
  type AdminProviderView,
  type EffectiveProviderSettings,
  type ProviderPatch,
  type SignInProviderDefinition,
  type SignInProviderId,
  type StoredProviderSettings,
} from '../config/signInProviders';

interface ProviderRow {
  provider: string;
  enabled: number;
  client_id: string | null;
  client_secret_enc: string | null;
  updated_at: number;
}

export class EnvManagedFieldError extends Error {}

class AuthProviderSettingsService {
  /** Read every saved row into the cache. Call at boot (after the schema) and after a save. */
  async load(): Promise<void> {
    const rows = await db.queryAsync<ProviderRow>('SELECT * FROM auth_provider_settings', []);
    const next = new Map<SignInProviderId, StoredProviderSettings>();
    for (const row of rows) {
      if (!isSignInProviderId(row.provider)) continue;
      const secret = decryptSecret(row.client_secret_enc);
      const secretUnreadable = !!row.client_secret_enc && secret === null;
      if (secretUnreadable) {
        log.warn(
          `[SIGN-IN] The saved ${row.provider} secret cannot be decrypted (SECRETS_KEY or SESSION_SECRET changed?). ` +
            'Enter it again on Settings -> Sign-in.'
        );
      }
      next.set(row.provider, {
        enabled: Number(row.enabled) === 1,
        clientId: row.client_id,
        secret,
        secretUnreadable,
        updatedAt: Number(row.updated_at),
      });
    }
    setStoredProviderSettings(next);
  }

  /** The settings `id` runs with right now (environment first, then the saved row). */
  getEffective(id: SignInProviderId, env: NodeJS.ProcessEnv = process.env): EffectiveProviderSettings {
    return effectiveProviderSettings(id, env);
  }

  /** Whether any provider is offered on the login page. */
  anyActive(): boolean {
    return SIGN_IN_PROVIDERS.some((p) => this.getEffective(p.id).active);
  }

  keySource(): SecretsKeySource {
    return secretsKeySource();
  }

  listForAdmin(backendBaseUrl: string): AdminProviderView[] {
    return SIGN_IN_PROVIDERS.map((def) => this.viewFor(def, backendBaseUrl));
  }

  viewFor(def: SignInProviderDefinition, backendBaseUrl: string): AdminProviderView {
    const effective = this.getEffective(def.id);
    const stored = getStoredProviderSettings(def.id);
    return {
      id: def.id,
      label: def.label,
      comingSoon: !!def.comingSoon,
      enabled: effective.enabled,
      hasClientId: def.env.clientId !== null,
      clientId: effective.clientId,
      secretSet: !!effective.secret,
      secretUnreadable: effective.source.secret !== 'env' && !!stored?.secretUnreadable,
      envManaged: {
        enabled: effective.source.enabled === 'env',
        clientId: effective.source.clientId === 'env',
        secret: effective.source.secret === 'env',
      },
      envNames: def.env,
      configured: effective.configured,
      active: effective.active,
      callbackUrl: `${backendBaseUrl}/api/auth/${def.id}/callback`,
      docsUrl: def.docsUrl,
    };
  }

  /**
   * Save a patch for `id`. A field the environment sets cannot be changed
   * here (EnvManagedFieldError). Logs what changed, never a value of the
   * secret. The caller re-registers the strategies.
   */
  async update(id: SignInProviderId, patch: ProviderPatch, actor: string | null): Promise<void> {
    const def = signInProviderDefinition(id);
    if (def.comingSoon) throw new EnvManagedFieldError(`${def.label} sign-in is not available yet`);
    const effective = this.getEffective(id);
    if (patch.enabled !== undefined && effective.source.enabled === 'env') {
      throw new EnvManagedFieldError(`Enabled is set by ${def.env.enabled}`);
    }
    if (patch.clientId !== undefined && effective.source.clientId === 'env') {
      throw new EnvManagedFieldError(`The client id is set by ${def.env.clientId}`);
    }
    if (patch.clientSecret !== undefined && effective.source.secret === 'env') {
      throw new EnvManagedFieldError(`The secret is set by ${def.env.secret}`);
    }

    const current = await db.queryOneAsync<ProviderRow>(
      'SELECT * FROM auth_provider_settings WHERE provider = ?',
      [id]
    );
    const enabled =
      patch.enabled !== undefined ? patch.enabled : current ? Number(current.enabled) === 1 : def.defaultEnabled;
    const clientId = patch.clientId !== undefined ? patch.clientId : (current?.client_id ?? null);
    const secretEnc =
      patch.clientSecret !== undefined
        ? patch.clientSecret === null
          ? null
          : encryptSecret(patch.clientSecret)
        : (current?.client_secret_enc ?? null);
    const now = Math.floor(Date.now() / 1000);

    await db.queryAsync(
      `INSERT INTO auth_provider_settings (provider, enabled, client_id, client_secret_enc, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         client_id = EXCLUDED.client_id,
         client_secret_enc = EXCLUDED.client_secret_enc,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by`,
      [id, enabled ? 1 : 0, clientId, secretEnc, now, actor]
    );
    await this.load();

    // Audit: which fields changed and by whom. No values of the secret.
    log.info(`[SIGN-IN] ${def.label} sign-in settings changed`, {
      provider: id,
      actor,
      enabled: patch.enabled,
      clientIdChanged: patch.clientId !== undefined,
      secret: patch.clientSecret === undefined ? 'unchanged' : patch.clientSecret === null ? 'cleared' : 'replaced',
    });
  }
}

export const authProviderSettingsService = new AuthProviderSettingsService();
