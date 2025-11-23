import { Page, APIRequestContext } from '@playwright/test';

/**
 * Authentication helper functions
 */

const API_TOKEN = process.env.API_TOKEN || 'admin123';

/**
 * Sign in via UI
 * @param page Playwright page
 * @returns true if successful
 */
export async function signIn(page: Page): Promise<boolean> {
  try {
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(API_TOKEN);
    await page.getByRole('button', { name: /sign in/i }).click();
    
    // Wait for navigation away from login page
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 5000 });
    
    // Verify token is stored
    const token = await page.evaluate(() => localStorage.getItem('api_token'));
    return token === API_TOKEN;
  } catch (error) {
    console.error('Sign in failed:', error);
    return false;
  }
}

/**
 * Sign in via API (faster, sets token directly)
 * @param page Playwright page
 * @returns true if successful
 */
export async function signInViaAPI(page: Page): Promise<boolean> {
  try {
    await page.goto('/');
    await page.evaluate((token) => {
      localStorage.setItem('api_token', token);
    }, API_TOKEN);
    
    // Reload to apply token
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Verify we're not on login page
    const url = page.url();
    return !url.includes('/login');
  } catch (error) {
    console.error('API sign in failed:', error);
    return false;
  }
}

/**
 * Ensure user is signed in (checks first, signs in if needed)
 * @param page Playwright page
 */
export async function ensureSignedIn(page: Page): Promise<void> {
  // Navigate to a page first (required for localStorage access)
  await page.goto('/');
  
  // Check if already signed in
  try {
    const token = await page.evaluate(() => localStorage.getItem('api_token'));
    if (token === API_TOKEN) {
      // Verify we're not on login page
      const url = page.url();
      if (!url.includes('/login')) {
        return; // Already signed in
      }
    }
  } catch (error) {
    // If localStorage access fails, just sign in
  }
  
  // Sign in via API (faster)
  await signInViaAPI(page);
}

/**
 * Get API token for request headers
 */
export function getApiToken(): string {
  return API_TOKEN;
}

/**
 * Get authorization header
 */
export function getAuthHeader(): { Authorization: string } {
  return { Authorization: `Bearer ${API_TOKEN}` };
}

