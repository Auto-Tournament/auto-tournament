import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest } from '../helpers/auth';

/**
 * The Modules page: what this instance can run, and adding to it — one game
 * catalog of packs and signed code modules, plus importing a pack file.
 *
 * The page is the point of game packs — an admin who has to `curl` a JSON
 * file at an endpoint does not have a module system, they have an API. So
 * what is pinned here is the round trip a host actually makes: pick a file,
 * see the game appear with its tile, and take it away again.
 *
 * It also pins the sentence a refusal produces. The API says exactly what is
 * wrong with a pack — "icon contains an onload handler" — and that sentence
 * is the whole value of refusing rather than sanitising. A page that swallows
 * it and says "import failed" throws away the only thing the admin needed.
 *
 * @tag ui
 * @tag packs
 */

const TILE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="var(--at-ember, #ff6a3d)"/><path d="M3 3h10v10H3z" fill="var(--at-ink-900, #121213)"/></svg>';

const PACK = {
  schema: 1,
  slug: 'modules-page-game',
  name: 'Modules Page Game',
  engine: 'manual-report',
  version: '1.2.3',
  description: 'A game that exists only in this test.',
  // A file beside the pack, which the admin picks along with the JSON.
  icon: '../icons/modules-page-game.svg',
};

/** The two files a host selects: the pack, and the tile it names. */
function packFiles(pack: Record<string, unknown> = PACK) {
  return [
    {
      name: 'modules-page-game.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(pack)),
    },
    {
      name: 'modules-page-game.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(TILE),
    },
  ];
}

test.describe.serial('Modules page', () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    expect(await signInViaRequest(request)).toBe(true);
    await request.delete(`/api/packs/${PACK.slug}`);
  });

  test.afterEach(async ({ request }) => {
    await signInViaRequest(request);
    await request.delete(`/api/packs/${PACK.slug}`);
  });

  test(
    'an admin imports a pack from the page, sees the game, and removes it',
    { tag: ['@ui', '@packs'] },
    async ({ page, request }) => {
      await page.goto('/modules');
      await expect(page.getByTestId('modules-page')).toBeVisible({ timeout: 15000 });

      // The modules that ship with the app are listed as built in, not as
      // something to manage.
      await expect(page.getByTestId('module-cs2')).toBeVisible();
      await expect(page.getByTestId('module-manual-report')).toBeVisible();
      // The games the image ships are in the one catalog list; CI preinstalls
      // them (PREINSTALL_PACKS=all), so they show as installed.
      await expect(page.getByTestId('catalog-pack-rocket-league')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('catalog-pack-rocket-league-state')).toContainText(/installed/i);
      await expect(page.getByTestId(`catalog-pack-${PACK.slug}`)).toHaveCount(0);

      // Import a pack the way a host would: pick the file.
      await page.getByTestId('modules-file-input').setInputFiles(packFiles());

      const card = page.getByTestId(`catalog-pack-${PACK.slug}`);
      await expect(card).toBeVisible({ timeout: 15000 });
      await expect(card).toContainText(PACK.name);
      await expect(card).toContainText('1.2.3');
      // The tile is inlined rather than drawn as an <img>, which is what lets
      // it follow the theme: an <svg> element in the page, not a src.
      await expect(card.locator('svg').first()).toBeVisible();

      // The game is now one the wizard can start a tournament for.
      const playable = await request.get('/api/games/playable');
      const games = (await playable.json()).games as Array<Record<string, unknown>>;
      expect(games.find((game) => game.slug === PACK.slug)).toBeTruthy();

      // And it can be taken away again.
      await page.getByTestId(`catalog-pack-${PACK.slug}-uninstall`).click();
      await page.getByTestId('modules-confirm-remove').click();
      await expect(card).toHaveCount(0, { timeout: 15000 });
      // Only that one: the bundled games are untouched.
      await expect(page.getByTestId('catalog-pack-rocket-league')).toBeVisible();
    }
  );

  test(
    'a pack with a tile that would run something is refused, and the page says why',
    { tag: ['@ui', '@packs'] },
    async ({ page }) => {
      await page.goto('/modules');
      await expect(page.getByTestId('modules-page')).toBeVisible({ timeout: 15000 });

      await page.getByTestId('modules-file-input').setInputFiles([
        {
          name: 'modules-page-game.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(PACK)),
        },
        {
          name: 'modules-page-game.svg',
          mimeType: 'image/svg+xml',
          buffer: Buffer.from('<svg viewBox="0 0 1 1"><path d="M0 0" onload="alert(1)"/></svg>'),
        },
      ]);

      // The API's own sentence, not a generic failure.
      await expect(page.getByText(/onload/i)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`catalog-pack-${PACK.slug}`)).toHaveCount(0);
    }
  );
  test(
    'picking only the JSON of a pack that names a tile says which file is missing',
    { tag: ['@ui', '@packs'] },
    async ({ page }) => {
      await page.goto('/modules');
      await expect(page.getByTestId('modules-page')).toBeVisible({ timeout: 15000 });

      await page.getByTestId('modules-file-input').setInputFiles({
        name: 'modules-page-game.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(PACK)),
      });

      await expect(page.getByText(/modules-page-game\.svg/)).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId(`catalog-pack-${PACK.slug}`)).toHaveCount(0);
    }
  );

  test(
    'an admin installs a game from the catalog with one click',
    { tag: ['@ui', '@packs'] },
    async ({ page, request }) => {
      // The catalog pointed at the fake feed the API serves itself.
      const fake = await request.post('/api/test/catalog', { data: { fake: true, run: 'uipage' } });
      expect(fake.ok(), `pointing at the fake catalog: ${await fake.text()}`).toBe(true);
      await request.delete('/api/packs/index-test-game');

      try {
        await page.goto('/modules');
        await expect(page.getByTestId('modules-page')).toBeVisible({ timeout: 15000 });

        const entry = page.getByTestId('catalog-pack-index-test-game');
        await expect(entry).toBeVisible({ timeout: 15000 });
        await expect(entry).toContainText('2.0.0');
        // Its tile is drawn before anything is installed, inlined from our
        // own origin rather than loaded from wherever the feed lives.
        await expect(entry.locator('svg').first()).toBeVisible();

        await page.getByTestId('catalog-pack-index-test-game-install').click();
        await expect(page.getByTestId('catalog-pack-index-test-game-state')).toContainText(/installed/i, {
          timeout: 15000,
        });
        await expect(page.getByTestId('catalog-installed')).toContainText('Index Test Game');

        // A release whose signature does not hold is refused, and the row says why.
        await page.getByTestId('catalog-module-fixture-cat-tampered-uipage-install').click();
        await page.getByTestId('catalog-confirm-install-go').click();
        await expect(page.getByTestId('catalog-module-fixture-cat-tampered-uipage-failure')).toContainText(
          /changed after signing/,
          { timeout: 15000 }
        );
      } finally {
        await request.delete('/api/packs/index-test-game');
        await request.post('/api/test/catalog', { data: { fake: false } });
      }
    }
  );

  test(
    "an admin also picks the instance's games on /welcome/games",
    { tag: ['@ui', '@packs'] },
    async ({ page }) => {
      await page.goto('/welcome/games');
      const section = page.getByTestId('welcome-games-instance');
      await expect(section).toBeVisible({ timeout: 15000 });
      await expect(section.getByTestId('game-catalog')).toBeVisible({ timeout: 15000 });
      await expect(section.getByTestId('catalog-pack-rocket-league')).toBeVisible();
    }
  );
});
