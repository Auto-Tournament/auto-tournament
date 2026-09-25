import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * "Restart now" (`/api/system/restart`): admin-only, same-site JSON, never a
 * read-only token. Where nothing brings the process back (CI sets
 * `AT_RESTART_SUPERVISED=false`; a dev server is not in the image) it
 * answers 409 and does not exit. The spec never sends the one request that
 * would restart a supervised server.
 *
 * @tag api
 * @tag modules
 */

const READONLY_TOKEN = (process.env.API_TOKENS_READONLY || 'ci-readonly:ci-readonly-token-0123456789abcdef')
  .split(/[\s,;]+/)[0]
  .split(':')
  .slice(1)
  .join(':');

const json = { 'Content-Type': 'application/json' };

test.describe('System restart', () => {
  test('refuses strangers, read-only tokens and cross-site requests', async ({ request, playwright, baseURL }) => {
    const stranger = await playwright.request.newContext({ baseURL });
    try {
      expect((await stranger.get('/api/system/restart')).status()).toBe(401);
      expect((await stranger.post('/api/system/restart', { data: {}, headers: json })).status()).toBe(401);
      const readOnly = await stranger.post('/api/system/restart', {
        data: {},
        headers: { ...json, Authorization: `Bearer ${READONLY_TOKEN}` },
      });
      expect(readOnly.status()).toBe(403);
    } finally {
      await stranger.dispose();
    }

    expect(await signInViaRequest(request)).toBe(true);
    const crossSite = await request.post('/api/system/restart', {
      data: {},
      headers: { ...json, Origin: 'https://evil.example' },
    });
    expect(crossSite.status()).toBe(403);
  });

  test('without a supervisor it says so and stays up', async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
    const support = (await (await request.get('/api/system/restart')).json()) as { supported: boolean; reason: string | null };
    // A supervised server would really restart: never ask one.
    test.skip(support.supported, 'This server is supervised; the spec does not restart it');
    expect(support.reason).toMatch(/Restart Auto Tournament yourself/);

    const before = ((await (await request.get('/health')).json()) as { uptime: number }).uptime;
    const response = await request.post('/api/system/restart', { data: {}, headers: json });
    const text = await response.text();
    expect(response.status(), text).toBe(409);
    expect(JSON.parse(text)).toMatchObject({ code: 'unsupervised', error: expect.stringMatching(/yourself/) });

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = ((await (await request.get('/health')).json()) as { uptime: number }).uptime;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
