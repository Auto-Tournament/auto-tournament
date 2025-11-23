import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { createTestServer, deleteServer, type Server } from '../helpers/servers';

/**
 * Server API tests
 * Tests server CRUD operations via API
 * 
 * @tag api
 * @tag servers
 * @tag crud
 */

test.describe.serial('Server API', () => {
  let context: Awaited<ReturnType<typeof setupTestContext>>;
  let createdServer: Server | null = null;

  test.beforeAll(async ({ page, request }) => {
    context = await setupTestContext(page, request);
  });

  test('should create, verify, and delete a server', {
    tag: ['@api', '@servers', '@crud'],
  }, async ({ request }) => {
    // Create server
    const server = await createTestServer(request, 'api-test');
    expect(server).toBeTruthy();
    expect(server?.id).toBeTruthy();
    expect(server?.name).toBeTruthy();
    createdServer = server;

    // Verify server exists via API
    const getResponse = await request.get(`/api/servers/${server!.id}`, {
      headers: { Authorization: `Bearer ${context.apiToken}` },
    });
    expect(getResponse.ok()).toBeTruthy();
    const serverData = await getResponse.json();
    expect(serverData.server.id).toBe(server!.id);
    expect(serverData.server.name).toBe(server!.name);

    // Delete server
    const deleteResult = await deleteServer(request, server!.id);
    expect(deleteResult).toBe(true);

    // Verify server is deleted
    const getDeletedResponse = await request.get(`/api/servers/${server!.id}`);
    expect(getDeletedResponse.status()).toBe(404);
  });
});

