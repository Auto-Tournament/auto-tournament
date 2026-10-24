import { test, expect } from '@playwright/test';

/**
 * A Cookie header with a malformed %-escape is answered, not thrown on.
 *
 * @tag api
 * @tag auth
 */

test.describe('Malformed Cookie header', () => {
  test(
    'is answered and leaves the API running',
    { tag: ['@api', '@auth'] },
    async ({ playwright }) => {
      const request = await playwright.request.newContext({
        baseURL: test.info().project.use.baseURL,
        extraHTTPHeaders: { Cookie: 'x=%E0' },
      });
      try {
        expect((await request.get('/api/auth/me')).status()).toBeLessThan(500);
        expect((await request.get('/api/auth/impersonate')).status()).toBe(401);
        expect((await request.get('/health')).ok()).toBe(true);
      } finally {
        await request.dispose();
      }
    }
  );
});
