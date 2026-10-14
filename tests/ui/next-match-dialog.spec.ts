import { test, expect } from '@playwright/test';
import { signInAsPlayer } from '../helpers/auth';

/**
 * The next-match dialog (client/src/components/match/NextMatchDialog.tsx):
 * your team against the opponent with their logos, and the countdown to the
 * veto under them during the break between matches.
 *
 * @tag ui
 */

test(
  'the break before your next match: your team vs the opponent, and the veto countdown',
  {
    tag: ['@ui'],
  },
  async ({ page }) => {
    expect(await signInAsPlayer(page, '76561198000777001', 'Dialog Player')).toBe(true);
    const opensAt = new Date(Date.now() + 120_000).toISOString();
    await page.route('**/api/players/me/match-status', (route) =>
      route.fulfill({
        json: {
          success: true,
          status: 'veto_soon',
          matchSlug: 'spec-next-dialog',
          label: 'veto_soon',
          matchName: 'Gryt Chat vs Bots Bravo',
          viewerTeam: 'team2',
          vetoActionCount: 0,
          lastVetoActionTeam: null,
          opensAt,
          matchup: {
            you: { name: 'Gryt Chat', tag: 'GRYT', logoUrl: null },
            opponent: { name: 'Bots Bravo', tag: 'BRAV', logoUrl: null },
          },
        },
      })
    );
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dialog = page.getByTestId('next-match-dialog');
    await expect(dialog).toBeVisible();
    const matchup = dialog.getByTestId('next-match-matchup');
    await expect(matchup).toContainText('Gryt Chat');
    await expect(matchup).toContainText('Your team');
    await expect(matchup).toContainText('Bots Bravo');
    await expect(matchup).toContainText('Opponent');
    await expect(dialog.getByTestId('next-match-countdown')).toContainText(
      /Veto opens in [12]:\d\d/
    );
  }
);
