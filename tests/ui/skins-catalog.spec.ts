import { test, expect, type APIRequestContext } from '@playwright/test';
import { ensureSignedIn, getAuthHeader, signInAsPlayer, signInViaRequest } from '../helpers/auth';

/**
 * Catalogue unlock from the browser: the admin switch, the Catalogue view of
 * the inventory with its float and seed dialog and side picker, a slot for
 * every weapon, picks in both sides' loadouts and on the player's profile.
 * Skins come from the live catalogue.
 *
 * @tag ui
 * @tag skins
 */

const STEAM_ID = '76561198099990003';

test.describe.serial('Skins catalogue picker', () => {
  const setConfig = (request: APIRequestContext, data: Record<string, unknown>) =>
    request.put('/api/skins/admin/config', { headers: getAuthHeader(), data });

  let original: Record<string, unknown> = {};

  test.beforeAll(async ({ playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await signInViaRequest(admin);
    original = (
      await (await admin.get('/api/skins/admin/config', { headers: getAuthHeader() })).json()
    ).config;
    await admin.dispose();
  });

  test.beforeEach(async ({ page, request }) => {
    await signInViaRequest(request);
    await setConfig(request, { enabled: true, catalogUnlocked: true });
    expect(await signInAsPlayer(page, STEAM_ID, 'Catalog UI Tester')).toBe(true);
    const weapons = (await (await page.request.get('/api/skins/catalog/weapons')).json()).weapons;
    for (const { slot } of weapons) await page.request.delete(`/api/skins/me/equip/${slot}`);
  });

  test.afterAll(async ({ playwright, baseURL }) => {
    const admin = await playwright.request.newContext({ baseURL });
    await signInViaRequest(admin);
    await setConfig(admin, original);
    await admin.dispose();
  });

  const catalogue = (page: import('@playwright/test').Page) =>
    page.getByTestId('inventory-view').getByRole('button', { name: 'Catalogue' });

  test(
    'an admin turns the catalogue unlock on and off',
    { tag: ['@ui'] },
    async ({ page, request }) => {
      await setConfig(request, { catalogUnlocked: false });
      await ensureSignedIn(page);
      await page.goto('/manage/skins');
      await expect(page.getByTestId('skins-settings')).toBeVisible({ timeout: 30000 });
      const toggle = page.getByRole('checkbox', { name: 'Catalogue unlock' });
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await expect
        .poll(async () => (await (await request.get('/api/skins/status')).json()).catalogUnlocked)
        .toBe(true);
      await toggle.uncheck();
      await expect
        .poll(async () => (await (await request.get('/api/skins/status')).json()).catalogUnlocked)
        .toBe(false);
    }
  );

  test(
    'a player picks a catalogue skin for CT with a float and seed',
    { tag: ['@ui'] },
    async ({ page }) => {
      await page.goto('/inventory');
      await catalogue(page).click();
      await page.getByRole('searchbox').fill('desert eagle');
      await page
        .getByTestId('catalog-tile')
        .filter({ hasText: 'Desert Eagle' })
        .first()
        .getByRole('button', { name: /^Equip/ })
        .click();

      const dialog = page.getByTestId('catalog-pick-dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Float').fill('0.05');
      await dialog.getByLabel('Pattern').fill('42');
      await dialog.getByTestId('catalog-pick-dialog-ct').click();
      await expect(dialog).toBeHidden();

      const ct = page.getByTestId('loadout-side-ct');
      const picked = ct.getByTestId('loadout-slot').filter({ hasText: 'Picked' });
      await expect(picked).toHaveCount(1);
      await expect(picked).toContainText('Desert Eagle');
      // T keeps the game's default.
      await expect(
        page.getByTestId('loadout-side-t').getByTestId('loadout-slot').filter({ hasText: 'Picked' })
      ).toHaveCount(0);

      const me = await (await page.request.get('/api/skins/me')).json();
      expect(me.picks[0]).toMatchObject({
        weapon: 'weapon_deagle',
        float: 0.05,
        pattern: 42,
        equippedSides: [3],
      });
    }
  );

  const openPick = async (page: import('@playwright/test').Page) => {
    await page.goto('/inventory');
    await catalogue(page).click();
    await page.getByRole('searchbox').fill('desert eagle');
    await page
      .getByTestId('catalog-tile')
      .filter({ hasText: 'Desert Eagle' })
      .first()
      .getByRole('button', { name: /^Equip/ })
      .click();
    const dialog = page.getByTestId('catalog-pick-dialog');
    await expect(dialog).toBeVisible();
    return dialog;
  };

  test(
    'an out-of-range float or pattern says what is allowed',
    { tag: ['@ui'] },
    async ({ page }) => {
      const dialog = await openPick(page);
      await dialog.getByLabel('Float').fill('2');
      await expect(dialog).toContainText('0 to 1');
      await dialog.getByLabel('Pattern').fill('5000');
      await expect(dialog).toContainText('0 to 1000');
      await expect(dialog.getByTestId('catalog-pick-dialog-ct')).toBeDisabled();
    }
  );

  test(
    'the pick dialog does not scroll sideways on a phone',
    { tag: ['@ui'] },
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openPick(page);
      const overflow = await page
        .locator('.MuiDialog-paper')
        .evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
  );

  test('a one-side weapon asks no side', { tag: ['@ui'] }, async ({ page }) => {
    await page.goto('/inventory');
    await catalogue(page).click();
    await page.getByRole('searchbox').fill('ak-47');
    await page
      .getByTestId('catalog-tile')
      .filter({ hasText: 'AK-47' })
      .first()
      .getByRole('button', { name: /^Equip/ })
      .click();
    const dialog = page.getByTestId('catalog-pick-dialog');
    await expect(dialog.getByTestId('catalog-pick-dialog-ct')).toHaveCount(0);
    await dialog.getByTestId('catalog-pick-dialog-both').click();
    await expect(dialog).toBeHidden();
    // AK-47 is a T weapon: only T shows it.
    await expect(
      page.getByTestId('loadout-side-t').getByTestId('loadout-slot').filter({ hasText: 'Picked' })
    ).toHaveCount(1);
    await expect(
      page.getByTestId('loadout-side-ct').getByTestId('loadout-slot').filter({ hasText: 'AK-47' })
    ).toHaveCount(0);
  });

  test('every weapon a side buys has a slot while unlocked', { tag: ['@ui'] }, async ({ page }) => {
    await page.goto('/inventory');
    const t = page.getByTestId('loadout-side-t');
    const ct = page.getByTestId('loadout-side-ct');
    await expect(t.getByTestId('loadout-slot').filter({ hasText: 'AK-47' })).toHaveCount(1);
    await expect(ct.getByTestId('loadout-slot').filter({ hasText: 'AK-47' })).toHaveCount(0);
    await expect(ct.getByTestId('loadout-slot').filter({ hasText: 'Desert Eagle' })).toHaveCount(1);

    await t.getByTestId('loadout-slot').filter({ hasText: 'AK-47' }).click();
    await expect(catalogue(page)).toHaveAttribute('aria-pressed', 'true');
    const tiles = page.getByTestId('catalog-tile');
    await expect(tiles.first()).toBeVisible();
    expect((await tiles.allTextContents()).every((x) => x.includes('AK-47'))).toBe(true);

    const overflow = async () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
    await page.setViewportSize({ width: 375, height: 800 });
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test(
    'a pick shows in its inspect dialog and comes off with its cross',
    { tag: ['@ui'] },
    async ({ page }) => {
      const weapons = (
        await (await page.request.get('/api/skins/catalog/search?weapon=weapon_deagle')).json()
      ).skins;
      const put = await page.request.put('/api/skins/me/picks', {
        data: {
          weapon: 'weapon_deagle',
          paintKit: weapons[0].paintKit,
          float: 0.2,
          seed: 9,
          team: 0,
        },
      });
      expect(put.ok()).toBe(true);
      await page.goto('/inventory');
      const slot = page
        .getByTestId('loadout-side-ct')
        .getByTestId('loadout-slot')
        .filter({ hasText: 'Picked' });
      await slot.click();
      await expect(page.getByTestId('skin-inspect')).toContainText('Picked from the catalogue');
      await page.keyboard.press('Escape');

      // Off CT only: T keeps the pick.
      await page.getByTestId('loadout-side-ct').getByTestId('loadout-slot-take-off').click();
      await expect(
        page
          .getByTestId('loadout-side-ct')
          .getByTestId('loadout-slot')
          .filter({ hasText: 'Picked' })
      ).toHaveCount(0);
      await expect(
        page.getByTestId('loadout-side-t').getByTestId('loadout-slot').filter({ hasText: 'Picked' })
      ).toHaveCount(1);
    }
  );

  test('a pick shows on the player profile', { tag: ['@ui'] }, async ({ page }) => {
    const skins = (
      await (await page.request.get('/api/skins/catalog/search?weapon=weapon_deagle')).json()
    ).skins;
    await page.request.put('/api/skins/me/picks', {
      data: { weapon: 'weapon_deagle', paintKit: skins[0].paintKit, float: 0.2, seed: 9, team: 0 },
    });
    await page.goto(`/player/${STEAM_ID}`);
    for (const side of ['ct', 't']) {
      await expect(page.getByTestId(`profile-loadout-${side}`)).toContainText('Desert Eagle', {
        timeout: 15000,
      });
    }
  });

  test(
    'the Catalogue view is hidden while the mode is off',
    { tag: ['@ui'] },
    async ({ page, request }) => {
      await setConfig(request, { catalogUnlocked: false });
      await page.goto('/inventory');
      await expect(page.getByTestId('inventory-page')).toBeVisible();
      await expect(page.getByTestId('inventory-view')).toHaveCount(0);
    }
  );
});
