import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setupTestContext } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';

/**
 * Tournament setup flow: step navigation and the live summary.
 *
 * The summary's match count comes from the same bracket math as the API
 * generators (client/src/utils/tournamentMatchCount.ts): double elimination
 * with a grand final plays 2N - 2 matches, without one 2N - 3, swiss
 * ceil(log2 N) rounds of N / 2 matches, round robin N(N - 1) / 2.
 *
 * @tag ui
 * @tag tournament
 */

test.describe.serial('Tournament setup flow', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    // The setup opens for a new tournament only when none exists.
    await request.delete('/api/tournament', { headers: getAuthHeader() });
  });

  test(
    'steps navigate, validate, and the summary follows the format',
    { tag: ['@ui', '@tournament'] },
    async ({ page }) => {
      await page.goto('/tournament');

      const steps = page.getByTestId('tournament-setup-steps');
      await expect(steps).toBeVisible();
      await expect(steps.locator('li')).toHaveCount(7);
      const step = (id: string) => page.getByTestId(`tournament-setup-step-${id}`);
      const next = page.getByTestId('tournament-next-button');
      const summary = (key: string) => page.getByTestId(`tournament-summary-${key}`);

      await expect(step('game')).toHaveAttribute('aria-current', 'step');
      await expect(page.getByTestId('tournament-summary-game')).toContainText('Counter-Strike 2');
      await next.click();

      // Basics refuses Continue without a name, and says why.
      await expect(step('basics')).toHaveAttribute('aria-current', 'step');
      await next.click();
      await expect(page.getByTestId('tournament-step-error')).toBeVisible();
      await expect(step('basics')).toHaveAttribute('aria-current', 'step');

      await page.getByTestId('tournament-name-input').fill('Spring Cup');
      await expect(summary('name')).toHaveText('Spring Cup');
      await next.click();

      // Format: double elimination, Bo3, a grand final, 8 teams.
      await expect(step('format')).toHaveAttribute('aria-current', 'step');
      await expect(step('basics')).toHaveAttribute('data-done', 'true');
      const doubleElim = page.getByTestId('tournament-type-option-double_elimination');
      await doubleElim.click();
      await expect(doubleElim).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('tournament-type-option-single_elimination')).toHaveAttribute(
        'aria-pressed',
        'false'
      );
      await page.getByTestId('tournament-format-option-bo3').click();
      await expect(page.getByTestId('tournament-format-option-bo3')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await page.getByTestId('tournament-grand-final-option-simple').click();

      // The stepper only lands on counts elimination brackets allow.
      const count = page.getByTestId('tournament-team-count');
      await page.getByTestId('tournament-team-count-decrease').click();
      await expect(count).toHaveText('4');
      await expect(summary('matches')).toHaveText('6');
      await page.getByTestId('tournament-team-count-increase').click();
      await expect(count).toHaveText('8');

      await expect(summary('format')).toHaveText('Double elimination');
      await expect(summary('series')).toHaveText('Bo3 · grand final');
      await expect(summary('teams')).toHaveText('8 planned');
      await expect(summary('matches')).toHaveText('14');

      // Without a grand final the winners bracket final decides it: one match fewer.
      await page.getByTestId('tournament-grand-final-option-none').click();
      await expect(summary('series')).toHaveText('Bo3 · no grand final');
      await expect(summary('matches')).toHaveText('13');

      // Swiss: 3 rounds of 4 matches. Round robin: everyone once.
      await page.getByTestId('tournament-type-option-swiss').click();
      await expect(summary('format')).toHaveText('Swiss');
      await expect(summary('series')).toHaveText('Bo3');
      await expect(summary('matches')).toHaveText('12');
      await page.getByTestId('tournament-type-option-round_robin').click();
      await expect(summary('matches')).toHaveText('28');

      // Teams refuses Continue until a valid set of teams is picked...
      await next.click();
      await expect(step('teams')).toHaveAttribute('aria-current', 'step');
      await next.click();
      await expect(page.getByTestId('tournament-step-error')).toBeVisible();
      await expect(step('teams')).toHaveAttribute('aria-current', 'step');

      // ...but any step can be opened from the list, with the mouse or the keyboard.
      await step('maps').click();
      await expect(step('maps')).toHaveAttribute('aria-current', 'step');
      await expect(page.getByTestId('tournament-map-pool-select')).toBeVisible();
      await expect(summary('maps')).toHaveText(/\d+ maps?/);

      await step('format').focus();
      await page.keyboard.press('Enter');
      await expect(step('format')).toHaveAttribute('aria-current', 'step');
      await expect(page.getByTestId('tournament-type-option-round_robin')).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      // Only real preconditions for Start, and the tournament doesn't exist yet.
      const checklist = page.getByTestId('tournament-setup-checklist');
      await expect(checklist.locator('li[data-met="true"]')).not.toHaveCount(0);
      await expect(checklist.locator('li[data-met="false"]')).not.toHaveCount(0);

      await step('review').click();
      await expect(page.getByTestId('tournament-save-button')).toBeVisible();

      const axe = await new AxeBuilder({ page })
        .include('[data-testid="tournament-setup"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        axe.violations.map((v) => `${v.id}: ${v.help}`),
        'setup flow accessibility violations'
      ).toEqual([]);
    }
  );

  test(
    'fits a phone screen without horizontal scrolling',
    { tag: ['@ui', '@tournament'] },
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/tournament');
      await expect(page.getByTestId('tournament-setup-steps')).toBeVisible();

      for (const id of ['game', 'basics', 'format', 'maps', 'eventPage', 'review']) {
        await page.getByTestId(`tournament-setup-step-${id}`).click();
        await expect(page.getByTestId(`tournament-setup-question-${id}`)).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `horizontal overflow on the ${id} step`).toBeLessThanOrEqual(0);
      }
    }
  );
});
