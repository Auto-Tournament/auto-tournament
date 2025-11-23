import { Page, APIRequestContext } from '@playwright/test';
import { ensureSignedIn, getAuthHeader } from './auth';
import { wipeDatabaseAuto } from './database';

/**
 * Global test setup helpers
 */

export interface TestContext {
  page: Page;
  request: APIRequestContext;
  apiToken: string;
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
  const apiToken = process.env.API_TOKEN || 'admin123';
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
  
  // Ensure signed in
  await ensureSignedIn(page);
  
  return {
    page,
    request,
    apiToken,
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
  // Wipe database first
  await wipeDatabaseAuto(page, request);
  
  // Then setup context
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

