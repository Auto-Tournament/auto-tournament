import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * The demo worker's routes (api/src/integrations/cs2/routes/demoAnalysis.ts).
 * The worker itself (worker/, Go) has its own unit tests; this pins the
 * platform side: who may claim, and what a map without an analysis answers.
 */
test.describe('Demo worker routes', () => {
  test(
    'claiming needs a signed-in admin or an API token',
    { tag: ['@api'] },
    async ({ playwright, baseURL }) => {
      const anonymous = await playwright.request.newContext({ baseURL });
      const res = await anonymous.post('/api/game/cs2/demo-worker/claim', {
        data: { worker: 'spec' },
      });
      expect(res.status()).toBe(401);
      await anonymous.dispose();
    }
  );

  test(
    'an admin can claim; with nothing to read the answer is 204 or a job',
    { tag: ['@api'] },
    async ({ request }) => {
      await signInViaRequest(request);
      const res = await request.post('/api/game/cs2/demo-worker/claim', {
        data: { worker: 'spec' },
      });
      expect([200, 204]).toContain(res.status());
      if (res.status() === 200) {
        const body = await res.json();
        expect(typeof body.job.matchSlug).toBe('string');
        expect(Number.isInteger(body.job.mapNumber)).toBe(true);
        // Hand it back so a real worker run is not left waiting on this one.
        await request.post(
          `/api/game/cs2/demo-worker/jobs/${encodeURIComponent(body.job.matchSlug)}/${body.job.mapNumber}/fail`,
          { data: { worker: 'spec', error: 'released by the spec' } }
        );
      }
    }
  );

  test(
    'a map without an analysis or replay answers 404',
    { tag: ['@api'] },
    async ({ request }) => {
      const analysis = await request.get('/api/game/cs2/matches/no-such-match/maps/0/analysis');
      expect(analysis.status()).toBe(404);
      const replay = await request.get('/api/game/cs2/matches/no-such-match/maps/0/replay');
      expect(replay.status()).toBe(404);
    }
  );

  test('a result needs an analysis', { tag: ['@api'] }, async ({ request }) => {
    await signInViaRequest(request);
    const res = await request.post('/api/game/cs2/demo-worker/jobs/no-such-match/0/result', {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});
