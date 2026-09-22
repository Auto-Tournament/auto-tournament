import { Page, APIRequestContext } from '@playwright/test';
import { ensureSignedIn, signInViaRequest, getAuthHeader } from './auth';
import { wipeDatabaseAuto } from './database';

/**
 * Global test setup helpers
 */

export interface TestContext {
  page: Page;
  request: APIRequestContext;
  baseUrl: string;
}

/**
 * Setup test context with authentication
 * @param page Playwright page
 * @param request Playwright API request context
 * @returns Test context
 */
export async function setupTestContext(
  page: Page,
  request: APIRequestContext
): Promise<TestContext> {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';

  // Sign in on BOTH cookie jars. `page` and the standalone `request` fixture do
  // not share cookies, and almost every API helper in tests/helpers uses
  // `request` — without this, admin-guarded endpoints return 401.
  await ensureSignedIn(page);
  await signInViaRequest(request);

  return {
    page,
    request,
    baseUrl,
  };
}

/**
 * Setup test context with fresh database
 * @param page Playwright page
 * @param request Playwright API request context
 * @returns Test context
 */
export async function setupTestContextWithFreshDB(
  page: Page,
  request: APIRequestContext
): Promise<TestContext> {
  // Sign in first: the reset endpoint is admin-guarded, so we cannot wipe
  // before we are authenticated.
  await setupTestContext(page, request);

  await wipeDatabaseAuto(page, request);

  // Sign in again. The reset drops the players table, taking the admin's
  // players row with it — the session cookie survives but admin rights are
  // resolved from the DB on every request, so the row has to be recreated.
  return await setupTestContext(page, request);
}

/**
 * Configure webhook URL (required for match loading)
 * @param request Playwright API request context
 * @param baseUrl Base URL for webhook
 */
export async function configureWebhook(
  request: APIRequestContext,
  baseUrl: string
): Promise<boolean> {
  try {
    const response = await request.put('/api/settings', {
      headers: getAuthHeader(),
      data: { webhookUrl: baseUrl },
    });
    
    if (!response.ok()) {
      return false;
    }
    
    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.warn('Could not configure webhook URL:', error);
    return false;
  }
}

