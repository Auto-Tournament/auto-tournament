import { Page, APIRequestContext, expect } from '@playwright/test';

/**
 * Authentication helper functions
 *
 * ## Two cookie jars
 *
 * Playwright's `page` and the standalone `request` fixture do **not** share
 * cookies. `page.request` uses the browser context's jar; the `request` fixture
 * has its own. API-driven tests therefore have to sign in on *both*, otherwise
 * admin-guarded endpoints reject the `request` calls with
 * "Unauthorized - Admin session required".
 *
 * Use `setupTestContext()` (helpers/setup.ts) which does this for you.
 */

export const DEFAULT_ADMIN_STEAM_ID = process.env.TEST_STEAM_ID || '76561198000000001';
export const DEFAULT_PLAYER_STEAM_ID = '76561198000000002';

/**
 * Sign in as admin on a Playwright APIRequestContext.
 *
 * Hits the test-only admin endpoint, which creates a Passport session *and*
 * sets the signed player_steam_id cookie. Both land in this context's cookie
 * jar, so subsequent `request.*` calls are authenticated.
 *
 * Works with either the `request` fixture or `page.request`.
 */
export async function signInViaRequest(
  request: APIRequestContext,
  steamId: string = DEFAULT_ADMIN_STEAM_ID
): Promise<boolean> {
  try {
    const response = await request.post('/api/test/login-admin', {
      data: { steamId },
    });

    if (!response.ok()) {
      console.error('login-admin test helper failed:', await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('Sign in via request context failed:', error);
    return false;
  }
}

/**
 * Does this context currently hold an authenticated admin session?
 *
 * Asks the API directly. Inferring this from the browser URL is unreliable: the
 * SPA decides whether to bounce to /login only after it has bootstrapped and
 * called /api/auth/admin/me, so straight after a `domcontentloaded` navigation
 * the URL still reads as the requested page for a session that is about to be
 * rejected.
 */
export async function isAdminAuthenticated(request: APIRequestContext): Promise<boolean> {
  try {
    const response = await request.get('/api/auth/admin/me');
    if (!response.ok()) return false;
    const data = (await response.json()) as { authenticated?: boolean };
    return data.authenticated === true;
  } catch {
    return false;
  }
}

/**
 * Sign in via a test-only admin endpoint that creates a Passport session.
 *
 * This bypasses the real SSO flow but still uses the same session mechanism
 * the UI relies on. Steam-based admin rights are still decided by players.is_admin.
 */
export async function signIn(page: Page): Promise<boolean> {
  const ok = await signInViaRequest(page.request);
  if (!ok) return false;

  // Confirm against the API rather than the resulting URL — see
  // isAdminAuthenticated for why the URL cannot be trusted here.
  //
  // Poll rather than checking once. `setupTestContextWithFreshDB` signs in
  // immediately after /api/test/reset-database, which drops and recreates the
  // whole public schema — including the express-session table and the players
  // row that grants admin. On a slower machine the very next request can land
  // while that is still settling, and a single check would report a failed
  // sign-in for what is really a transient state.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isAdminAuthenticated(page.request)) {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      return true;
    }
    await page.waitForTimeout(500);
    // Re-issue the login: a reset between the first POST and this check would
    // have discarded both the session and the admin's players row.
    await signInViaRequest(page.request);
  }

  return false;
}

/**
 * Ensure the page holds an admin session, signing in only if it does not.
 */
export async function ensureSignedIn(page: Page): Promise<void> {
  if (!(await isAdminAuthenticated(page.request))) {
    const ok = await signIn(page);
    expect(ok, 'admin sign-in should succeed').toBe(true);
  } else {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  }

  // The SPA redirects to /login asynchronously once it has checked the session,
  // so assert on the settled URL rather than whatever it is right now.
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Sign in as a normal (non-admin) player via the test-only login-player endpoint.
 * Sets the signed player_steam_id cookie only; no Passport session.
 * Use this to verify that normal users cannot access admin UI or API.
 *
 * @param page Playwright page (uses page.request for the POST; cookies are shared)
 * @param steamId Optional Steam ID (default 76561198000000002)
 * @returns true if login-player returned 200
 */
export async function signInAsPlayer(
  page: Page,
  steamId: string = DEFAULT_PLAYER_STEAM_ID
): Promise<boolean> {
  return signInAsPlayerViaRequest(page.request, steamId);
}

/**
 * Same as `signInAsPlayer`, but for a bare APIRequestContext.
 */
export async function signInAsPlayerViaRequest(
  request: APIRequestContext,
  steamId: string = DEFAULT_PLAYER_STEAM_ID
): Promise<boolean> {
  try {
    const response = await request.post('/api/test/login-player', {
      data: { steamId },
    });
    if (!response.ok()) {
      console.error('login-player test helper failed:', await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error('Sign in as player via test helper failed:', error);
    return false;
  }
}

/**
 * Start impersonating a player as the currently signed-in admin.
 *
 * The admin keeps their admin rights (admin auth deliberately ignores the
 * impersonation cookie), but every player-facing endpoint — veto in particular —
 * now treats the request as coming from `steamId`.
 *
 * @returns true when impersonation started
 */
export async function impersonatePlayer(
  request: APIRequestContext,
  steamId: string
): Promise<boolean> {
  try {
    const response = await request.post('/api/auth/impersonate', {
      data: { steamId },
    });

    if (!response.ok()) {
      console.error('impersonate failed:', await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('Impersonate request failed:', error);
    return false;
  }
}

/**
 * Stop impersonating and return to the admin's own identity.
 */
export async function stopImpersonating(request: APIRequestContext): Promise<boolean> {
  try {
    const response = await request.post('/api/auth/impersonate/stop');
    return response.ok();
  } catch (error) {
    console.error('Stop impersonation request failed:', error);
    return false;
  }
}

/**
 * Legacy helper kept for backwards compatibility in tests.
 *
 * Now that admin auth is fully Passport/session-based, this returns an
 * empty Authorization header so that existing test helpers can still call it
 * without relying on any API token.
 */
export function getAuthHeader(): { Authorization: string } {
  return { Authorization: '' };
}
