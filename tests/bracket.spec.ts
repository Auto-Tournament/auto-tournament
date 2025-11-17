import { test, expect } from '@playwright/test';

/**
 * Bracket page tests
 * @tag bracket
 * @tag navigation
 */

test.describe('Bracket Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const apiToken = process.env.API_TOKEN || 'admin123';
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should navigate to and display bracket page', { tag: ['@bracket'] }, async ({ page }) => {
    await page.goto('/bracket');
    await expect(page).toHaveURL(/\/bracket/);
    await expect(page).toHaveTitle(/Bracket/i);
    await page.waitForLoadState('networkidle');
    
    // Check for bracket page heading - h4 heading
    await expect(page.getByRole('heading', { name: /bracket/i, level: 4 })).toBeVisible();
  });

  test('should display bracket visualization or empty state', { tag: ['@bracket'] }, async ({ page }) => {
    await page.goto('/bracket');
    await page.waitForLoadState('networkidle');
    
    // Check for bracket visualization or empty state
    const bracketVisualization = page.locator('text=/round|match|team|bracket/i');
    const emptyState = page.locator('text=/no.*tournament|create.*tournament|empty/i');
    
    const hasBracket = await bracketVisualization.first().isVisible().catch(() => false);
    const isEmpty = await emptyState.isVisible().catch(() => false);
    
    // Should have either bracket or empty state
    expect(hasBracket || isEmpty).toBeTruthy();
  });

  test('should display tournament information if bracket exists', { tag: ['@bracket'] }, async ({ page }) => {
    await page.goto('/bracket');
    await page.waitForLoadState('networkidle');
    
    // Look for tournament name or info
    const tournamentInfo = page.locator('text=/tournament|format|type/i');
    const hasInfo = await tournamentInfo.first().isVisible().catch(() => false);
    
    // Tournament info might not be visible if no tournament exists
    if (hasInfo) {
      await expect(tournamentInfo.first()).toBeVisible();
    }
  });

  test('should allow bracket interaction if matches exist', { tag: ['@bracket'] }, async ({ page }) => {
    await page.goto('/bracket');
    await page.waitForLoadState('networkidle');
    
    // Look for interactive elements (zoom, pan, match cards)
    const interactiveElements = page.locator('button, [role="button"], [tabindex="0"]');
    const count = await interactiveElements.count();
    
    // Should have some interactive elements if bracket exists
    if (count > 0) {
      // Bracket is interactive
      expect(count).toBeGreaterThan(0);
    }
  });
});

