import { test, expect } from '@playwright/test';
import { signIn, ensureSignedIn, getApiToken } from './helpers/auth';

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

  test(
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

      // Click the sign out button
      const signOutButton = page.getByTestId('sign-out-button');
      await signOutButton.click();

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

  test(
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
