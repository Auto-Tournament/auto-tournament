/**
 * API utility functions
 *
 * Uses relative paths (/api/*) which work in both environments:
 * - Development: Vite proxy forwards /api/* → localhost:3000
 * - Production: Caddy proxy forwards /api/* → localhost:3000 (internal)
 *
 * All API calls should use '/api' prefix (e.g., '/api/servers', '/api/teams')
 */

/**
 * Which tournament requests are about (the API's `X-Tournament-Id`): the one
 * the admin picked in the rail, kept across reloads, except on a tournament's
 * own page, which is about the tournament in its URL.
 * Without either the API answers for the featured tournament.
 */
const ADMIN_SCOPE_KEY = 'at:adminTournamentId';
function readStoredScope(): number | null {
  try {
    const id = Number(window.localStorage.getItem(ADMIN_SCOPE_KEY));
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
let adminScope: number | null = typeof window === 'undefined' ? null : readStoredScope();

export function getAdminTournamentScope(): number | null {
  return adminScope;
}

export function setAdminTournamentScope(id: number | null): void {
  adminScope = id;
  try {
    if (id === null) window.localStorage.removeItem(ADMIN_SCOPE_KEY);
    else window.localStorage.setItem(ADMIN_SCOPE_KEY, String(id));
  } catch {
    // Storage blocked: the pick lasts until the page reloads.
  }
}

/** On a tournament's own page (`/tournament/<id>/...`), that tournament. */
function pageScope(): number | null {
  if (typeof window === 'undefined') return null;
  const m = /^\/tournament\/(\d+)(?:\/|$)/.exec(window.location.pathname);
  return m ? Number(m[1]) : null;
}

function tournamentScope(): number | null {
  return pageScope() ?? adminScope;
}

/** Fired when the API answers `license_expired` (api/src/middleware/licenseExpired.ts); components/license/LicenseGate.tsx shows the page. */
export const LICENSE_EXPIRED_EVENT = 'at:license-expired';

export const api = {
  /**
   * Make an authenticated API request
   */
  async fetch(endpoint: string, options: RequestInit = {}) {
    const { headers, ...rest } = options;
    const response = await fetch(endpoint, {
      // Send cookies for same-origin requests by default so admin-only routes
      // like /api/maps work correctly. The app is served from the same origin
      // (via Caddy/Vite proxy), so 'same-origin' is appropriate and more secure
      // than 'include' which would send cookies on cross-origin requests.
      // Callers can still override this if needed (e.g., set credentials: 'include'
      // for cross-origin requests) by passing credentials in options.
      credentials: options.credentials ?? 'same-origin',
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(tournamentScope() ? { 'X-Tournament-Id': String(tournamentScope()) } : {}),
        ...(headers || {}),
      },
    });

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 503 && error.includes('"license_expired"')) {
        let reason: string | null = null;
        try {
          reason = (JSON.parse(error) as { reason?: string | null }).reason ?? null;
        } catch {
          reason = null;
        }
        window.dispatchEvent(new CustomEvent(LICENSE_EXPIRED_EVENT, { detail: { reason } }));
      }
      // Proxies (Cloudflare, Caddy) answer 502/504 with an HTML page; showing
      // that raw leaves an empty or unreadable toast.
      const readable = error && !/^\s*</.test(error) ? error : '';
      throw new Error(
        readable || `API request failed: ${response.status} ${response.statusText}`.trim()
      );
    }

    return response.json();
  },

  /**
   * GET request
   */
  async get<T = unknown>(endpoint: string): Promise<T> {
    return this.fetch(endpoint, { method: 'GET' });
  },

  /**
   * POST request
   */
  async post<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.fetch(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  /**
   * PUT request
   */
  async put<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.fetch(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  /**
   * PATCH request
   */
  async patch<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.fetch(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  /**
   * DELETE request
   */
  async delete(endpoint: string) {
    return this.fetch(endpoint, { method: 'DELETE' });
  },

};

/**
 * The API answers validation failures with `{ error: string }`, and `api.fetch`
 * throws the raw body as the message. Pull the readable part out.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : '';
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
  } catch {
    // Not JSON: use the text as-is.
  }
  return raw;
}
