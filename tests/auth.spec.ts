import { test, expect } from '@playwright/test';

/**
 * Authentication tests
 * @tag auth
 * @tag login
 * @tag logout
 */

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing authentication
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('should display login page when not authenticated', { tag: ['@auth', '@login'] }, async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Login/i);
    
    // Check for login form elements
    const passwordInput = page.getByLabel(/api token/i);
    await expect(passwordInput).toBeVisible();
    
    const loginButton = page.getByRole('button', { name: /sign in/i });
    await expect(loginButton).toBeVisible();
  });

  test('should redirect to login when accessing protected route', { tag: ['@auth', '@login'] }, async ({ page }) => {
    await page.goto('/teams');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });

  test('should login with valid API token', { tag: ['@auth', '@login'] }, async ({ page }) => {
    const apiToken = process.env.API_TOKEN || 'admin123';
    
    await page.goto('/login');
    
    // Enter API token
    const passwordInput = page.getByLabel(/api token/i);
    await passwordInput.fill(apiToken);
    
    // Click login button
    const loginButton = page.getByRole('button', { name: /sign in/i });
    await loginButton.click();
    
    // Should redirect to dashboard/home
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\//);
    
    // Verify token is stored
    const token = await page.evaluate(() => localStorage.getItem('api_token'));
    expect(token).toBe(apiToken);
  });

  test('should show error with invalid API token', { tag: ['@auth', '@login'] }, async ({ page }) => {
    await page.goto('/login');
    
    // Enter invalid token
    const passwordInput = page.getByLabel(/api token/i);
    await passwordInput.fill('invalid-token-12345');
    
    // Click login button
    const loginButton = page.getByRole('button', { name: /sign in/i });
    await loginButton.click();
    
    // Should show error message
    await expect(page.getByText(/invalid|error|failed/i)).toBeVisible();
    
    // Should still be on login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should logout successfully', { tag: ['@auth', '@logout'] }, async ({ page }) => {
    const apiToken = process.env.API_TOKEN || 'admin123';
    
    // Login first
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    
    // Wait for navigation
    await expect(page).not.toHaveURL(/\/login/);
    
    // Find and click logout button (Sign out button in header)
    const logoutButton = page.getByRole('button', { name: /sign out/i });
    
    await logoutButton.click();
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
    
    // Verify token is cleared
    const token = await page.evaluate(() => localStorage.getItem('api_token'));
    expect(token).toBeNull();
  });

  test('should persist login after page reload', { tag: ['@auth', '@login'] }, async ({ page }) => {
    const apiToken = process.env.API_TOKEN || 'admin123';
    
    // Login
    await page.goto('/login');
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
    
    // Reload page
    await page.reload();
    
    // Should still be authenticated (not redirected to login)
    await expect(page).not.toHaveURL(/\/login/);
  });
});

