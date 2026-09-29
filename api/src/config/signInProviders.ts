/**
 * The sign-in providers Settings -> Sign-in manages, and the pure rules for
 * them: the saved row over the default, what a `PUT` may contain, and which
 * environment variables are imported once into the saved rows
 * (`planProviderEnvImport`). The environment is not read at run time: the
 * database is the source of truth. No database access here, so the tests can import
 * it directly. The store is services/authProviderSettingsService.ts.
 */
export const SIGN_IN_PROVIDER_IDS = ['steam', 'discord', 'google', 'github', 'twitch', 'epic'] as const;
export type SignInProviderId = (typeof SIGN_IN_PROVIDER_IDS)[number];

export interface SignInProviderDefinition {
  id: SignInProviderId;
  label: string;
  /** Env var names, imported once at boot. Steam has no client id. */
  env: { enabled: string; clientId: string | null; secret: string };
  /** Enabled when neither the environment nor a saved row says otherwise. */
  defaultEnabled: boolean;
  /** Where the admin creates the app / key. */
  docsUrl: string;
  /** Listed, but cannot be set up yet. */
  comingSoon?: boolean;
}

export const SIGN_IN_PROVIDERS: readonly SignInProviderDefinition[] = [
  {
    id: 'steam',
    label: 'Steam',
    env: { enabled: 'AUTH_STEAM_ENABLED', clientId: null, secret: 'STEAM_API_KEY' },
    // Steam has always been on unless AUTH_STEAM_ENABLED says otherwise.
    defaultEnabled: true,
    docsUrl: 'https://steamcommunity.com/dev/apikey',
  },
  {
    id: 'discord',
    label: 'Discord',
    env: { enabled: 'AUTH_DISCORD_ENABLED', clientId: 'DISCORD_CLIENT_ID', secret: 'DISCORD_CLIENT_SECRET' },
    defaultEnabled: false,
    docsUrl: 'https://discord.com/developers/applications',
  },
  {
    id: 'google',
    label: 'Google',
    env: { enabled: 'AUTH_GOOGLE_ENABLED', clientId: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
    defaultEnabled: false,
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  {
    id: 'github',
    label: 'GitHub',
    env: { enabled: 'AUTH_GITHUB_ENABLED', clientId: 'GITHUB_CLIENT_ID', secret: 'GITHUB_CLIENT_SECRET' },
    defaultEnabled: false,
    docsUrl: 'https://github.com/settings/developers',
  },
  {
    id: 'twitch',
    label: 'Twitch',
    env: { enabled: 'AUTH_TWITCH_ENABLED', clientId: 'TWITCH_CLIENT_ID', secret: 'TWITCH_CLIENT_SECRET' },
    defaultEnabled: false,
    docsUrl: 'https://dev.twitch.tv/console/apps',
  },
  {
    id: 'epic',
    label: 'Epic Games',
    env: { enabled: 'AUTH_EPIC_ENABLED', clientId: 'EPIC_CLIENT_ID', secret: 'EPIC_CLIENT_SECRET' },
    defaultEnabled: false,
    docsUrl: 'https://dev.epicgames.com/portal',
    comingSoon: true,
  },
];

export function isSignInProviderId(value: unknown): value is SignInProviderId {
  return typeof value === 'string' && (SIGN_IN_PROVIDER_IDS as readonly string[]).includes(value);
}

export function signInProviderDefinition(id: SignInProviderId): SignInProviderDefinition {
  return SIGN_IN_PROVIDERS.find((p) => p.id === id)!;
}

/** A saved row, secret already decrypted (null when unset or unreadable). */
export interface StoredProviderSettings {
  enabled: boolean;
  clientId: string | null;
  secret: string | null;
  /** A secret is stored but could not be decrypted (the key changed). */
  secretUnreadable?: boolean;
  updatedAt?: number;
}

export type FieldSource = 'db' | 'default' | null;

export interface EffectiveProviderSettings {
  id: SignInProviderId;
  enabled: boolean;
  clientId: string | null;
  secret: string | null;
  source: { enabled: FieldSource; clientId: FieldSource; secret: FieldSource };
  /** Has every credential it needs. */
  configured: boolean;
  /** Enabled, configured and not "coming soon": offered on the login page. */
  active: boolean;
}

function envValue(env: NodeJS.ProcessEnv, name: string | null): string | undefined {
  if (!name) return undefined;
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function envFlag(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  return value === '1' || value === 'true' || value === 'yes';
}

/** The settings a provider runs with: the saved row, else the default. Pure, for the tests. */
export function resolveProviderSettings(
  def: SignInProviderDefinition,
  stored: StoredProviderSettings | null
): EffectiveProviderSettings {
  const enabled = stored?.enabled ?? def.defaultEnabled;
  const clientId = def.env.clientId ? (stored?.clientId ?? null) : null;
  const secret = stored?.secret ?? null;
  const configured = !!secret && (def.env.clientId === null || !!clientId);
  return {
    id: def.id,
    enabled,
    clientId,
    secret,
    source: { enabled: stored ? 'db' : 'default', clientId: clientId ? 'db' : null, secret: secret ? 'db' : null },
    configured,
    active: enabled && configured && !def.comingSoon,
  };
}

/** One environment variable to copy into a provider's saved row. */
export interface ProviderEnvImport {
  provider: SignInProviderId;
  field: 'enabled' | 'clientId' | 'secret';
  envName: string;
  /** What to save; null when the database already has a value (the variable is then only marked as seen). */
  value: boolean | string | null;
}

/**
 * Which provider environment variables to import into the database, once.
 * A variable is imported when it is set, has not been seen before
 * (`alreadySeen`) and the saved row has no value for that field; a variable
 * whose field is already saved is only marked as seen (value null), so the
 * database keeps winning. Pure, for the tests.
 */
export function planProviderEnvImport(
  env: NodeJS.ProcessEnv,
  stored: ReadonlyMap<SignInProviderId, StoredProviderSettings>,
  alreadySeen: ReadonlySet<string>
): ProviderEnvImport[] {
  const out: ProviderEnvImport[] = [];
  for (const def of SIGN_IN_PROVIDERS) {
    if (def.comingSoon) continue;
    const row = stored.get(def.id) ?? null;
    const flag = envFlag(env, def.env.enabled);
    if (flag !== undefined && !alreadySeen.has(def.env.enabled)) {
      out.push({ provider: def.id, field: 'enabled', envName: def.env.enabled, value: row ? null : flag });
    }
    const clientId = envValue(env, def.env.clientId);
    if (def.env.clientId && clientId && !alreadySeen.has(def.env.clientId)) {
      out.push({ provider: def.id, field: 'clientId', envName: def.env.clientId, value: row?.clientId ? null : clientId });
    }
    const secret = envValue(env, def.env.secret);
    // A saved secret that no longer decrypts still counts as a value: the
    // admin enters it again in the UI rather than the environment silently
    // replacing it.
    const hasSecret = !!row && (!!row.secret || !!row.secretUnreadable);
    if (secret && !alreadySeen.has(def.env.secret)) {
      out.push({ provider: def.id, field: 'secret', envName: def.env.secret, value: hasSecret ? null : secret });
    }
  }
  return out;
}

/** What Settings -> Sign-in shows. Never carries a secret. */
export interface AdminProviderView {
  id: SignInProviderId;
  label: string;
  comingSoon: boolean;
  enabled: boolean;
  /** Steam has none. */
  hasClientId: boolean;
  clientId: string | null;
  secretSet: boolean;
  /** A saved secret no longer decrypts (SECRETS_KEY / SESSION_SECRET changed). */
  secretUnreadable: boolean;
  configured: boolean;
  active: boolean;
  callbackUrl: string;
  docsUrl: string;
}

export interface ProviderPatch {
  enabled?: boolean;
  clientId?: string | null;
  /** A new secret; null clears the saved one. Absent keeps it. */
  clientSecret?: string | null;
}

/** Longest client id / secret accepted. Real ones are far shorter. */
const MAX_CLIENT_ID = 256;
const MAX_SECRET = 512;
// Printable ASCII, no spaces: every provider's ids, secrets and keys fit.
const CREDENTIAL_RE = /^[\x21-\x7e]+$/;

/**
 * Check a `PUT` body. Returns the patch, or the error for a 400. Pure.
 */
export function parseProviderPatch(
  def: SignInProviderDefinition,
  body: unknown
): { ok: true; patch: ProviderPatch } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Send a JSON object' };
  }
  const input = body as Record<string, unknown>;
  const allowed = new Set(['enabled', 'clientId', 'clientSecret']);
  const unknown = Object.keys(input).filter((k) => !allowed.has(k));
  if (unknown.length > 0) return { ok: false, error: `Unknown field: ${unknown[0]}` };

  const patch: ProviderPatch = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') return { ok: false, error: 'enabled must be true or false' };
    patch.enabled = input.enabled;
  }
  if (input.clientId !== undefined) {
    if (!def.env.clientId) return { ok: false, error: `${def.label} has no client id` };
    if (input.clientId === null || input.clientId === '') patch.clientId = null;
    else if (typeof input.clientId !== 'string') return { ok: false, error: 'clientId must be a string' };
    else {
      const value = input.clientId.trim();
      if (value.length > MAX_CLIENT_ID || !CREDENTIAL_RE.test(value)) {
        return { ok: false, error: 'The client id has characters or a length no provider uses' };
      }
      patch.clientId = value;
    }
  }
  if (input.clientSecret !== undefined) {
    if (input.clientSecret === null || input.clientSecret === '') patch.clientSecret = null;
    else if (typeof input.clientSecret !== 'string') return { ok: false, error: 'clientSecret must be a string' };
    else {
      const value = input.clientSecret.trim();
      if (value.length > MAX_SECRET || !CREDENTIAL_RE.test(value)) {
        return { ok: false, error: 'The secret has characters or a length no provider uses' };
      }
      patch.clientSecret = value;
    }
  }
  return { ok: true, patch };
}

/*
 * The saved rows, decrypted, as last loaded by
 * services/authProviderSettingsService. Kept here (not in the service) so the
 * synchronous readers need no database import.
 */
let storedRows = new Map<SignInProviderId, StoredProviderSettings>();

export function setStoredProviderSettings(rows: Map<SignInProviderId, StoredProviderSettings>): void {
  storedRows = rows;
}

export function getStoredProviderSettings(id: SignInProviderId): StoredProviderSettings | null {
  return storedRows.get(id) ?? null;
}

/** The settings `id` runs with right now: the saved row, then the default. */
export function effectiveProviderSettings(id: SignInProviderId): EffectiveProviderSettings {
  return resolveProviderSettings(signInProviderDefinition(id), storedRows.get(id) ?? null);
}
