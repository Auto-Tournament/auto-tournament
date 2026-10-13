import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';

/**
 * The admin match page's API (api/src/integrations/cs2/routes/manageMatch.ts):
 * one read for the page, and Ready Up commands that are logged with who sent them.
 */
test.describe.serial('Manage a match', () => {
  let slug = '';

  test.beforeEach(async ({ page, request }) => {
    if (slug) return;
    await setupTestContext(page, request);
    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: [
        'de_mirage',
        'de_inferno',
        'de_ancient',
        'de_anubis',
        'de_dust2',
        'de_vertigo',
        'de_nuke',
      ],
      teamCount: 2,
      serverCount: 1,
      prefix: 'manage-match',
    });
    expect(setup).toBeTruthy();
    const match = await findMatchByTeams(request, setup!.teams[0].id, setup!.teams[1].id);
    slug = match!.slug;
  });

  test(
    'admins read the match, its server and its log',
    { tag: ['@api', '@manage'] },
    async ({ request }) => {
      const res = await request.get(`/api/game/cs2/matches/${slug}/manage`, {
        headers: getAuthHeader(),
      });
      expect(res.ok(), await res.text()).toBe(true);
      const body = await res.json();
      expect(body.match.slug).toBe(slug);
      expect(Array.isArray(body.log)).toBe(true);
    }
  );

  test(
    'only admins, and only the commands the page has',
    { tag: ['@api', '@manage'] },
    async ({ playwright, request }) => {
      expect(await signInViaRequest(request)).toBe(true);
      const anon = await playwright.request.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069',
      });
      expect((await anon.get(`/api/game/cs2/matches/${slug}/manage`)).status()).toBe(401);
      await anon.dispose();

      const bad = await request.post(`/api/game/cs2/matches/${slug}/manage/command`, {
        headers: getAuthHeader(),
        data: { name: 'plugins.set', args: {} },
      });
      expect(bad.status()).toBe(400);

      // The test server is not a Ready Up fleet server: refused, not sent.
      const notFleet = await request.post(`/api/game/cs2/matches/${slug}/manage/command`, {
        headers: getAuthHeader(),
        data: { name: 'pause', args: { type: 'admin' } },
      });
      expect(notFleet.status()).toBe(409);

      expect(
        (
          await request.get('/api/game/cs2/matches/no-such-match/manage', {
            headers: getAuthHeader(),
          })
        ).status()
      ).toBe(404);
    }
  );
});
