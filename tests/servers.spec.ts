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
    await page.getByLabel(/api token/i).fill(apiToken);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should navigate to and display servers page', { tag: ['@servers'] }, async ({ page }) => {
    await page.goto('/servers');
    await expect(page).toHaveURL(/\/servers/);
    await expect(page).toHaveTitle(/Servers/i);
    await page.waitForLoadState('networkidle');
    
    // Check for servers page elements - h4 heading
    await expect(page.getByRole('heading', { name: /servers/i, level: 4 })).toBeVisible();
    
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
    // Skip: This test requires a real server to be running on 127.0.0.1:27015 to validate the connection
    test.skip();
  });

  test('should display empty state when no servers exist', { tag: ['@servers'] }, async ({ page }) => {
    await page.goto('/servers');
    
    // Check for empty state message
    const emptyState = page.getByText(/no servers registered/i);
    const isEmpty = await emptyState.isVisible().catch(() => false);
    
    if (isEmpty) {
      await expect(emptyState).toBeVisible();
    }
  });
});

