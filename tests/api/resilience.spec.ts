import { test, expect } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';

/**
 * API resilience
 *
 * Node treats an unhandled promise rejection as fatal. The API registered no
 * `unhandledRejection` handler, so a single stray rejection in a background
 * task killed the whole process — Caddy then served 502 for every request
 * until Docker restarted the container.
 *
 * This was not theoretical. Resetting the database while requests were in
 * flight made a settings read reject with `relation "app_settings" does not
 * exist`, and the process died on the first attempt, every time.
 *
 * The assertion below leans on `/health`'s uptime rather than on it merely
 * answering: the container restarts within a few seconds, so "the API
 * responds afterwards" would pass even with the bug present.
 *
 * @tag api
 * @tag resilience
 */

async function uptime(request: import('@playwright/test').APIRequestContext): Promise<number> {
  const response = await request.get('/health', { timeout: 15000 });
  expect(response.ok(), '/health should answer').toBe(true);
  const body = await response.json();
  expect(typeof body.uptime, '/health should report uptime').toBe('number');
  return body.uptime as number;
}

test.describe.serial('API resilience', () => {
  test(
    'should survive a rejected background query instead of dying',
    { tag: ['@api', '@resilience'] },
    async ({ request }) => {
      await signInViaRequest(request);

      const before = await uptime(request);

      // Drop the schema out from under a burst of in-flight reads. Each read
      // that lands mid-reset rejects inside a background path with no catch,
      // which is precisely what used to be fatal.
      for (let round = 0; round < 3; round++) {
        const inFlight = Array.from({ length: 25 }, () =>
          request
            .get('/api/settings', { headers: getAuthHeader(), timeout: 20000 })
            .catch(() => null)
        );
        await request.post('/api/test/reset-database', {
          headers: getAuthHeader(),
          timeout: 30000,
        });
        await Promise.all(inFlight);
      }

      // Uptime going backwards means the process died and came back.
      const after = await uptime(request);
      expect(
        after,
        `API restarted during the run (uptime ${before}s -> ${after}s), so a ` +
          'rejected background query is still fatal'
      ).toBeGreaterThanOrEqual(before);
    }
  );
});
