import { test, expect } from '@playwright/test';
import { ensureSignedIn } from '../helpers/auth';

/** Core's Highlights page (pages/HighlightsAdmin.tsx) and CS2's tab on it. */
test.describe('Highlights page', () => {
  test("settings are core's; CS2 adds its recorders tab", { tag: ['@ui'] }, async ({ page }) => {
    await ensureSignedIn(page);
    await page.goto('/manage/highlights');
    await expect(page.getByTestId('highlights-admin-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('highlights-settings')).toBeVisible();
    // The quality is a preset; Custom shows resolution, frame rate and bitrate.
    await expect(page.getByTestId('highlights-preset')).toBeVisible();
    await page.getByRole('combobox', { name: 'Video quality' }).click();
    await page.getByRole('option', { name: 'Custom', exact: true }).click();
    await expect(page.getByTestId('highlights-resolution')).toBeVisible();
    await expect(page.getByTestId('highlights-bitrate')).toBeVisible();

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
    await row.getByRole('button', { expanded: false }).click();
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
    await expect(page.getByTestId(`recorder-toggle-${name}`)).toBeDisabled();
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

test(
  'recorder cards sort naturally, gate header toggles and queue updates once',
  { tag: ['@ui'] },
  async ({ page }) => {
    await ensureSignedIn(page);
    let enabled = true;
    let queued = false;
    let updateRequests = 0;
    const individual: Record<string, boolean> = {
      csrender1: true,
      csrender2: true,
      csrender10: true,
    };
    await page.route('**/api/game/cs2/recorder-groups', async (route) =>
      route.fulfill({ json: { groups: [{ id: 91, name: 'NTLAN Lars', enabled }] } })
    );
    await page.route('**/api/game/cs2/recorder-groups/91', async (route) => {
      enabled = route.request().postDataJSON().enabled;
      await route.fulfill({ json: { success: true } });
    });
    await page.route('**/api/game/cs2/recorders', async (route) =>
      route.fulfill({
        json: {
          recorders: ['csrender10', 'csrender2', 'csrender1'].map((name) => ({
            name,
            label: null,
            groupId: 91,
            groupName: 'NTLAN Lars',
            enabled: individual[name],
            effectiveEnabled: enabled && individual[name],
            online: name !== 'csrender10',
            paused: false,
            working: null,
            lastSeen: Date.now() / 1000,
            lastRunFailed: name === 'csrender2',
            lastError: name === 'csrender2' ? 'Test failure' : null,
            version: 7,
            gpu: 'Test GPU',
            clipsOk: 1,
            runs: 1,
            benchmarkWanted: false,
            updateSupported: true,
            updateAvailable: true,
            updateStatus: queued ? 'queued' : 'current',
            updateRequestedAt: queued ? Date.now() / 1000 : null,
            recorderRevision: '0123456789abcdef',
          })),
        },
      })
    );
    await page.route('**/api/game/cs2/recorders/*/controls', async (route) => {
      const name = route.request().url().split('/').at(-2)!;
      individual[name] = route.request().postDataJSON().enabled;
      await route.fulfill({ json: { success: true } });
    });
    await page.route('**/api/game/cs2/recorders/update-all', async (route) => {
      updateRequests++;
      queued = true;
      await route.fulfill({ json: { success: true, queued: 3 } });
    });
    await page.goto('/manage/highlights');
    await page.getByTestId('highlights-tab-cs2').click();
    const card = page.getByTestId('recorder-card-91');
    await expect(card).toBeVisible();
    await expect(card.getByText('2/3 connected')).toBeVisible();
    await expect(card.getByText('3/3 enabled')).toBeVisible();
    expect(
      await card
        .locator('[data-testid^="recorder-csrender"]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')))
    ).toEqual(['recorder-csrender1', 'recorder-csrender2', 'recorder-csrender10']);
    const row = page.getByTestId('recorder-csrender2');
    await expect(row.getByText('Test GPU')).not.toBeVisible();
    await expect(row.getByText('Connected', { exact: true })).toBeVisible();
    const failedColor = await row
      .getByText('csrender2', { exact: true })
      .evaluate((node) => window.getComputedStyle(node).color);
    const goodColor = await page
      .getByTestId('recorder-csrender1')
      .getByText('csrender1', { exact: true })
      .evaluate((node) => window.getComputedStyle(node).color);
    expect(failedColor).not.toBe(goodColor);
    await page.getByTestId('recorder-toggle-csrender2').click();
    await expect(page.getByTestId('recorder-toggle-csrender2')).not.toBeChecked();
    await expect(row.getByRole('button', { expanded: false })).toBeVisible();
    await page.getByTestId('recorder-group-toggle-91').click();
    await expect(page.getByTestId('recorder-toggle-csrender1')).toBeDisabled();
    await expect(card.getByText('0/3 enabled')).toBeVisible();
    await row.getByRole('button', { expanded: false }).click();
    await expect(row.getByText('Test GPU', { exact: false })).toBeVisible();
    await page.getByTestId('recorder-update-all').click();
    await expect(page.getByTestId('recorder-update-all')).toBeDisabled();
    await expect(page.getByTestId('recorder-update-csrender2')).toBeDisabled();
    // How far it has got: none of the three updated yet.
    await expect(page.getByTestId('recorders-update-batch')).toContainText(
      'Updating: 0 of 3 updated'
    );
    expect(updateRequests).toBe(1);
  }
);
