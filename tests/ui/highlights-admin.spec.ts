import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/** Core's Highlights page (pages/HighlightsAdmin.tsx) and CS2's tab on it. */
test.describe('Highlights page', () => {
  test("settings are core's; CS2 adds its recorders tab", { tag: ['@ui'] }, async ({ page }) => {
    await ensureSignedIn(page);
    await page.goto('/manage/highlights');
    await expect(page.getByTestId('highlights-admin-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('highlights-settings')).toBeVisible();
    await expect(page.getByTestId('highlights-resolution')).toBeVisible();

    const cs2 = page.getByTestId('highlights-tab-cs2');
    await expect(cs2).toBeVisible({ timeout: 30000 });
    await cs2.click();
    await expect(page.getByTestId('cs2-highlights-admin')).toBeVisible();
    await expect(page.getByTestId('highlights-tab-recorders')).toBeVisible();
  });
});

test(
  'recorder groups can be created, assigned and disabled from the platform',
  { tag: ['@ui'] },
  async ({ page }, testInfo) => {
    await ensureSignedIn(page);
    const stamp = Date.now();
    const name = `ui-recorder-${stamp}`;
    const groupName = `UI Fleet ${stamp}`;
    await page.request.post('/api/game/cs2/recorder/claim', {
      data: { recorder: name, version: 6, notReady: 'UI test' },
    });
    await page.goto('/manage/highlights');
    await page.getByTestId('highlights-tab-cs2').click();
    await page.getByTestId('recorder-group-name').fill(groupName);
    await page.getByTestId('recorder-group-create').click();
    const row = page.getByTestId(`recorder-${name}`);
    await row.getByRole('combobox').click();
    await page.getByRole('option', { name: groupName, exact: true }).click();
    await expect
      .poll(async () => {
        const res = await page.request.get('/api/game/cs2/recorders');
        return (await res.json()).recorders.find((r: { name: string }) => r.name === name)
          ?.groupName;
      })
      .toBe(groupName);
    await page.getByTestId(`recorder-toggle-${name}`).click();
    await expect(page.getByTestId(`recorder-toggle-${name}`)).not.toBeChecked();
    await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
    await page.getByTestId(`recorder-toggle-${name}`).click();
    await expect(page.getByTestId(`recorder-toggle-${name}`)).toBeChecked();
    const { groups } = await (await page.request.get('/api/game/cs2/recorder-groups')).json();
    const group = groups.find((g: { name: string }) => g.name === groupName);
    await page.getByTestId(`recorder-group-toggle-${group.id}`).click();
    await expect(page.getByTestId(`recorder-group-toggle-${group.id}`)).not.toBeChecked();
    await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
    await page.goto('/played/import');
    await page.getByTestId('import-recording-group').getByRole('combobox').click();
    await page.getByRole('option', { name: `${groupName} · Disabled`, exact: true }).click();
    await expect(page.getByTestId('import-recording-group').getByRole('combobox')).toHaveText(
      `${groupName} · Disabled`
    );
    await expect(page.getByRole('listbox')).not.toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('import.png'), fullPage: true });
    await page.goto('/manage/highlights');
    await page.getByTestId('highlights-tab-cs2').click();
    await expect(page.getByTestId(`recorder-${name}`)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('recorders.png'), fullPage: true });
  }
);
