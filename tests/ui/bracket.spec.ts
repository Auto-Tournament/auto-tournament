import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Bracket UI tests
 * Tests bracket page functionality
 * 
 * @tag ui
 * @tag bracket
 * @tag navigation
 */

test.describe.serial('Bracket UI', () => {
  test.beforeEach(async ({ page }) => {
    await ensureSignedIn(page);
  });

  test('should navigate to and display bracket page', {
    tag: ['@ui', '@bracket'],
  }, async ({ page }) => {
    await page.goto('/bracket', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/bracket/);
    await expect(page).toHaveTitle(/Bracket/i);
    
    // Wait for page to load (with fallback if networkidle times out)
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch (error) {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);
    }
    
    // Verify bracket page loaded - check for either bracket-page, empty state, or loading state
    const bracketPage = page.getByTestId('bracket-page');
    const emptyState = page.getByTestId('bracket-empty-state');
    
    // Wait for either the bracket page or empty state to be visible
    await expect(
      bracketPage.or(emptyState)
    ).toBeVisible({ timeout: 10000 });
  });

  test('should display bracket visualization or empty state with interaction', {
    tag: ['@ui', '@bracket'],
  }, async ({ page }) => {
    await page.goto('/bracket');
    await page.waitForLoadState('networkidle');
    
    // Check for bracket visualization or empty state
    const bracketVisualization = page.getByTestId('bracket-visualization');
    const emptyState = page.getByTestId('bracket-empty-state');
    
    const hasBracket = await bracketVisualization.isVisible().catch(() => false);
    const isEmpty = await emptyState.isVisible().catch(() => false);
    
    // Should have either bracket or empty state
    expect(hasBracket || isEmpty).toBeTruthy();
    
    // Look for tournament information if bracket exists
    if (hasBracket) {
      const tournamentInfo = page.getByTestId('bracket-tournament-info');
      await expect(tournamentInfo).toBeVisible();
    }
  });
});

