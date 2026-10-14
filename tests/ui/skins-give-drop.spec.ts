import { test, expect } from '@playwright/test';
import { getAuthHeader, signIn, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Giving a drop is done by name: from a player's row on Manage → Players,
 * and on Manage → Skins with a name search for the player (no Steam IDs,
 * team ids or match slugs typed).
 *
 * @tag ui
 * @tag skins
 */

test(
  'give a drop from the Players row and by name on the Skins page',
  { tag: ['@ui'] },
  async ({ page, request, playwright }) => {
    test.setTimeout(60_000);
    await signInViaRequest(request);
    const headers = getAuthHeader();
    const config = (await (await request.get('/api/skins/admin/config', { headers })).json())
      .config;
    const stamp = String(Date.now()).slice(-7);
    const steamId = `7656119806${stamp}`;
    const name = `Dropname ${stamp}`;
    const player = await playwright.request.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
    });
    try {
      await request.put('/api/skins/admin/config', { headers, data: { enabled: true } });
      expect(await signInAsPlayerViaRequest(player, steamId, name)).toBe(true);
      const waiting = async () =>
        ((await (await player.get('/api/skins/me')).json()).choices ?? []).length as number;
      const before = await waiting();

      expect(await signIn(page)).toBe(true);

      // Manage → Players: the row's menu has "Give a drop", which names the player.
      await page.goto(`/manage/players`);
      await page.getByTestId('players-search-input').fill(name);
      await page.getByTestId(`player-actions-${steamId}`).click();
      await page.getByTestId(`player-action-give-drop-${steamId}`).click();
      const confirm = page.getByTestId('give-drops-confirm');
      await expect(confirm).toContainText(name);
      await confirm.getByTestId('give-drops-give').click();
      await expect.poll(waiting).toBe(before + 1);

      // Manage → Skins: pick the player by typing their name.
      await page.goto('/manage/skins');
      const panel = page.getByTestId('give-drops');
      await panel.getByTestId('give-drops-player').click();
      await expect(panel.getByTestId('give-drops-start')).toBeDisabled();
      await panel.getByTestId('give-drops-pick').fill(name.slice(0, 8));
      await page.getByRole('option', { name: new RegExp(name) }).click();
      await panel.getByTestId('give-drops-start').click();
      await expect(page.getByTestId('give-drops-confirm')).toContainText(name);
      await page.getByTestId('give-drops-confirm').getByTestId('give-drops-give').click();
      await expect.poll(waiting).toBe(before + 2);
    } finally {
      await request.put('/api/skins/admin/config', { headers, data: config });
      await player.dispose();
    }
  }
);
