import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * A game whose players need a sign-in that is off (CS2 needs Steam): Modules
 * and tournament setup's Game step say so, with a link to Settings → Sign-in.
 *
 * @tag ui
 */

test(
  'Steam sign-in off: Modules and the Game step warn about CS2',
  { tag: ['@ui'] },
  async ({ page }) => {
    await ensureSignedIn(page);
    const providers = (await (await page.request.get('/api/sign-in-providers')).json())
      .providers as Array<{
      id: string;
      enabled: boolean;
    }>;
    const steamWasOn = providers.find((p) => p.id === 'steam')!.enabled;
    // Turning Steam off needs another way in for admins: the local login is on in the test stack.
    const off = await page.request.put('/api/sign-in-providers/steam', {
      data: { enabled: false },
    });
    test.skip(!off.ok(), `Steam sign-in could not be turned off here: ${await off.text()}`);
    try {
      await page.goto('/manage/modules');
      const warning = page.getByTestId('sign-in-need-cs2');
      await expect(warning).toContainText('Steam sign-in is turned off', { timeout: 15000 });
      await expect(warning.getByRole('link', { name: 'Turn it on' })).toHaveAttribute(
        'href',
        '/manage/settings?section=signin'
      );

      // Setup for a new tournament (what "New tournament" in the admin bar
      // picks), whatever tournaments other specs left running.
      const { nextId } = (await (await page.request.get('/api/tournaments')).json()) as {
        nextId: number;
      };
      await page.evaluate(
        (id) => window.localStorage.setItem('at:adminTournamentId', String(id)),
        nextId
      );
      await page.goto('/manage/tournament');
      await expect(page.getByTestId('sign-in-need-cs2')).toBeVisible({ timeout: 15000 });
    } finally {
      await page.request.put('/api/sign-in-providers/steam', { data: { enabled: steamWasOn } });
    }
    // On again: no warning.
    await page.goto('/manage/modules');
    await expect(page.getByTestId('modules-page')).toBeVisible();
    if (steamWasOn) await expect(page.getByTestId('sign-in-need-cs2')).toHaveCount(0);
  }
);
