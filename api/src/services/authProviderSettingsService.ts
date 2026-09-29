/**
 * Sign-in providers set up from Settings -> Sign-in.
 *
 * Each provider has an enabled flag, a client id and a client secret (Steam:
 * only the Web API key, kept as its "secret"). They are stored in
 * `auth_provider_settings`, the secret encrypted with `utils/secretBox`.
 *
 * The database is the source of truth. Environment variables
 * (`AUTH_<P>_ENABLED`, `<P>_CLIENT_ID`, `<P>_CLIENT_SECRET`; Steam:
 * `AUTH_STEAM_ENABLED`, `STEAM_API_KEY`) are imported once at boot into a
 * field that has no saved value (`importFromEnvironment`), then ignored.
 *
 * The rows are cached in memory so the synchronous readers (the Passport
 * setup, `/api/auth/providers`) can use them; `load()` fills the cache at
 * boot and after every save. Secrets never leave this module except to the
 * Passport strategies and the provider tests; `listForAdmin` returns only
 * whether one is set.
 */
import { db } from '../config/database';
import { markEnvImported, envImportedNames } from './envImport';
import { log } from '../utils/logger';
import { decryptSecret, encryptSecret, secretsKeySource, type SecretsKeySource } from '../utils/secretBox';
import {
  SIGN_IN_PROVIDERS,
  planProviderEnvImport,
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
  issuer_url: string | null;
  label: string | null;
  updated_at: number;
}

/** The provider cannot be changed (Epic Games: not available yet). */
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
        issuerUrl: row.issuer_url ?? null,
        label: row.label ?? null,
      });
    }
    setStoredProviderSettings(next);
  }

  /** The settings `id` runs with right now (the saved row, else the default). */
  getEffective(id: SignInProviderId): EffectiveProviderSettings {
    return effectiveProviderSettings(id);
  }

  /**
   * Boot: copy provider environment variables into fields that have no saved
   * value, once. Each variable is remembered (app_settings `env_imported`),
   * so it is never imported again, even after the admin clears the field.
   * Logs what was imported, never a value. Call after `load()`.
   */
  async importFromEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const stored = new Map<SignInProviderId, StoredProviderSettings>();
    for (const def of SIGN_IN_PROVIDERS) {
      const row = getStoredProviderSettings(def.id);
      if (row) stored.set(def.id, row);
    }
    const plan = planProviderEnvImport(env, stored, await envImportedNames());
    if (plan.length === 0) return;
    for (const item of plan) {
      if (item.value === null) {
        log.info(
          `[SETUP] ${item.envName} is set, but Settings -> Sign-in already has a value; the saved one is used. You can remove it from .env`
        );
        continue;
      }
      const patch: ProviderPatch =
        item.field === 'enabled'
          ? { enabled: item.value as boolean }
          : item.field === 'secret'
            ? { clientSecret: item.value as string }
            : { [item.field]: item.value as string };
      // An enabled flag imported alone must not switch a provider on or off
      // behind a saved row: the plan only offers it when there is no row.
      await this.update(item.provider, patch, 'environment');
      log.info(`[SETUP] imported ${item.envName} from environment; you can remove it from .env`);
    }
    await markEnvImported(plan.map((p) => p.envName));
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
      secretUnreadable: !!stored?.secretUnreadable,
      configured: effective.configured,
      active: effective.active,
      callbackUrl: `${backendBaseUrl}/api/auth/${def.id}/callback`,
      docsUrl: def.docsUrl,
      hasIssuer: !!def.hasIssuer,
      issuerUrl: effective.issuerUrl,
      buttonName: effective.label,
    };
  }

  /**
   * Save a patch for `id`. Logs what changed, never a value of the
   * secret. The caller re-registers the strategies.
   */
  async update(id: SignInProviderId, patch: ProviderPatch, actor: string | null): Promise<void> {
    const def = signInProviderDefinition(id);
    if (def.comingSoon) throw new EnvManagedFieldError(`${def.label} sign-in is not available yet`);
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
    const issuerUrl = patch.issuerUrl !== undefined ? patch.issuerUrl : (current?.issuer_url ?? null);
    const label = patch.label !== undefined ? patch.label : (current?.label ?? null);
    const now = Math.floor(Date.now() / 1000);

    await db.queryAsync(
      `INSERT INTO auth_provider_settings
         (provider, enabled, client_id, client_secret_enc, issuer_url, label, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         client_id = EXCLUDED.client_id,
         client_secret_enc = EXCLUDED.client_secret_enc,
         issuer_url = EXCLUDED.issuer_url,
         label = EXCLUDED.label,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by`,
      [id, enabled ? 1 : 0, clientId, secretEnc, issuerUrl, label, now, actor]
    );
    await this.load();

    // Audit: which fields changed and by whom. No values of the secret.
    log.info(`[SIGN-IN] ${def.label} sign-in settings changed`, {
      provider: id,
      actor,
      enabled: patch.enabled,
      clientIdChanged: patch.clientId !== undefined,
      issuerChanged: patch.issuerUrl !== undefined,
      labelChanged: patch.label !== undefined,
      secret: patch.clientSecret === undefined ? 'unchanged' : patch.clientSecret === null ? 'cleared' : 'replaced',
    });
  }
}

export const authProviderSettingsService = new AuthProviderSettingsService();
