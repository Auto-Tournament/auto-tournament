import { api } from '../../utils/api';

/** One row of "Sign-in methods" (`GET /api/me/connections`). */
export interface SignInMethod {
  provider: string;
  label: string;
  linked: boolean;
  /** Steam: the account's own identity. Never removable. */
  primary: boolean;
  /** Unix seconds; null when not linked or not recorded. */
  linkedAt: number | null;
  /** This site currently offers sign-in with this provider. */
  signInEnabled: boolean;
  canConnect: boolean;
  removable: boolean;
  /** `local` (the admin login): its username. */
  username?: string;
}

/** One row of "Game accounts", derived from the installed game modules. */
export interface GameAccount {
  provider: string;
  label: string;
  linked: boolean;
  verified: boolean;
  externalId: string | null;
  games: Array<{ id: string; name: string }>;
}

export interface ConnectionsResponse {
  account: { uid: string; steamId: string; name: string; avatar: string | null };
  isImpersonating: boolean;
  signInMethods: SignInMethod[];
  gameAccounts: GameAccount[];
  /** The account's admin login (username + password), or null. */
  localLogin: { username: string; totpEnabled: boolean; reauthFresh: boolean } | null;
  /** Steam answered with a Steam ID that already has a player here: merge it? */
  pendingMerge: { steamId: string; name: string; avatar: string | null; matches: number } | null;
}

export async function fetchConnections(): Promise<ConnectionsResponse> {
  return api.get<ConnectionsResponse>('/api/me/connections');
}

export async function removeSignInMethod(provider: string): Promise<ConnectionsResponse> {
  // A JSON body on purpose: the endpoint only accepts JSON requests.
  return api.post<ConnectionsResponse>(
    `/api/me/connections/${encodeURIComponent(provider)}/remove`,
    {}
  );
}

/**
 * Start linking `provider` to this account. A real form post (top-level
 * navigation), because the answer is a redirect to the provider; the API
 * redirects back to /me/connections?link=ok|taken|failed.
 */
export function startLink(provider: string): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `/api/auth/${encodeURIComponent(provider)}/link`;
  form.style.display = 'none';
  document.body.appendChild(form);
  form.submit();
}

/** A flag on an API error body, e.g. `reauthRequired` or `totpRequired`. */
export function apiErrorFlag(err: unknown, flag: string): boolean {
  try {
    const parsed = JSON.parse(err instanceof Error ? err.message : '') as Record<string, unknown>;
    return parsed[flag] === true;
  } catch {
    return false;
  }
}

/** Confirm the admin password (and TOTP code) again, for 10 minutes. */
export async function reconfirmPassword(password: string, totp?: string): Promise<void> {
  await api.post('/api/auth/local/reauth', totp ? { password, totp } : { password });
}

export async function mergeSteamPlayer(): Promise<{ steamId: string }> {
  return api.post<{ steamId: string }>('/api/me/connections/steam/merge', {});
}

export async function cancelSteamMerge(): Promise<void> {
  await api.post('/api/me/connections/steam/merge/cancel', {});
}
