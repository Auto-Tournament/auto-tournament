import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
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
    expect((await admin.put('/api/experimental/matchmaking', { data: { enabled: true } })).ok()).toBe(true);
    expect((await admin.put('/api/matchmaking/admin/settings', { data: { openToPlayers: true } })).ok()).toBe(true);
  });

  test.afterAll(async () => {
    for (const ctx of others) {
      await ctx.post('/api/matchmaking/party/leave', { data: {} }).catch(() => undefined);
      await ctx.dispose();
    }
    await admin.put('/api/matchmaking/admin/settings', { data: { openToPlayers: false } });
    await admin.put('/api/experimental/matchmaking', { data: { enabled: false } });
    await admin.dispose();
  });

  test('find a match, accept it, land in the match room', TAGS, async ({ page }) => {
    test.setTimeout(90_000);
    const me = steamId();
    expect(await signInAsPlayer(page, me, 'Browser Player')).toBe(true);

    await page.goto('/play');
    await expect(page.getByTestId('nav-play')).toBeVisible();
    await page.getByTestId('mm-find').click();
    await expect(page.getByTestId('mm-queue-bar')).toBeVisible();

    // Nine more players search over the API.
    for (let i = 0; i < 9; i++) {
      const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
      others.push(ctx);
      expect(await signInAsPlayerViaRequest(ctx, steamId(), `Api Player ${i}`)).toBe(true);
      expect((await ctx.post('/api/matchmaking/queue', { data: { mode: '5v5' } })).ok()).toBe(true);
    }

    await expect(page.getByRole('dialog', { name: 'Match found' })).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('mm-accept').click();
    await expect(page.getByTestId('mm-accept')).toHaveText('Waiting for the others');

    // The others accept.
    const lobbyId = await (async () => {
      const res = await others[0].get('/api/matchmaking/me');
      return ((await res.json()) as { lobby: { id: string } }).lobby.id;
    })();
    for (const ctx of others) {
      expect((await ctx.post(`/api/matchmaking/lobbies/${lobbyId}/accept`, { data: {} })).ok()).toBe(true);
    }

    await expect(page).toHaveURL(new RegExp(`/play/${lobbyId}$`), { timeout: 30_000 });
    // The map roulette rolls, then stops on the match's map.
    await expect(page.getByTestId('mm-roulette')).toBeVisible();
    await expect(page.getByTestId('mm-roulette-picked')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^Map: /)).toBeVisible();
    await expect(page.getByTestId('mm-team-1')).toBeVisible();
    await expect(page.getByTestId('mm-team-2')).toBeVisible();
    await expect(page.getByText('Browser Player')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Match found' })).toHaveCount(0);
  });

  test('the queue bar stops a search', TAGS, async ({ page }) => {
    expect(await signInAsPlayer(page, steamId(), 'Stopper')).toBe(true);
    await page.goto('/play');
    await page.getByTestId('mm-find').click();
    await expect(page.getByTestId('mm-queue-bar')).toBeVisible();
    await page.getByTestId('mm-queue-cancel').click();
    await expect(page.getByTestId('mm-queue-bar')).toHaveCount(0);
    await expect(page.getByTestId('mm-find')).toBeEnabled();
  });
});
