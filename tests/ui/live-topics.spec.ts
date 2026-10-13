import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ensureSignedIn, signInAsPlayerViaRequest } from '../helpers/auth';

/**
 * Pages follow the server's page topics instead of polling (hooks/useTopic.ts,
 * api services/socketService emitTopic): a change shows within a moment, and
 * after the socket was gone (offline) the page re-reads what it missed.
 *
 * The matchmaking queue on /play for an admin (`matchmaking` topic) stands in
 * for every page that moved from a timer to a topic.
 *
 * @tag ui
 * @tag sockets
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const steamId = () => `7656119${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;

test.describe.serial('live page topics', () => {
  test(
    'a player searching shows on the admin queue at once, and after a reconnect',
    { tag: ['@ui'] },
    async ({ page }) => {
      await ensureSignedIn(page);
      await page.goto('/play');
      const panel = page.getByTestId('mm-admin-queue');
      await expect(panel).toBeVisible({ timeout: 15_000 });

      const searcher = async (name: string) => {
        const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
        expect(await signInAsPlayerViaRequest(ctx, steamId(), name, { games: ['cs2'] })).toBe(true);
        const res = await ctx.post('/api/matchmaking/queue', { data: { mode: '1v1' } });
        expect(res.ok(), await res.text()).toBe(true);
        return ctx;
      };

      // Live: no timer to wait for (it polled every 5 s before).
      const first = await searcher(`Live Topic ${Date.now() % 100000}`);
      const firstName = (await (await first.get('/api/matchmaking/me')).json()).party.people[0]
        .name as string;
      await expect(panel.getByText(firstName, { exact: false })).toBeVisible({ timeout: 2_500 });

      // Offline: the change is missed, and read once the socket is back.
      await page.context().setOffline(true);
      const second = await searcher(`Missed Topic ${Date.now() % 100000}`);
      const secondName = (await (await second.get('/api/matchmaking/me')).json()).party.people[0]
        .name as string;
      await page.context().setOffline(false);
      await expect(panel.getByText(secondName, { exact: false })).toBeVisible({ timeout: 15_000 });

      for (const ctx of [first, second]) {
        await ctx.delete('/api/matchmaking/queue', { data: {} });
        await ctx.post('/api/matchmaking/party/leave', { data: {} });
        await ctx.dispose();
      }
    }
  );
});
