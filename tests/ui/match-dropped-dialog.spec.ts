import { test, expect } from '@playwright/test';
import { signInAsPlayer } from '../helpers/auth';

/**
 * "You lost connection" (client/src/integrations/cs2/match/MatchDroppedDialog.tsx):
 * a player who left their live match's server gets a Reconnect button on any
 * page; back on the server, it does not show.
 *
 * @tag ui
 */

test(
  'a player who dropped off their live match gets a Reconnect button',
  { tag: ['@ui'] },
  async ({ page }) => {
    expect(await signInAsPlayer(page, '76561198000777002', 'Dropped Player')).toBe(true);
    await page.route('**/api/players/me/match-status', (route) =>
      route.fulfill({
        json: {
          success: true,
          status: 'match_ready',
          matchSlug: 'spec-dropped',
          label: 'match_ready',
          connection: 'dropped',
          droppedAt: 1791990000000,
        },
      })
    );
    await page.route('**/api/game/cs2/matches/spec-dropped/connect', (route) =>
      route.fulfill({
        json: {
          success: true,
          server: {
            id: 's1',
            name: 'cs2:27015',
            host: 'cs.example.com',
            ip: '203.0.113.7',
            port: 27015,
            password: 'pw',
          },
        },
      })
    );
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dialog = page.getByTestId('match-dropped-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('You lost connection');
    await expect(dialog.getByTestId('match-dropped-reconnect')).toHaveAttribute(
      'href',
      'steam://connect/203.0.113.7:27015/pw'
    );
  }
);
