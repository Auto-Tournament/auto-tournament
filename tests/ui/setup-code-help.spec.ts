import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The setup page says where the setup code is: the docker command, and
 * where to look in a container panel (Dockhand, Portainer). Nobody should
 * need to know it is in the log.
 *
 * @tag ui
 */
test(
  'the setup page says where to find the code',
  { tag: ['@ui'] },
  async ({ browser, baseURL, request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const issued = await request.post('/api/test/setup-code', { data: { purpose: 'reset' } });
    expect(issued.ok(), await issued.text()).toBe(true);
    const visitor = await browser.newContext({ baseURL });
    try {
      const page = await visitor.newPage();
      await page.goto('/setup');
      const where = page.getByTestId('setup-code-where');
      await expect(where).toBeVisible({ timeout: 15000 });
      await where.locator('summary').click();
      // An install with an admin opens /setup for a reset: reset-admin prints that code.
      await expect(where).toContainText('docker exec auto-tournament reset-admin');
      await expect(where).toContainText('Dockhand');
    } finally {
      await visitor.close();
      await request.post('/api/test/setup-code/expire');
    }
  }
);
