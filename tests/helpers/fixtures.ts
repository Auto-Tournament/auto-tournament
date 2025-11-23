import { test as base } from '@playwright/test';
import { signInViaAPI, getApiToken } from './auth';

/**
 * Playwright fixtures for shared authentication state
 */

type AuthFixtures = {
  authenticatedPage: any; // Page with authentication already set up
};

/**
 * Extended test with authenticated page fixture
 * Use this instead of the base test to get an authenticated page
 */
export const test = base.extend<AuthFixtures>({
  // Authenticated page fixture - signs in once and reuses it
  authenticatedPage: async ({ page }, use) => {
    // Sign in via API (faster than UI)
    await signInViaAPI(page);

    // Use the authenticated page
    await use(page);

    // Cleanup (optional - can clear auth here if needed)
    // await page.evaluate(() => localStorage.clear());
  },
});

/**
 * Create storage state for authenticated session
 * This can be saved and reused across tests
 */
export async function createAuthStorageState(page: any): Promise<void> {
  await signInViaAPI(page);

  // Save storage state (can be used in playwright.config.ts)
  // await page.context().storageState({ path: 'tests/.auth/user.json' });
}
