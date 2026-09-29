/**
 * The sign-in providers Settings -> Sign-in manages, and the pure rules for
 * them: which settings win (environment over saved row over default) and
 * what a `PUT` may contain. No database access here, so the tests can import
 * it directly. The store is services/authProviderSettingsService.ts.
 */
export const SIGN_IN_PROVIDER_IDS = ['steam', 'discord', 'google', 'github', 'twitch', 'epic'] as const;
export type SignInProviderId = (typeof SIGN_IN_PROVIDER_IDS)[number];

export interface SignInProviderDefinition {
  id: SignInProviderId;
  label: string;
  /** Env var names. Steam has no client id. */
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

export type FieldSource = 'env' | 'db' | 'default' | null;

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

/**
 * The settings a provider runs with: the environment wins over the saved row,
 * field by field; the row wins over the default. Pure, for the tests.
 */
export function resolveProviderSettings(
  def: SignInProviderDefinition,
  env: NodeJS.ProcessEnv,
  stored: StoredProviderSettings | null
): EffectiveProviderSettings {
  const flag = envFlag(env, def.env.enabled);
  const enabled = flag ?? stored?.enabled ?? def.defaultEnabled;
  const enabledSource: FieldSource = flag !== undefined ? 'env' : stored ? 'db' : 'default';

  const envClientId = envValue(env, def.env.clientId);
  const clientId = def.env.clientId ? (envClientId ?? stored?.clientId ?? null) : null;
  const clientIdSource: FieldSource = envClientId ? 'env' : clientId ? 'db' : null;

  const envSecret = envValue(env, def.env.secret);
  const secret = envSecret ?? stored?.secret ?? null;
  const secretSource: FieldSource = envSecret ? 'env' : secret ? 'db' : null;

  const configured = !!secret && (def.env.clientId === null || !!clientId);
  return {
    id: def.id,
    enabled,
    clientId,
    secret,
    source: { enabled: enabledSource, clientId: clientIdSource, secret: secretSource },
    configured,
    active: enabled && configured && !def.comingSoon,
  };
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
  /** Fields the environment sets; read-only in the UI. */
  envManaged: { enabled: boolean; clientId: boolean; secret: boolean };
  envNames: { enabled: string; clientId: string | null; secret: string };
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

/** The settings `id` runs with right now: environment, then the saved row, then the default. */
export function effectiveProviderSettings(
  id: SignInProviderId,
  env: NodeJS.ProcessEnv = process.env
): EffectiveProviderSettings {
  return resolveProviderSettings(signInProviderDefinition(id), env, storedRows.get(id) ?? null);
}
