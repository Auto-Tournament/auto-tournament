/**
 * Rules for the account "Connections" page (/me/connections): which sign-in
 * methods an account may remove, and the same-site check the state-changing
 * account routes use.
 *
 * Free of DB and Express imports so the rules can be unit-tested as they are.
 */

/** Sign-in providers that can be linked to an account next to its Steam ID. */
export const LINKABLE_PROVIDERS = ['discord', 'keycloak', 'github', 'google'] as const;
export type LinkableProvider = (typeof LINKABLE_PROVIDERS)[number];

export function isLinkableProvider(value: unknown): value is LinkableProvider {
  return typeof value === 'string' && (LINKABLE_PROVIDERS as readonly string[]).includes(value);
}

export type RemoveRefusal =
  /** Steam is the account's primary identity; it cannot be removed. */
  | 'primary'
  /** Nothing of that provider is linked to this account. */
  | 'not_linked'
  /** It is the last method this site would let the player sign in with. */
  | 'last_method';

/**
 * May this account remove `provider` from its sign-in methods?
 *
 * A method counts as a way to sign in only while this site has that provider
 * turned on (Steam included). Removing one that cannot be used to sign in
 * anyway locks nobody out, so only a usable method can be "the last one".
 */
export function checkRemoveSignInMethod(input: {
  provider: string;
  /** Providers with an identity linked to this account (non-Steam). */
  linkedProviders: readonly string[];
  /** Providers this site can sign in with right now, e.g. ['steam', 'github']. */
  enabledProviders: readonly string[];
}): { ok: true } | { ok: false; reason: RemoveRefusal } {
  const { provider, linkedProviders, enabledProviders } = input;
  if (provider === 'steam') return { ok: false, reason: 'primary' };
  if (!linkedProviders.includes(provider)) return { ok: false, reason: 'not_linked' };

  const enabled = new Set(enabledProviders);
  if (!enabled.has(provider)) return { ok: true };

  const remaining =
    (enabled.has('steam') ? 1 : 0) +
    new Set(linkedProviders.filter((p) => p !== provider && enabled.has(p))).size;
  return remaining > 0 ? { ok: true } : { ok: false, reason: 'last_method' };
}

interface HeaderSource {
  get(name: string): string | undefined;
}

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  const first = value.split(',')[0].trim();
  if (!first) return null;
  try {
    return new URL(first.includes('://') ? first : `http://${first}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * CSRF check for the account routes that change sign-in methods, on top of the
 * sameSite=lax identity cookies every state-changing route relies on (a
 * cross-site POST does not carry them).
 *
 * When the browser says where the request came from, it must be this site:
 * `Origin` (or `Referer` when there is no Origin) must name the same host as
 * the request, the proxy's forwarded host or FRONTEND_BASE_URL, and
 * `Sec-Fetch-Site` must not be `cross-site`. Hostnames are compared without
 * ports, so the Vite dev proxy (5173 -> 3000) passes. Requests without any of
 * these headers (curl, API clients) are left to the cookie rules.
 */
export function isSameSiteRequest(req: HeaderSource): boolean {
  if ((req.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') return false;

  const origin = req.get('origin');
  const source = origin !== undefined ? origin : req.get('referer');
  if (source === undefined || source === '') return true;
  if (source === 'null') return false;

  const sourceHost = hostnameOf(source);
  if (!sourceHost) return false;

  const allowed = [
    hostnameOf(req.get('host')),
    hostnameOf(req.get('x-forwarded-host')),
    hostnameOf(process.env.FRONTEND_BASE_URL),
  ].filter((h): h is string => !!h);
  return allowed.includes(sourceHost);
}
