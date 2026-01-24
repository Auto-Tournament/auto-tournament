import { test, expect } from '@playwright/test';
import { signIn, signInAsPlayer, ensureSignedIn, getApiToken } from './helpers/auth';

/**
 * Authentication tests
 * Refactored to use helper functions
 *
 * Tests run in order (serial) - each test gets a fresh browser context,
 * but we can share authentication state using storage state or fixtures.
 *
 * Note: Each test gets a fresh page, so we need to sign in for each test
 * that requires authentication. However, we can use `ensureSignedIn()`
 * which checks first and only signs in if needed.
 *
 * @tag ui
 * @tag auth
 * @tag login
 * @tag logout
 */

test.describe.serial('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing authentication for isolated tests
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test.skip(
    'should display login page when not authenticated',
    {
      tag: ['@ui', '@auth', '@login'],
    },
    async ({ page }) => {
      await page.goto('/login');
      await expect(page).toHaveTitle(/Login/i);

      // Check for login form elements
      const passwordInput = page.getByTestId('login-api-token-input');
      await expect(passwordInput).toBeVisible();

      const loginButton = page.getByTestId('login-sign-in-button');
      await expect(loginButton).toBeVisible();
    }
  );

  test(
    'should redirect to login when accessing protected route',
    {
      tag: ['@ui', '@auth', '@login'],
    },
    async ({ page }) => {
      await page.goto('/teams');

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/);
    }
  );

  test(
    'should establish admin session via test helper',
    {
      tag: ['@ui', '@auth', '@login'],
    },
    async ({ page }) => {
      const success = await signIn(page);
      expect(success).toBe(true);

      // Should redirect to dashboard/home
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page).toHaveURL(/\//);
    }
  );

  test(
    'should logout successfully',
    {
      tag: ['@ui', '@auth', '@logout'],
    },
    async ({ page }) => {
      // Sign in first (each test gets fresh context)
      await signIn(page);
      await expect(page).not.toHaveURL(/\/login/);

      // Wait for page to be fully loaded
      await page.waitForLoadState('networkidle');

      // Ensure viewport is large enough and we're at the top
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);

      // Open avatar menu, then click sign out
      await page.getByTestId('nav-avatar-button').click();
      await page.getByTestId('sign-out-button').click();

      // Should redirect to login
      await expect(page).toHaveURL(/\/login/);
    }
  );

  test(
    'should persist login after page reload',
    {
      tag: ['@ui', '@auth', '@login'],
    },
    async ({ page }) => {
      // Sign in first
      await signIn(page);
      await expect(page).not.toHaveURL(/\/login/);

      // Reload page
      await page.reload();

      // Should still be authenticated (not redirected to login)
      await expect(page).not.toHaveURL(/\/login/);
    }
  );

  test.skip(
    'should use ensureSignedIn helper to auto-sign-in',
    {
      tag: ['@ui', '@auth', '@login'],
    },
    async ({ page }) => {
      // First call - should sign in
      await ensureSignedIn(page);
      await expect(page).not.toHaveURL(/\/login/);

      // Clear and reload
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      // Second call - should sign in again
      await ensureSignedIn(page);
      await expect(page).not.toHaveURL(/\/login/);
    }
  );
});

test.describe.serial('Normal user cannot access admin', () => {
  const nonAdminSteamId = '76561198000000002';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test(
    'redirects normal user to player page when visiting admin routes',
    { tag: ['@ui', '@auth', '@admin'] },
    async ({ page }) => {
      const ok = await signInAsPlayer(page, nonAdminSteamId);
      expect(ok).toBe(true);

      const playerUrl = new RegExp(`/player/${nonAdminSteamId}`);

      await page.goto('/');
      await expect(page).toHaveURL(playerUrl, { timeout: 10000 });

      await page.goto('/admin');
      await expect(page).toHaveURL(playerUrl, { timeout: 10000 });

      await page.goto('/teams');
      await expect(page).toHaveURL(playerUrl, { timeout: 10000 });
    }
  );

  test(
    'admin API returns 403 for normal user',
    { tag: ['@ui', '@auth', '@admin'] },
    async ({ page }) => {
      const ok = await signInAsPlayer(page, nonAdminSteamId);
      expect(ok).toBe(true);

      const response = await page.request.get('/api/tournament/server-availability', {
        headers: { Accept: 'application/json' },
      });
      expect(response.status()).toBe(403);
    }
  );
});
