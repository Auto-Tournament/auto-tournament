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
    const input = page.getByTestId('login-api-token-input');
    await input.fill(API_TOKEN);
    await page.getByTestId('login-sign-in-button').click();
    
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
    // Navigate with increased timeout and fallback
    // Try multiple strategies: domcontentloaded -> commit -> networkidle
    let navigationSuccess = false;
    const strategies = [
      { waitUntil: 'domcontentloaded' as const, timeout: 30000 },
      { waitUntil: 'commit' as const, timeout: 15000 },
      { waitUntil: 'networkidle' as const, timeout: 10000 },
    ];
    
    for (const strategy of strategies) {
      try {
        await page.goto('/', strategy);
        navigationSuccess = true;
        break;
      } catch (error) {
        console.warn(`Navigation with ${strategy.waitUntil} timed out, trying next strategy...`);
        // Continue to next strategy
      }
    }
    
    if (!navigationSuccess) {
      console.error('All navigation strategies failed');
      return false;
    }
    
    await page.evaluate((token) => {
      localStorage.setItem('api_token', token);
    }, API_TOKEN);
    
    // Reload to apply token
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (error) {
      // If reload times out, try with commit
      await page.reload({ waitUntil: 'commit', timeout: 10000 });
    }
    
    // Wait for networkidle with timeout (some pages have long-running requests/websockets)
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch (error) {
      // If networkidle times out, wait for domcontentloaded instead
      await page.waitForLoadState('domcontentloaded');
      // Give a small delay for any initial requests
      await page.waitForTimeout(1000);
    }
    
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
  // Try multiple strategies with fallbacks
  let navigationSuccess = false;
  const strategies = [
    { waitUntil: 'domcontentloaded' as const, timeout: 30000 },
    { waitUntil: 'commit' as const, timeout: 15000 },
  ];
  
  for (const strategy of strategies) {
    try {
      await page.goto('/', strategy);
      navigationSuccess = true;
      break;
    } catch (error) {
      console.warn(`ensureSignedIn: Navigation with ${strategy.waitUntil} timed out, trying next strategy...`);
      // Continue to next strategy
    }
  }
  
  if (!navigationSuccess) {
    throw new Error('Failed to navigate to page for authentication - server may not be responding');
  }
  
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

