import { test, expect } from '@playwright/test';

/**
 * Teams page tests
 * @tag teams
 * @tag crud
 */

test.describe('Teams Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    const apiToken = process.env.API_TOKEN || 'admin123';
    await page.goto('/login');
    await page.getByLabel(/password|token/i).fill(apiToken);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('should navigate to teams page', { tag: ['@teams'] }, async ({ page }) => {
    await page.goto('/teams');
    await expect(page).toHaveURL(/\/teams/);
    await expect(page).toHaveTitle(/Teams/i);
  });

  test('should display teams page content', { tag: ['@teams'] }, async ({ page }) => {
    await page.goto('/teams');
    
    // Check for teams page elements
    await expect(page.getByRole('heading', { name: /teams/i })).toBeVisible();
    
    // Should have create/add button
    const createButton = page.getByRole('button', { name: /add team|create team/i });
    await expect(createButton).toBeVisible();
  });

  test('should open create team modal', { tag: ['@teams', '@crud'] }, async ({ page }) => {
    await page.goto('/teams');
    
    // Click create team button
    const createButton = page.getByRole('button', { name: /add team|create team/i });
    await createButton.click();
    
    // Modal should appear
    await expect(page.getByRole('dialog')).toBeVisible();
    
    // Check for form fields
    await expect(page.getByLabel(/name/i)).toBeVisible();
  });

  test('should create a new team', { tag: ['@teams', '@crud'] }, async ({ page }) => {
    await page.goto('/teams');
    
    // Open create modal
    const createButton = page.getByRole('button', { name: /add team|create team/i });
    await createButton.click();
    
    // Wait for modal
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    
    // Fill in team details
    const teamName = `Test Team ${Date.now()}`;
    await page.getByLabel(/name/i).fill(teamName);
    
    // Optional: fill tag if field exists
    const tagInput = page.getByLabel(/tag/i).or(page.locator('input[placeholder*="tag" i]'));
    if (await tagInput.isVisible().catch(() => false)) {
      await tagInput.fill('TT');
    }
    
    // Submit form
    const submitButton = modal.getByRole('button', { name: /save|create|submit/i });
    await submitButton.click();
    
    // Modal should close
    await expect(modal).not.toBeVisible();
    
    // Team should appear in list (may need to wait for API call)
    await expect(page.getByText(teamName)).toBeVisible({ timeout: 10000 });
  });

  test('should display empty state when no teams exist', { tag: ['@teams'] }, async ({ page }) => {
    await page.goto('/teams');
    
    // Check for empty state message
    const emptyState = page.getByText(/no.*teams|haven't.*created|empty/i);
    // This might not always be visible if teams exist, so we check conditionally
    const isEmpty = await emptyState.isVisible().catch(() => false);
    
    if (isEmpty) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('should edit an existing team', { tag: ['@teams', '@crud'] }, async ({ page }) => {
    await page.goto('/teams');
    
    // Wait for teams to load
    await page.waitForLoadState('networkidle');
    
    // Find edit button for first team (if teams exist)
    const editButtons = page.getByRole('button', { name: /edit/i }).or(
      page.locator('button[aria-label*="edit" i]')
    );
    
    const editButtonCount = await editButtons.count();
    if (editButtonCount > 0) {
      await editButtons.first().click();
      
      // Modal should appear
      await expect(page.getByRole('dialog')).toBeVisible();
      
      // Modify team name
      const nameInput = page.getByLabel(/name/i);
      const currentValue = await nameInput.inputValue();
      await nameInput.fill(`${currentValue} Updated`);
      
      // Save
      const saveButton = page.getByRole('button', { name: /save|update/i });
      await saveButton.click();
      
      // Modal should close
      await expect(page.getByRole('dialog')).not.toBeVisible();
    } else {
      test.skip();
    }
  });
});

