import { Page, APIRequestContext } from '@playwright/test';
import { getAuthHeader } from './auth';

/**
 * Database helper functions
 */

/**
 * Wipe database via API
 * @param request Playwright API request context
 */
export async function wipeDatabase(request: APIRequestContext): Promise<boolean> {
  try {
    const response = await request.delete('/api/dev/wipe', {
      headers: getAuthHeader(),
    });
    return response.ok();
  } catch (error) {
    console.error('Database wipe failed:', error);
    return false;
  }
}

/**
 * Wipe database via UI (clicks the button in dev tools)
 * @param page Playwright page
 */
export async function wipeDatabaseViaUI(page: Page): Promise<boolean> {
  try {
    // Navigate to dev tools or settings page where wipe button exists
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    
    // Look for wipe/danger zone button
    const wipeButton = page.getByTestId('wipe-database-button');
    const buttonVisible = await wipeButton.isVisible().catch(() => false);
    
    if (buttonVisible) {
      await wipeButton.click();
      
      // Handle confirmation dialog if present
      const confirmButton = page.getByTestId('confirm-dialog-confirm-button');
      const confirmVisible = await confirmButton.isVisible({ timeout: 2000 }).catch(() => false);
      if (confirmVisible) {
        await confirmButton.click();
      }
      
      // Wait for operation to complete
      await page.waitForTimeout(1000);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('UI database wipe failed:', error);
    return false;
  }
}

/**
 * Wipe database (tries API first, falls back to UI)
 * @param page Playwright page
 * @param request Playwright API request context
 */
export async function wipeDatabaseAuto(
  page: Page,
  request: APIRequestContext
): Promise<boolean> {
  // Try API first (faster)
  const apiResult = await wipeDatabase(request);
  if (apiResult) {
    return true;
  }
  
  // Fall back to UI
  return await wipeDatabaseViaUI(page);
}

