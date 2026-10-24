import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Development tools make the admin type the confirmation the destructive
 * routes ask for (routes/tournament.ts): the action button stays disabled
 * until it matches, then the typed value is sent.
 *
 * @tag ui
 */

test(
  'wiping a table and resetting the simulation need the typed confirmation',
  {
    tag: ['@ui'],
  },
  async ({ page }) => {
    expect(await signInViaRequest(page.request)).toBe(true);
    await page.goto('/manage/dev');
    const input = page.getByTestId('dev-confirm-input');
    const submit = page.getByTestId('dev-confirm-submit');

    await page.getByRole('button', { name: 'Wipe Specific Tables' }).click();
    await page.getByRole('button', { name: 'Wipe Shuffle Players' }).click();
    await expect(submit).toBeDisabled();
    await input.fill('shuffle_tournament');
    await expect(submit).toBeDisabled();
    await input.fill('shuffle_tournament_players');
    const wipe = page.waitForResponse((r) => r.url().includes('/api/tournament/wipe-table/'));
    await submit.click();
    const wiped = await wipe;
    expect(wiped.status()).toBe(200);
    expect(wiped.request().postDataJSON()).toEqual({ confirm: 'shuffle_tournament_players' });

    await page.getByRole('button', { name: /Reset Simulation State/ }).click();
    await expect(submit).toBeDisabled();
    await input.fill('reset');
    const reset = page.waitForResponse((r) =>
      r.url().includes('/api/tournament/dev/reset-simulation-state')
    );
    await submit.click();
    expect((await reset).status()).toBe(200);

    // The section's accordion header has the same name as its button.
    await page.getByRole('button', { name: 'Wipe Entire Database' }).click();
    await page.getByRole('button', { name: 'Wipe Entire Database' }).last().click();
    await expect(submit).toBeDisabled();
    await input.fill('wipe');
    await expect(submit).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(submit).toBeHidden();
  }
);
