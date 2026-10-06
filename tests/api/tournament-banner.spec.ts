import { test, expect, request as playwrightRequest } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { createTournament } from '../helpers/tournaments';
import { createTestTeams } from '../helpers/teams';

/**
 * The tournament page's banner: an admin uploads one wide image, the public
 * page reads it from `bannerUrl`. The bytes live in their own table; the
 * tournament carries only the versioned URL.
 *
 * @tag api
 * @tag tournament
 * @tag public
 */

/** The smallest valid PNG: a 1×1 transparent pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('Tournament banner API', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
  });

  test(
    'stores a banner, serves it publicly and removes it',
    { tag: ['@api', '@tournament', '@public'] },
    async ({ request }) => {
      const teams = await createTestTeams(request, 'banner');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;
      const tournament = await createTournament(request, {
        name: `Banner ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [team1.id, team2.id],
      });
      expect(tournament).toBeTruthy();
      const id = tournament!.id;

      const put = await request.put('/api/tournament/banner', {
        headers: { ...getAuthHeader(), 'Content-Type': 'image/png' },
        data: PNG,
      });
      expect(put.ok()).toBe(true);
      const { bannerUrl } = await put.json();
      expect(bannerUrl).toMatch(new RegExp(`^/api/tournament/${id}/banner\\?v=\\d+$`));

      // The public page reads it from the tournament, with no session.
      const board = await request.get(`/api/tournament/${id}/leaderboard`);
      expect((await board.json()).tournament.bannerUrl).toBe(bannerUrl);
      const image = await request.get(bannerUrl);
      expect(image.status()).toBe(200);
      expect(image.headers()['content-type']).toBe('image/png');
      expect(Buffer.compare(await image.body(), PNG)).toBe(0);

      const removed = await request.delete('/api/tournament/banner', { headers: getAuthHeader() });
      expect((await removed.json()).bannerUrl).toBeNull();
      expect((await request.get(`/api/tournament/${id}/banner`)).status()).toBe(404);
    }
  );

  test(
    'refuses a file that is not an image, and an upload without a session',
    { tag: ['@api', '@tournament'] },
    async ({ request, baseURL }) => {
      const teams = await createTestTeams(request, 'banner-bad');
      expect(teams).toBeTruthy();
      const [team1, team2] = teams!;
      await createTournament(request, {
        name: `Banner Bad ${Date.now()}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_mirage', 'de_inferno'],
        teamIds: [team1.id, team2.id],
      });

      const notAnImage = await request.put('/api/tournament/banner', {
        headers: { ...getAuthHeader(), 'Content-Type': 'image/png' },
        data: Buffer.from('this is not a png'),
      });
      expect(notAnImage.status()).toBe(415);

      const signedOut = await playwrightRequest.newContext({ baseURL });
      const anonymous = await signedOut.put('/api/tournament/banner', {
        headers: { 'Content-Type': 'image/png' },
        data: PNG,
      });
      expect(anonymous.status()).toBe(401);
      await signedOut.dispose();
    }
  );
});
