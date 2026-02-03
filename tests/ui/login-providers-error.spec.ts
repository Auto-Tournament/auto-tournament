import { test, expect } from '@playwright/test';

/**
 * Login provider error UX tests
 *
 * @tag ui
 * @tag login
 * @tag error-handling
 */

test.describe.serial('Login providers error', () => {
  test(
    'should show generic error when no providers are enabled',
    {
      tag: ['@ui', '@login', '@error-handling'],
    },
    async ({ page }) => {
      const message = 'Sign-in is temporarily unavailable. Please contact an administrator.';

      await page.route('**/api/auth/providers', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            providers: [
              {
                id: 'steam',
                label: 'Steam',
                loginUrl: '/api/auth/steam',
                enabled: false,
              },
            ],
            error: message,
          }),
        });
      });

      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(message)).toBeVisible({ timeout: 5000 });
    }
  );
});

