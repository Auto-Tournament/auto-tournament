import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';

/**
 * Maps UI tests
 *
 * The previous version claimed to "create, validate, edit, and view" a map but
 * only ever created one. Both other stages were unreachable:
 *
 *   - validation was asserted behind `map-error-alert`, which does not exist in
 *     the client (errors render as a plain MUI Alert);
 *   - the edit stage keyed off `[data-testid="map-card"]`, but cards are
 *     `map-card-<id>`, so the count was always 0 and the block never ran.
 *
 * The tournament map-pool test was conditional the whole way down and asserted
 * nothing: it looked for `tournament-name-input` on /tournament, which only
 * appears after entering the creation wizard.
 *
 * @tag ui
 * @tag maps
 * @tag crud
 */

test.describe.serial('Maps UI', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'should normalise a typed map id to lowercase',
    { tag: ['@ui', '@maps', '@validation'] },
    async ({ page, request }) => {
      await page.goto('/maps');
      await page.getByTestId('add-map-button').click();

      const modal = page.getByTestId('map-modal');
      await expect(modal).toBeVisible();

      // The field sanitises as you type (`toLowerCase().trim()`), so the
      // `/^[a-z0-9_]+$/` guard behind the Create button is unreachable through
      // the UI — an invalid id simply cannot be entered. Assert the behaviour
      // that actually exists rather than a rejection that cannot happen.
      //
      // An earlier version of this test asserted the error copy and appeared to
      // pass, but it was matching the field's *helper text*, which reads
      // "Lowercase letters, numbers, and underscores only (de_dust2)".
      const suffix = Date.now();
      const idInput = page.getByTestId('map-id-input');
      await idInput.fill(`UPPER_MAP_${suffix}`);
      await expect(idInput).toHaveValue(`upper_map_${suffix}`);

      await page.getByTestId('map-display-name-input').fill('Normalised Map');
      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes('/api/maps') && resp.request().method() === 'POST',
          { timeout: 15000 }
        ),
        page.getByTestId('map-create-button').click(),
      ]);
      expect(createResponse.ok()).toBe(true);

      const maps = await (await request.get('/api/maps', { headers: getAuthHeader() })).json();
      expect(maps.maps.map((m: { id: string }) => m.id)).toContain(`upper_map_${suffix}`);
    }
  );

  test(
    'should create a map and show it in the list',
    { tag: ['@ui', '@maps', '@crud'] },
    async ({ page, request }) => {
      await page.goto('/maps');
      await page.getByTestId('add-map-button').click();

      const modal = page.getByTestId('map-modal');
      await expect(modal).toBeVisible();

      const mapId = `test_map_${Date.now()}`;
      await page.getByTestId('map-id-input').fill(mapId);
      await page.getByTestId('map-display-name-input').fill('UI Test Map');

      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes('/api/maps') && resp.request().method() === 'POST',
          { timeout: 15000 }
        ),
        page.getByTestId('map-create-button').click(),
      ]);
      expect(createResponse.ok(), 'POST /api/maps should succeed').toBe(true);

      await expect(modal).not.toBeVisible();
      await expect(page.getByTestId(`map-card-${mapId}`)).toBeVisible();

      const maps = await (await request.get('/api/maps', { headers: getAuthHeader() })).json();
      expect(maps.maps.map((m: { id: string }) => m.id)).toContain(mapId);
    }
  );

  test(
    'should rename a map through the actions modal',
    { tag: ['@ui', '@maps', '@crud'] },
    async ({ page, request }) => {
      const mapId = `edit_map_${Date.now()}`;
      const created = await request.post('/api/maps', {
        headers: getAuthHeader(),
        data: { id: mapId, displayName: 'Before Rename' },
      });
      expect(created.ok(), 'seed map should be created').toBe(true);

      await page.goto('/maps');
      const card = page.getByTestId(`map-card-${mapId}`);
      await expect(card).toBeVisible();

      await card.click();
      await expect(page.getByTestId('map-actions-modal')).toBeVisible();

      await page.getByTestId('map-edit-button').click();
      const modal = page.getByTestId('map-modal');
      await expect(modal).toBeVisible();

      const renamed = 'After Rename';
      await page.getByTestId('map-display-name-input').fill(renamed);

      const [updateResponse] = await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes('/api/maps') && resp.request().method() === 'PUT',
          { timeout: 15000 }
        ),
        page.getByTestId('map-update-button').click(),
      ]);
      expect(updateResponse.ok(), 'PUT /api/maps/:id should succeed').toBe(true);

      await expect
        .poll(
          async () => {
            const maps = await (
              await request.get('/api/maps', { headers: getAuthHeader() })
            ).json();
            return maps.maps.find((m: { id: string }) => m.id === mapId)?.displayName;
          },
          { message: 'renamed display name to persist', timeout: 15000 }
        )
        .toBe(renamed);
    }
  );
});

test.describe.serial('Tournament Map Pool Selection', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    // The map-pool step lives inside the creation wizard, which is only offered
    // when no tournament exists yet.
    await request.delete('/api/tournament', { headers: getAuthHeader() });
  });

  test(
    'should offer a map pool on the wizard map step',
    { tag: ['@ui', '@tournament', '@map-pools'] },
    async ({ page }) => {
      await page.goto('/tournament');
      await page.getByTestId('tournament-welcome-create-new').click();

      const nextButton = page.getByTestId('tournament-next-button');

      // Name -> Type -> Format -> Maps
      const nameInput = page.getByTestId('tournament-name-input');
      await expect(nameInput).toBeVisible();
      await nameInput.fill(`Map Pool Test ${Date.now()}`);
      await nextButton.click();

      await expect(page.getByTestId('tournament-type-selector')).toBeVisible();
      await page.getByTestId('tournament-type-option-single_elimination').click();
      await nextButton.click();

      // Format step has no test ids, so select by its visible label. A format is
      // required before the wizard will advance for non-shuffle tournaments.
      await page.getByText('Best of 1', { exact: true }).click();
      await nextButton.click();

      const mapPoolSelect = page.getByTestId('tournament-map-pool-select');
      await expect(mapPoolSelect).toBeVisible();

      await mapPoolSelect.click();
      const options = page.getByTestId('tournament-map-pool-option');
      expect(await options.count()).toBeGreaterThan(0);
    }
  );
});
