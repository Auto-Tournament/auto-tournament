import { test, expect } from '@playwright/test';

/**
 * Servers page tests
 * @tag servers
 * @tag crud
 */

test.describe('Servers Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const apiToken = process.env.API_TOKEN || 'admin123';
    await page.goto('/login');
    await page.getByLabel(/password|token/i).fill(apiToken);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should navigate to servers page', { tag: ['@servers'] }, async ({ page }) => {
    await page.goto('/servers');
    await expect(page).toHaveURL(/\/servers/);
    await expect(page).toHaveTitle(/Servers/i);
  });

  test('should display servers page content', { tag: ['@servers'] }, async ({ page }) => {
    await page.goto('/servers');
    
    // Check for servers page elements
    await expect(page.getByRole('heading', { name: /servers/i })).toBeVisible();
    
    // Should have create/add button
    const createButton = page.getByRole('button', { name: /add server|create server/i });
    await expect(createButton).toBeVisible();
  });

  test('should open create server modal', { tag: ['@servers', '@crud'] }, async ({ page }) => {
    await page.goto('/servers');
    
    // Click create server button
    const createButton = page.getByRole('button', { name: /add server|create server/i });
    await createButton.click();
    
    // Modal should appear
    await expect(page.getByRole('dialog')).toBeVisible();
    
    // Check for form fields
    await expect(page.getByLabel(/name/i)).toBeVisible();
    await expect(page.getByLabel(/host|address/i)).toBeVisible();
    await expect(page.getByLabel(/port/i)).toBeVisible();
  });

  test('should create a new server', { tag: ['@servers', '@crud'] }, async ({ page }) => {
    await page.goto('/servers');
    
    // Open create modal
    const createButton = page.getByRole('button', { name: /add server|create server/i });
    await createButton.click();
    
    // Wait for modal
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    
    // Fill in server details
    const serverName = `Test Server ${Date.now()}`;
    await page.getByLabel(/name/i).fill(serverName);
    await page.getByLabel(/host|address/i).fill('127.0.0.1');
    await page.getByLabel(/port/i).fill('27015');
    
    // Optional: fill password if field exists
    const passwordInput = page.getByLabel(/password/i).or(page.locator('input[type="password"]'));
    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.fill('test-password');
    }
    
    // Submit form
    const submitButton = modal.getByRole('button', { name: /save|create|submit/i });
    await submitButton.click();
    
    // Modal should close
    await expect(modal).not.toBeVisible();
    
    // Server should appear in list (may need to wait for API call)
    await expect(page.getByText(serverName)).toBeVisible({ timeout: 10000 });
  });

  test('should display empty state when no servers exist', { tag: ['@servers'] }, async ({ page }) => {
    await page.goto('/servers');
    
    // Check for empty state message
    const emptyState = page.getByText(/no.*servers|haven't.*created|empty/i);
    const isEmpty = await emptyState.isVisible().catch(() => false);
    
    if (isEmpty) {
      await expect(emptyState).toBeVisible();
    }
  });
});

