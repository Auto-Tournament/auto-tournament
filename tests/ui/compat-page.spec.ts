import { test, expect } from '@playwright/test';
import { compatDoc, pushCompat } from '../helpers/compat';

/**
 * The public Ready Up compatibility page (`/compatibility`): no sign-in, the
 * newest run with its components and their checks, the run history, and live
 * updates over Socket.IO (`compat:update`) without a reload.
 *
 * Runs are pushed through the API with the CI's token (helpers/compat), so
 * the server needs COMPAT_INGEST_TOKEN. Each pushed run starts "now", so it
 * is the newest whatever other specs stored before.
 *
 * @tag ui
 * @tag compat
 */

test.describe.serial('Ready Up compatibility page', () => {
  test('shows the newest run to an anonymous visitor', { tag: ['@ui', '@compat'] }, async ({ page, request }) => {
    const doc = compatDoc({ overall: 'warn', run: { state: 'warn', stage: 'selftest' } });
    doc.components[1].status = 'warn';
    doc.components[1].checks[0] = {
      kind: 'event',
      status: 'warn',
      passed: 11,
      total: 12,
      failures: ['round_officially_ended fired twice'],
    };
    doc.components.push({ id: 'skins', name: 'Skins', status: 'fail', checks: [
      { kind: 'signature', status: 'fail', passed: 2, total: 3, failures: ['CEconItemView::GetStaticData'] },
    ] });
    await pushCompat(request, doc);

    await page.goto('/compatibility', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('compat-overall-status')).toHaveAttribute('data-status', 'warn');
    await expect(page.getByTestId('compat-overall-status')).toHaveText('Compatible, with warnings');
    await expect(page.getByTestId('compat-patch')).toContainText('1.41.8.5');
    await expect(page.getByTestId('compat-buildid')).toContainText('25537370');
    await expect(page.getByTestId('compat-checked-ago')).toContainText('Checked');
    await expect(page.getByTestId('compat-run-link')).toHaveAttribute('href', doc.run.url);

    // One row per component, each with its own status.
    await expect(page.getByTestId('compat-component-core')).toBeVisible();
    await expect(page.getByTestId('compat-component-dot-core')).toHaveAttribute('data-tone', 'pass');
    await expect(page.getByTestId('compat-component-dot-match')).toHaveAttribute('data-tone', 'warn');
    await expect(page.getByTestId('compat-component-dot-skins')).toHaveAttribute('data-tone', 'fail');

    // Checks open on demand, with passed/total and the failures.
    const skins = page.getByTestId('compat-component-skins');
    await expect(skins.getByText('CEconItemView::GetStaticData')).toHaveCount(0);
    await page.getByTestId('compat-component-toggle-skins').click();
    await expect(page.getByTestId('compat-component-toggle-skins')).toHaveAttribute('aria-expanded', 'true');
    await expect(skins.getByTestId('compat-check-signature')).toContainText('2/3');
    await expect(skins.getByText('CEconItemView::GetStaticData')).toBeVisible();

    // The run is in the history.
    await expect(page.locator(`[data-testid="compat-history-run"][data-run-id="${doc.run.id}"]`)).toBeVisible();
  });

  test('follows a run live, without a reload', { tag: ['@ui', '@compat'] }, async ({ page, request }) => {
    await pushCompat(request, compatDoc());
    await page.goto('/compatibility', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('compat-overall-status')).toHaveAttribute('data-status', 'pass');
    // Subscribed: the page has joined the compat room.
    await expect(page.getByTestId('compat-live')).toHaveAttribute('data-live', 'true');
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));

    // A new CS2 build lands and the CI starts checking it.
    const checking = compatDoc({
      cs2: { buildid: '25600001', patch: '1.41.9.0' },
      run: { state: 'checking', stage: 'static', finished_at: null },
      overall: 'checking',
    });
    checking.components[0].status = 'checking';
    checking.components[0].checks = [{ kind: 'signature', status: 'pending', passed: 3, total: 9, failures: [] }];
    await pushCompat(request, checking);

    await expect(page.getByTestId('compat-overall-status')).toHaveAttribute('data-status', 'checking');
    await expect(page.getByTestId('compat-patch')).toContainText('1.41.9.0');
    await expect(page.getByTestId('compat-component-dot-core')).toHaveAttribute('data-tone', 'checking');
    await expect(page.locator(`[data-testid="compat-history-run"][data-run-id="${checking.run.id}"]`)).toBeVisible();

    // The same run finishes and fails.
    const failed = compatDoc({
      cs2: checking.cs2,
      run: { ...checking.run, state: 'fail', finished_at: new Date().toISOString() },
      overall: 'fail',
      checked_at: new Date(Date.now() + 1000).toISOString(),
    });
    failed.components[0].status = 'fail';
    failed.components[0].checks = [
      { kind: 'signature', status: 'fail', passed: 8, total: 9, failures: ['CCSPlayerPawn::Think'] },
    ];
    await pushCompat(request, failed);

    await expect(page.getByTestId('compat-overall-status')).toHaveAttribute('data-status', 'fail');
    await expect(page.getByTestId('compat-component-dot-core')).toHaveAttribute('data-tone', 'fail');
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  });

  test('says so when there is nothing yet, or the feature is off', { tag: ['@ui', '@compat'] }, async ({ page }) => {
    await page.route('**/api/compat/latest', (route) => route.fulfill({ json: { success: true, latest: null } }));
    await page.route('**/api/compat/runs**', (route) => route.fulfill({ json: { success: true, runs: [] } }));
    await page.goto('/compatibility', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('compat-empty')).toBeVisible();

    await page.unrouteAll();
    await page.route('**/api/compat/**', (route) =>
      route.fulfill({ status: 404, json: { success: false, error: 'compat_disabled' } })
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('compat-disabled')).toBeVisible();
  });
});
