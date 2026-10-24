import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Links in emails start from the configured site address (Settings -> Email,
 * else FRONTEND_BASE_URL), never from the request's own Origin or Host.
 * Without one, the confirmation email is refused with a clear error.
 *
 * Needs an API started without FRONTEND_BASE_URL.
 *
 * @tag api
 * @tag auth
 * @tag security
 */

const TAGS = { tag: ['@api', '@auth', '@security'] };

test.describe.serial('email link base', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test.afterEach(async ({ request }) => {
    await request.put('/api/email-settings', { data: { enabled: false } });
  });

  test('no site address: the confirmation email is refused', TAGS, async ({ request }) => {
    const settings = await request.get('/api/email-settings');
    const { settings: current } = (await settings.json()) as {
      settings: { defaultSiteUrl: string };
    };
    test.skip(!!current.defaultSiteUrl, 'the API has FRONTEND_BASE_URL set');

    const saved = await request.put('/api/email-settings', {
      data: {
        enabled: true,
        host: 'smtp.example.invalid',
        port: 587,
        security: 'starttls',
        fromAddress: 'noreply@example.invalid',
        siteUrl: '',
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    const add = await request.put('/api/me/email', { data: { email: 'admin@example.invalid' } });
    expect(add.status(), await add.text()).toBe(409);
    expect(((await add.json()) as { code?: string }).code).toBe('noSiteUrl');
  });
});
