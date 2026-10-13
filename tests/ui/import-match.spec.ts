import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/**
 * Manage → All matches → Import a match: picking demos (a CS:GO or other
 * file is refused before anything uploads), their order, and moving one.
 *
 * @tag ui
 * @tag cs2
 */

const cs2Demo = (name: string) => {
  const buffer = Buffer.alloc(4096);
  buffer.write('PBDEMS2\0', 0, 'latin1');
  return { name, mimeType: 'application/octet-stream', buffer };
};

test(
  'import a match: picking demos, refusing what is not a CS2 demo, and their order',
  { tag: ['@ui'] },
  async ({ page }) => {
    await ensureSignedIn(page);
    await page.goto('/manage/played/import');
    const files = page.getByTestId('import-files');

    // A CS:GO demo (or anything else named .dem) is refused when picked.
    await files.setInputFiles({
      name: 'old-csgo.dem',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('HL2DEMO\0' + 'x'.repeat(64)),
    });
    await expect(page.getByTestId('import-error')).toContainText('old-csgo.dem is not a CS2 demo');

    // Two maps, picked together: in name order.
    await files.setInputFiles([cs2Demo('m2-dust2.dem'), cs2Demo('m1-nuke.dem')]);
    await expect(page.getByTestId('import-error')).toHaveCount(0);
    const main = page.locator('main');
    await expect(main).toContainText('Map 1');
    const order = async () =>
      (await main.innerText()).indexOf('m1-nuke.dem') <
      (await main.innerText()).indexOf('m2-dust2.dem');
    expect(await order()).toBe(true);
    await page.getByRole('button', { name: 'Move m1-nuke.dem down' }).click();
    expect(await order()).toBe(false);
    await expect(page.getByRole('button', { name: 'Move m2-dust2.dem up' })).toBeDisabled();
  }
);
