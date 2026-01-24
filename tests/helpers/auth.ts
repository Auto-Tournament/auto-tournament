import { Page, expect } from '@playwright/test';

/**
 * Authentication helper functions
 */

/**
 * Sign in via a test-only admin endpoint that creates a Passport session.
 *
 * This bypasses the real SSO flow but still uses the same session mechanism
 * the UI relies on. Steam-based admin rights are still decided by players.is_admin.
 */
export async function signIn(page: Page): Promise<boolean> {
  try {
    const testSteamId = process.env.TEST_STEAM_ID || '76561198000000001';

    const response = await page.request.post('/api/test/login-admin', {
      data: { steamId: testSteamId },
    });

    if (!response.ok()) {
      console.error('login-admin test helper failed:', await response.text());
      return false;
    }

    // Navigate to dashboard; the session cookie should be sent automatically.
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const url = page.url();
    return !url.includes('/login');
  } catch (error) {
    console.error('Sign in via test helper failed:', error);
    return false;
  }
}

/**
 * Ensure user is signed in (checks first, signs in if needed)
 * @param page Playwright page
 */
export async function ensureSignedIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const currentUrl = page.url();
  if (!currentUrl.includes('/login')) {
    // Already signed in
    return;
  }

  const ok = await signIn(page);
  expect(ok).toBe(true);
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
  steamId: string = '76561198000000002'
): Promise<boolean> {
  try {
    const response = await page.request.post('/api/test/login-player', {
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
 * Legacy helper kept for backwards compatibility in tests.
 *
 * Now that admin auth is fully Passport/session-based, this returns an
 * empty Authorization header so that existing test helpers can still call it
 * without relying on any API token.
 */
export function getAuthHeader(): { Authorization: string } {
  return { Authorization: '' };
}

