import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * Server UI tests
 * Tests server management via UI
 *
 * @tag ui
 * @tag servers
 * @tag crud
 */

test.describe.serial('Server UI', () => {
  let context: Awaited<ReturnType<typeof setupTestContext>>;

  test.beforeEach(async ({ page, request }) => {
    context = await setupTestContext(page, request);
  });

  test(
    'should create, view, and delete server via UI',
    {
      tag: ['@ui', '@servers', '@crud'],
    },
    async ({ page }) => {
      // Navigate to servers page
      await page.goto('/servers');
      await page.waitForLoadState('networkidle');

      // Step 1: Create server via UI
      // With no servers yet the page shows an empty state whose CTA is the only
      // way in; once servers exist the header action appears instead.
      const addButton = page
        .getByTestId('add-server-button')
        .or(page.getByTestId('empty-state-action'))
        .first();
      await expect(addButton).toBeVisible({ timeout: 10000 });
      await addButton.click();

      // Wait for modal
      const modal = page.getByTestId('server-modal');
      await expect(modal).toBeVisible();

      // Fill in server details
      const timestamp = Date.now();
      const serverName = `UI Test Server ${timestamp}`;
      // 0.0.0.0 marks a fake server: the API skips RCON for it. A reachable-looking
      // host left behind by this test would block every later tournament start
      // with `cs2_outdated_servers`.
      const serverHost = '0.0.0.0';
      const serverPort = String(27015 + (timestamp % 1000));
      const serverPassword = 'testpassword123';

      await page.getByTestId('server-name-input').fill(serverName);
      await page.getByTestId('server-host-input').fill(serverHost);
      await page.getByTestId('server-port-input').fill(serverPort);
      await page.getByTestId('server-password-input').fill(serverPassword);

      // Submit form
      const submitButton = page.getByTestId('server-save-button');
      await Promise.all([
        page
          .waitForResponse(
            (resp) =>
              resp.url().includes('/api/servers') &&
              (resp.request().method() === 'POST' || resp.request().method() === 'PUT'),
            { timeout: 15000 }
          )
          .catch(() => null),
        submitButton.click({ timeout: 15000 }),
      ]);

      // Wait for modal to close
      await expect(modal).not.toBeVisible({ timeout: 10000 });
      await page.waitForLoadState('networkidle');

      // Step 2: Verify server appears in UI
      const serverCard = page.getByTestId(`server-card-${serverName.replace(/\s+/g, '-').toLowerCase()}`);
      await expect(serverCard).toBeVisible({ timeout: 15000 });

      // Verify server details are visible
      const serverHostInList = serverCard.getByTestId('server-host');
      await expect(serverHostInList).toBeVisible();

      // Step 3: Delete the server through the modal.
      //
      // There is no server-edit-button in the client — the card itself opens the
      // modal. The previous version looked for that button, found nothing, and
      // silently skipped the entire delete stage while still reporting success.
      //
      // Reopen the dialog immediately, with no wait. Saving kicks off several
      // seconds of asynchronous work, and this used to end in a stale
      // handleCloseModal() that tore down whichever dialog was open by then —
      // Playwright saw the delete button detach mid-click. Clicking straight
      // away is what a real user does, and is the point of the assertion.
      await serverCard.click();
      await expect(modal).toBeVisible();

      await page.getByTestId('server-delete-button').click();
      await expect(page.getByTestId('confirm-dialog')).toBeVisible();

      // Assert the response rather than swallowing it — a failed DELETE would
      // otherwise show up only as a confusing "card still present".
      const [deleteResponse] = await Promise.all([
        page.waitForResponse(
          (resp) => resp.url().includes('/api/servers') && resp.request().method() === 'DELETE',
          { timeout: 15000 }
        ),
        page.getByTestId('confirm-dialog-confirm-button').click(),
      ]);
      expect(deleteResponse.ok(), 'DELETE /api/servers should succeed').toBe(true);

      await expect(serverCard).toHaveCount(0);
    }
  );
});
