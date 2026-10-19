import { test as base, expect } from '@playwright/test';
import { setupTestContextWithFreshDB } from './helpers/setup';

/**
 * Global setup test - runs once before all other tests
 * This test ensures:
 * 1. Database is wiped
 * 2. User is signed in
 * 3. Webhook is configured
 *
 * Other tests can depend on this by using test.describe.serial
 * and checking for the @setup tag
 *
 * @tag setup
 * @tag global
 */

// Extend base test to add our fixtures
type TestFixtures = {
  authenticated: boolean;
};

export const test = base.extend<TestFixtures>({
  authenticated: async ({ page, request }, use) => {
    // This will run before each test that uses the authenticated fixture
    await setupTestContextWithFreshDB(page, request);
    await use(true);
  },
});

test.describe.serial('Global Test Setup', () => {
  test(
    'should setup test environment',
    { tag: ['@setup', '@global'] },
    async ({ page, request }) => {
      // Wipe database and sign in
      await setupTestContextWithFreshDB(page, request);

      // Verify we can access protected routes
      await page.goto('/');
      await expect(page).not.toHaveURL(/\/login/);
    }
  );
});
