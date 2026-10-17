import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import { signInAsPlayer, signInAsPlayerViaRequest, signInViaRequest } from '../helpers/auth';

/**
 * Matchmaking UI (phase 1c): one player in the browser finds a match with
 * nine more over the API. Find match → the queue bar → "Match found" →
 * Accept → the match room with both teams. Then the queue bar's Stop.
 *
 * @tag ui
 * @tag matchmaking
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3069';
const TAGS = { tag: ['@ui', '@matchmaking'] };

const steamId = () => `7656119${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;

test.describe.serial('matchmaking: Play page', () => {
  let admin: APIRequestContext;
  const others: APIRequestContext[] = [];

  test.beforeAll(async () => {
    admin = await playwrightRequest.newContext({ baseURL: BASE_URL });
    expect(await signInViaRequest(admin)).toBe(true);
    expect(
      (await admin.put('/api/matchmaking/admin/settings', { data: { openToPlayers: true } })).ok()
    ).toBe(true);
  });

  test.afterAll(async () => {
    for (const ctx of others) {
      await ctx.post('/api/matchmaking/party/leave', { data: {} }).catch(() => undefined);
      await ctx.dispose();
    }
    await admin.put('/api/matchmaking/admin/settings', { data: { openToPlayers: true } });
    await admin.dispose();
  });

  test('find a match, accept it, land in the match room', TAGS, async ({ page }) => {
    test.setTimeout(90_000);
    const me = steamId();
    expect(await signInAsPlayer(page, me, 'Browser Player', { games: ['cs2'] })).toBe(true);

    await page.goto('/play');
    await expect(page.getByTestId('nav-play')).toBeVisible();
    await page.getByTestId('mm-find').click();
    await expect(page.getByTestId('mm-queue-bar')).toBeVisible();

    // Nine more players search over the API.
    for (let i = 0; i < 9; i++) {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      others.push(ctx);
      expect(
        await signInAsPlayerViaRequest(ctx, steamId(), `Api Player ${i}`, { games: ['cs2'] })
      ).toBe(true);
      expect((await ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } })).ok()).toBe(true);
    }

    await expect(page.getByRole('dialog', { name: 'Match found' })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByTestId('mm-accept').click();
    await expect(page.getByTestId('mm-accept')).toHaveText('Waiting for the others');

    // The others accept.
    const lobbyId = await (async () => {
      const res = await others[0].get('/api/matchmaking/me');
      return ((await res.json()) as { lobby: { id: string } }).lobby.id;
    })();
    for (const ctx of others) {
      expect(
        (await ctx.post(`/api/matchmaking/lobbies/${lobbyId}/accept`, { data: {} })).ok()
      ).toBe(true);
    }

    await expect(page).toHaveURL(new RegExp(`/play/${lobbyId}$`), { timeout: 30_000 });
    // 5v5 votes its map: the veto board in the room. On our side's turn a click is our
    // vote, and our avatar shows on that map.
    await expect(page.getByTestId('mm-veto')).toBeVisible();
    await expect(page.getByTestId('veto-interface')).toBeVisible();
    if (await page.getByTestId('veto-your-turn').isVisible()) {
      await page.locator('[data-testid^="veto-map-button-"]').first().click();
      await expect(page.locator('[data-testid^="veto-votes-"][data-votes="1"]')).toHaveCount(1);
    }
    await expect(page.getByTestId('mm-team-1')).toBeVisible();
    await expect(page.getByTestId('mm-team-2')).toBeVisible();
    await expect(page.getByText('Browser Player')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Match found' })).toHaveCount(0);

    // End it so these players are free again.
    const room = (await (await page.request.get(`/api/matchmaking/lobbies/${lobbyId}`)).json())
      .lobby as { matchSlug: string };
    expect(
      (
        await admin.post('/api/test/series-result', {
          data: {
            slug: room.matchSlug,
            result: { winner: 'team1', team1Score: 1, team2Score: 0, games: [] },
          },
        })
      ).ok()
    ).toBe(true);
  });

  test(
    'with bots: one player finds a game alone, and the room has a Bots side',
    TAGS,
    async ({ page }) => {
      test.setTimeout(60_000);
      expect(await signInAsPlayer(page, steamId(), 'Bot Fill Player', { games: ['cs2'] })).toBe(
        true
      );
      await page.goto('/play');
      const toggle = page.getByRole('switch', { name: 'Fill empty seats with bots' });
      await expect(toggle).toBeVisible();
      await expect(
        page.getByText('Bots fill the empty seats · unrated: no rating, XP or drops')
      ).toBeVisible();
      await toggle.check();
      await page.getByTestId('mm-find').click();

      // Nobody else is needed.
      await expect(page.getByRole('dialog', { name: 'Match found' })).toBeVisible({
        timeout: 20_000,
      });
      await page.getByTestId('mm-accept').click();
      await expect(page).toHaveURL(/\/play\/[0-9a-f-]+$/, { timeout: 30_000 });
      await expect(page.getByText('Bot Fill Player')).toBeVisible();

      // End it so the player is free again.
      const lobby = (await (await page.request.get('/api/matchmaking/me')).json()).lobby as {
        id: string;
      };
      const room = (await (await page.request.get(`/api/matchmaking/lobbies/${lobby.id}`)).json())
        .lobby as {
        matchSlug: string;
      };
      const end = {
        slug: room.matchSlug,
        result: { winner: 'team1', team1Score: 1, team2Score: 0, games: [] },
      };
      expect((await admin.post('/api/test/series-result', { data: end })).ok()).toBe(true);
    }
  );

  test('the queue bar stops a search', TAGS, async ({ page }) => {
    expect(await signInAsPlayer(page, steamId(), 'Stopper', { games: ['cs2'] })).toBe(true);
    await page.goto('/play');
    await page.getByTestId('mm-find').click();
    await expect(page.getByTestId('mm-queue-bar')).toBeVisible();
    await page.getByTestId('mm-queue-cancel').click();
    await expect(page.getByTestId('mm-queue-bar')).toHaveCount(0);
    await expect(page.getByTestId('mm-find')).toBeEnabled();
  });
});
