import { test, expect } from '@playwright/test';
import { setupShuffleTournament } from '../helpers/shuffleTournament';
import { createPlayer, type Player } from '../helpers/players';
import { setupTestContext } from '../helpers/setup';

/**
 * Public Pages UI tests
 *
 * Player profile and find-player pages are reachable by any signed-in identity
 * (they are `adminOnly={false}` routes), not just admins. Seeding the players
 * they display still needs an admin session on the `request` context.
 *
 * @tag ui
 * @tag public
 * @tag shuffle
 * @tag leaderboard
 * @tag players
 */

test.describe.serial('Public Pages UI', () => {
  test.beforeEach(async ({ page, request }) => {
    // Creating the players below is admin-only; the pages themselves are not.
    await setupTestContext(page, request);
  });

  test('should display a player profile page',
    {
      tag: ['@ui', '@public', '@players'],
    },
    async ({ page, request }) => {
      // Create a test player
      const player = await createPlayer(request, {
        id: '76561198000000200',
        name: 'Public Page Test Player',
        initialELO: 3200,
      });
      expect(player).toBeTruthy();

      // Navigate to public page directly (no need to clear localStorage)
      await page.goto(`/player/${player.id}`, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch (error) {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000);
      }

      // Wait for player page to load
      await expect(page.getByTestId('public-player-page')).toBeVisible({ timeout: 10000 });

      // Verify player name is displayed
      const playerName = page.getByTestId('public-player-name');
      await expect(playerName).toBeVisible();

      // Verify ELO is displayed
      const eloDisplay = page.getByTestId('public-player-elo');
      await expect(eloDisplay).toBeVisible();
    }
  );

  test('should allow finding player by Steam URL',
    {
      tag: ['@ui', '@public', '@players', '@search'],
    },
    async ({ page, request }) => {
      // Create a test player
      const player = await createPlayer(request, {
        id: '76561198000000201',
        name: 'Find Player Test',
        initialELO: 1500,
      });
      expect(player).toBeTruthy();

      // Navigate to public page directly
      await page.goto('/player', { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch (error) {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000);
      }

      // Wait for find player form
      await expect(page.getByTestId('find-player-form')).toBeVisible({ timeout: 5000 });

      // Enter Steam ID
      const input = page.getByTestId('find-player-input');
      await input.fill(player.id);
      // Trigger search via keyboard to avoid autocomplete "no options" popper intercepting button clicks
      await input.press('Enter');

      // Should redirect to player page
      await page.waitForURL(`**/player/${player.id}`, { timeout: 10000 });
      expect(page.url()).toContain(`/player/${player.id}`);
    }
  );

  // Consolidated player page test - verifies player page loads and displays basic info
  test(
    'should display player page with basic information',
    {
      tag: ['@ui', '@public', '@players'],
    },
    async ({ page, request }) => {
      // Create a test player
      const player = await createPlayer(request, {
        id: '76561198000000202',
        name: 'Player Page Test',
        initialELO: 1500,
      });

      expect(player, 'test player should have been created').toBeTruthy();

      // Navigate to public page directly (no need to clear localStorage)
      await page.goto(`/player/${player.id}`, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch (error) {
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000);
      }
      await page.waitForTimeout(1000);

      // Verify public player page loaded
      await expect(page.getByTestId('public-player-page')).toBeVisible({ timeout: 5000 });
      expect(page.url()).toContain(`/player/${player.id}`);
    }
  );

  test(
    'should handle invalid player ID gracefully',
    {
      tag: ['@ui', '@public', '@players', '@error-handling'],
    },
    async ({ page }) => {
      // Navigate to public page directly
      await page.goto('/player/76561198999999999');

      // Should show error or 404 message
      await page.waitForLoadState('networkidle');

      // Look for error message
      const errorMessage = page.getByTestId('player-not-found-error');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    }
  );
});
