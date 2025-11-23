import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { createTestServer, deleteServer, type Server } from '../helpers/servers';

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
  let createdServer: Server | null = null;

  test.beforeAll(async ({ page, request }) => {
    context = await setupTestContext(page, request);
  });

  test('should create, view, and delete server via UI', {
    tag: ['@ui', '@servers', '@crud'],
  }, async ({ page, request }) => {
    // Navigate to servers page
    await page.goto('/servers');
    await page.waitForLoadState('networkidle');

    // Create server via API (for testing)
    const server = await createTestServer(request, 'ui-test');
    expect(server).toBeTruthy();
    createdServer = server;

    // Reload page to see the new server
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify server appears in UI
    const serverName = page.getByText(server!.name);
    await expect(serverName).toBeVisible({ timeout: 5000 });

    // Verify server details are visible
    const serverHost = page.getByText(server!.host);
    await expect(serverHost).toBeVisible();

    // Delete server via API
    const deleteResult = await deleteServer(request, server!.id);
    expect(deleteResult).toBe(true);

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify server is no longer visible
    await expect(serverName).not.toBeVisible({ timeout: 3000 });
  });
});

