import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';
import { createTestTeams } from '../helpers/teams';
import { createTournament } from '../helpers/tournaments';

/**
 * CS2's setup steps edit CS2's own settings (item 8b, with item 10): the
 * wizard hands the tournament's settings object to CS2's rules and maps
 * steps, which read and write `settings.cs2` and load their map data
 * themselves. The core only stores the object.
 *
 * - round rules edited on the Format step save as `settings.cs2`, without the
 *   confirmation a map pool change asks for;
 * - the maps step's own check blocks Continue on an empty custom pool;
 * - a template's pool, maps and 2.x round hints fill the wizard;
 * - a shuffle created in the wizard sends its sequence as `settings.cs2`.
 *
 * @tag ui
 * @tag tournament
 */

const ACTIVE_DUTY = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_vertigo',
];

interface TournamentBody {
  tournament?: {
    type?: string;
    maps?: string[];
    maxRounds?: number;
    mapSequence?: string[];
    settings?: { cs2?: Record<string, unknown> };
  };
}

async function tournamentOf(request: APIRequestContext) {
  const res = await request.get('/api/tournament', { headers: getAuthHeader() });
  if (!res.ok()) return undefined;
  return ((await res.json()) as TournamentBody).tournament;
}

test.describe.serial('CS2 settings in the tournament setup', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    await request.delete('/api/tournament', { headers: getAuthHeader() });
  });

  test(
    'round rules save as settings.cs2 without asking to confirm',
    { tag: ['@ui', '@tournament'] },
    async ({ page, request }) => {
      const teams = await createTestTeams(request, 'cs2-settings-ui');
      expect(teams, 'test teams should be created').toBeTruthy();
      const created = await createTournament(request, {
        name: `CS2 settings UI ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ACTIVE_DUTY,
        teamIds: teams!.map((team) => team.id),
      });
      expect(created, 'tournament should be created').toBeTruthy();

      await page.goto('/tournament');
      await expect(page.getByTestId('tournament-name-display')).toBeVisible();

      await page.getByTestId('tournament-setup-step-format').click();
      const maxRounds = page.getByTestId('tournament-max-rounds-field');
      await expect(maxRounds).toHaveValue('24');
      await maxRounds.fill('16');

      await page.getByTestId('tournament-setup-step-review').click();
      await expect(page.getByTestId('tournament-unsaved-changes')).toBeVisible();
      await page.getByTestId('tournament-save-button').click();

      await expect
        .poll(async () => (await tournamentOf(request))?.settings?.cs2?.maxRounds)
        .toBe(16);
      const saved = await tournamentOf(request);
      // The 2.x field still answers, from CS2's object.
      expect(saved?.maxRounds).toBe(16);
      expect(saved?.maps).toEqual(ACTIVE_DUTY);
      await expect(page.getByTestId('tournament-unsaved-changes')).toHaveCount(0);
    }
  );

  test(
    "the maps step's own check refuses an empty custom pool",
    { tag: ['@ui', '@tournament'] },
    async ({ page }) => {
      await page.goto('/tournament');
      await page.getByTestId('tournament-setup-step-maps').click();

      // A new tournament gets the pool the picker shows.
      await expect(page.getByTestId('tournament-summary-maps')).toHaveText(/\d+ maps?/);

      await page.getByTestId('tournament-map-pool-select').click();
      await page.getByTestId('tournament-map-pool-option').last().click();
      await page.getByTestId('tournament-next-button').click();
      await expect(page.getByTestId('tournament-step-error')).toBeVisible();
    }
  );

  test(
    "a template's pool, maps and round hints fill the wizard",
    { tag: ['@ui', '@tournament'] },
    async ({ page, request }) => {
      const name = `CS2 settings template ${Date.now()}`;
      const created = await request.post('/api/templates', {
        headers: getAuthHeader(),
        data: {
          name,
          type: 'single_elimination',
          format: 'bo1',
          maps: ACTIVE_DUTY,
          // A template saved before 3.0: the round limit at the top of settings.
          settings: { maxRounds: 12 },
        },
      });
      expect(created.ok(), await created.text()).toBe(true);
      const { template } = (await created.json()) as { template: { id: number } };

      try {
        await page.goto(`/tournament?template=${template.id}`);
        await expect(page.getByTestId('tournament-summary-maps')).toHaveText(/7 maps/);
        await page.getByTestId('tournament-setup-step-format').click();
        await expect(page.getByTestId('tournament-max-rounds-field')).toHaveValue('12');
      } finally {
        await request.delete(`/api/templates/${template.id}`, { headers: getAuthHeader() });
      }
    }
  );

  test(
    'a shuffle created in the wizard sends its map sequence as settings.cs2',
    { tag: ['@ui', '@tournament', '@shuffle'] },
    async ({ page, request }) => {
      await page.goto('/tournament');
      const next = page.getByTestId('tournament-next-button');

      await next.click(); // Game: CS2
      await page.getByTestId('tournament-name-input').fill(`CS2 settings shuffle ${Date.now()}`);
      await next.click();
      await page.getByTestId('tournament-type-option-shuffle').click();
      await expect(page.getByTestId('shuffle-max-rounds-field')).toHaveValue('24');
      await page.getByTestId('shuffle-max-rounds-field').fill('10');
      await next.click();
      await next.click(); // Sign-up opens once the tournament exists.

      // A shuffle starts from a custom, empty sequence; take a pool instead.
      await page.getByTestId('tournament-map-pool-select').click();
      await page
        .getByTestId('tournament-map-pool-option')
        .filter({ hasText: 'Active Duty' })
        .click();
      await expect(page.getByTestId('tournament-summary-maps')).toHaveText(/7 maps/);

      await page.getByTestId('tournament-setup-step-review').click();
      await page.getByTestId('tournament-save-button').click();

      await expect.poll(async () => (await tournamentOf(request))?.type).toBe('shuffle');
      const saved = await tournamentOf(request);
      expect(saved?.maxRounds).toBe(10);
      expect(saved?.mapSequence).toHaveLength(7);
      expect(saved?.settings?.cs2).toMatchObject({
        maxRounds: 10,
        mapSequence: saved?.mapSequence,
        maps: saved?.mapSequence,
      });
    }
  );
});
