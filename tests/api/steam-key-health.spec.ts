import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';

/**
 * The Steam Web API key is reported at startup.
 *
 * The health check has always been able to tell a missing key from a rejected
 * one from an unreachable Steam — but nothing ran it until something needed
 * Steam, so an operator who started the container with a bad key saw a clean
 * log. That cost a reporter a whole debugging session against a fake key.
 *
 * Startup logging itself cannot be asserted from here (the process is already
 * running). What this pins is the classification the startup message is built
 * from: if `errorType` stops distinguishing these cases, the log line silently
 * becomes useless.
 *
 * @tag api
 * @tag steam
 */
test.describe('Steam Web API key health', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
  });

  test(
    'reports a classified state the startup message can be built from',
    { tag: ['@api', '@steam'] },
    async ({ request }) => {
      const res = await request.get('/api/steam/status');
      expect(res.ok(), `steam status failed: ${await res.text()}`).toBe(true);

      const body = (await res.json()) as {
        configured?: boolean;
        valid?: boolean;
        errorType?: string;
      };

      // Either it is healthy, or it says which kind of unhealthy — never a
      // bare failure, which is what made this undiagnosable at startup.
      if (body.valid) {
        expect(body.configured).toBe(true);
        expect(body.errorType).toBeUndefined();
      } else {
        expect(
          ['not_configured', 'invalid_key', 'unreachable', 'unknown'],
          'an unclassified failure gives the startup log nothing useful to say'
        ).toContain(body.errorType);
      }
    }
  );
});
