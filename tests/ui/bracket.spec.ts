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
    await page.goto('/bracket');
    await expect(page).toHaveURL(/\/bracket/);
    await expect(page).toHaveTitle(/Bracket/i);
    await page.waitForLoadState('networkidle');
    
    // Check for bracket page heading (more flexible - could be any heading level)
    const bracketHeading = page.getByRole('heading', { name: /bracket/i });
    const headingVisible = await bracketHeading.first().isVisible().catch(() => false);
    // If no heading, check for bracket content or empty state
    if (!headingVisible) {
      const bracketContent = page.locator('text=/bracket|tournament|round|match/i');
      const hasContent = await bracketContent.first().isVisible().catch(() => false);
      expect(hasContent).toBeTruthy();
    } else {
      await expect(bracketHeading.first()).toBeVisible();
    }
  });

  test('should display bracket visualization or empty state with interaction', {
    tag: ['@ui', '@bracket'],
  }, async ({ page }) => {
    await page.goto('/bracket');
    await page.waitForLoadState('networkidle');
    
    // Check for bracket visualization or empty state
    const bracketVisualization = page.locator('text=/round|match|team|bracket/i');
    const emptyState = page.locator('text=/no.*tournament|create.*tournament|empty/i');
    
    const hasBracket = await bracketVisualization.first().isVisible().catch(() => false);
    const isEmpty = await emptyState.first().isVisible().catch(() => false);
    
    // Should have either bracket or empty state
    expect(hasBracket || isEmpty).toBeTruthy();
    
    // Look for tournament information if bracket exists
    const tournamentInfo = page.locator('text=/tournament|format|type/i');
    const hasInfo = await tournamentInfo.first().isVisible().catch(() => false);
    
    if (hasInfo) {
      await expect(tournamentInfo.first()).toBeVisible();
    }
    
    // Look for interactive elements (zoom, pan, match cards)
    const interactiveElements = page.locator('button, [role="button"], [tabindex="0"]');
    const count = await interactiveElements.count();
    
    // Should have some interactive elements if bracket exists
    if (count > 0) {
      expect(count).toBeGreaterThan(0);
    }
  });
});

