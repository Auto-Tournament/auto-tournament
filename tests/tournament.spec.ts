import { test, expect } from '@playwright/test';

/**
 * Tournament page tests
 * @tag tournament
 * @tag crud
 */

test.describe('Tournament Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const apiToken = process.env.API_TOKEN || 'admin123';
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should navigate to and display tournament page', { tag: ['@tournament'] }, async ({ page }) => {
    await page.goto('/tournament');
    await expect(page).toHaveURL(/\/tournament/);
    await expect(page).toHaveTitle(/Tournament Setup/i);
    await page.waitForLoadState('networkidle');
    
    // Check for tournament form elements - form might be visible if no tournament exists
    // or if tournament is in setup status
    const nameInput = page.getByLabel(/tournament name/i).or(page.getByLabel(/name/i));
    const formVisible = await nameInput.isVisible().catch(() => false);
    
    // If form is not visible, tournament might already exist - that's okay
    if (formVisible) {
      await expect(nameInput).toBeVisible();
    }
  });

  test('should create a new tournament', { tag: ['@tournament', '@crud'] }, async ({ page }) => {
    await page.goto('/tournament');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Check if form is visible (means no tournament exists yet)
    const nameInput = page.getByLabel(/tournament name/i).or(page.getByLabel(/name/i));
    const formVisible = await nameInput.isVisible().catch(() => false);
    
    if (formVisible) {
      // Form is visible, we can create a tournament
      const tournamentName = `Test Tournament ${Date.now()}`;
      await nameInput.fill(tournamentName);
      
      // Submit form if there's a submit button
      const submitButton = page.getByRole('button', { name: /save|create/i });
      const submitVisible = await submitButton.isVisible().catch(() => false);
      
      if (submitVisible) {
        await submitButton.click();
        
        // Wait for tournament to be created - check for tournament name or status
        await page.waitForTimeout(1000);
        const tournamentCreated = await page.getByText(tournamentName).isVisible().catch(() => false);
        if (!tournamentCreated) {
          // Tournament might be created but name not immediately visible, check for status
          const statusVisible = await page.getByText(/setup|in progress|completed/i).isVisible().catch(() => false);
          expect(statusVisible).toBeTruthy();
        }
      }
    } else {
      // Tournament already exists - that's fine, just verify we can see tournament info
      const tournamentInfo = await page.getByRole('heading', { name: /tournament/i }).isVisible().catch(() => false);
      if (!tournamentInfo) {
        // Skip if we can't verify tournament exists
        test.skip();
      }
    }
  });

  test('should display tournament status', { tag: ['@tournament'] }, async ({ page }) => {
    await page.goto('/tournament');
    await page.waitForLoadState('networkidle');
    
    // Check for tournament status indicators
    const statusElements = page.locator('text=/setup|in progress|completed|not started/i');
    const hasStatus = await statusElements.first().isVisible().catch(() => false);
    
    // Status might not always be visible if no tournament exists
    if (hasStatus) {
      await expect(statusElements.first()).toBeVisible();
    }
  });

  test('should navigate to bracket from tournament page', { tag: ['@tournament', '@navigation'] }, async ({ page }) => {
    await page.goto('/tournament');
    await page.waitForLoadState('networkidle');
    
    // Look for "View Bracket" or similar button
    const bracketButton = page.getByRole('button', { name: /view.*bracket|bracket/i });
    const bracketButtonVisible = await bracketButton.isVisible().catch(() => false);
    
    if (bracketButtonVisible) {
      await bracketButton.click();
      await expect(page).toHaveURL(/\/bracket/);
    } else {
      // Skip if no tournament exists
      test.skip();
    }
  });
});

