import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  ensureSignedIn,
  getAuthHeader,
  signInAsPlayer,
  signInViaRequest,
} from '../helpers/auth';
import { createPlayer } from '../helpers/players';

/**
 * Player Discord ID UI tests
 *
 * A player's Discord ID (a 17–20 digit string) is contact data for organizers.
 * It is never shown publicly. Admins set it in the player editor; a signed-in
 * player sets their own on their profile page, and nobody else's.
 *
 * @tag ui
 * @tag players
 * @tag discord
 */

/** A unique, valid 18-digit Discord snowflake. */
function uniqueDiscordId(offset = 0): string {
  return `20000${Date.now() + offset}`;
}

/** A unique 17-digit Steam ID64 in the test range. */
function uniqueSteamId(offset = 0): string {
  return `7656119${String((Date.now() + offset) % 1e10).padStart(10, '0')}`;
}

async function getDiscordId(request: APIRequestContext, steamId: string) {
  const response = await request.get('/api/players', { headers: getAuthHeader() });
  expect(response.ok(), 'GET /api/players should succeed').toBe(true);
  const body = (await response.json()) as {
    players: Array<{ id: string; discordId: string | null }>;
  };
  return body.players.find((p) => p.id === steamId)?.discordId ?? null;
}

test.describe.serial('Player Discord ID: admin editor', () => {
  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    await signInViaRequest(request);
  });

  test(
    'admin sets a Discord ID in the player editor and the card marker goes away',
    { tag: ['@ui', '@players', '@discord', '@crud'] },
    async ({ page, request }) => {
      const steamId = uniqueSteamId(10);
      const discordId = uniqueDiscordId(10);
      const player = await createPlayer(request, { id: steamId, name: 'Discord Admin Edit' });
      expect(player, 'seed player should be created').toBeTruthy();

      await page.goto('/players');
      const card = page.getByTestId(`player-card-${steamId}`);
      await expect(card).toBeVisible();
      await expect(page.getByTestId(`player-card-no-discord-${steamId}`)).toBeVisible();

      await card.click();
      const modal = page.getByTestId('player-modal');
      await expect(modal).toBeVisible();

      const input = page.getByTestId('player-discord-id-input');
      await expect(input).toHaveValue('');

      // An invalid value blocks the save.
      await input.fill('12345');
      await expect(page.getByTestId('player-save-button')).toBeDisabled();

      await input.fill(discordId);
      await expect(page.getByTestId('player-save-button')).toBeEnabled();

      const [updateResponse] = await Promise.all([
        page.waitForResponse(
          (resp) =>
            resp.url().includes(`/api/players/${steamId}`) && resp.request().method() === 'PUT'
        ),
        page.getByTestId('player-save-button').click(),
      ]);
      expect(updateResponse.ok(), 'PUT /api/players/:id should succeed').toBe(true);
      expect(updateResponse.request().postDataJSON()).toMatchObject({ discordId });
      await expect(modal).not.toBeVisible();

      expect(await getDiscordId(request, steamId)).toBe(discordId);
      await expect(page.getByTestId(`player-card-no-discord-${steamId}`)).toHaveCount(0);

      // Reopen: the saved value is pre-filled.
      await page.getByTestId(`player-card-${steamId}`).click();
      await expect(modal).toBeVisible();
      await expect(page.getByTestId('player-discord-id-input')).toHaveValue(discordId);
    }
  );

  test(
    'a name-only save from a stale list keeps a Discord ID set meanwhile',
    { tag: ['@ui', '@players', '@discord', '@crud'] },
    async ({ page, request }) => {
      const steamId = uniqueSteamId(30);
      const discordId = uniqueDiscordId(30);
      const player = await createPlayer(request, { id: steamId, name: 'Discord Stale Edit' });
      expect(player, 'seed player should be created').toBeTruthy();

      await page.goto('/players');
      const card = page.getByTestId(`player-card-${steamId}`);
      await expect(card).toBeVisible();

      // Set after the list loaded, standing in for the player saving their own
      // ID on their profile: the page still holds "no Discord ID".
      const seed = await request.put(`/api/players/${steamId}`, {
        headers: getAuthHeader(),
        data: { discordId },
      });
      expect(seed.ok(), 'seeding the Discord ID should succeed').toBe(true);

      await card.click();
      const modal = page.getByTestId('player-modal');
      await expect(modal).toBeVisible();
      await expect(page.getByTestId('player-discord-id-input')).toHaveValue('');

      await page.getByTestId('player-name-input').fill('Discord Stale Renamed');
      const [updateResponse] = await Promise.all([
        page.waitForResponse(
          (resp) =>
            resp.url().includes(`/api/players/${steamId}`) && resp.request().method() === 'PUT'
        ),
        page.getByTestId('player-save-button').click(),
      ]);
      expect(updateResponse.ok(), 'PUT /api/players/:id should succeed').toBe(true);
      const sent = updateResponse.request().postDataJSON() as Record<string, unknown>;
      expect(sent.name).toBe('Discord Stale Renamed');
      expect('discordId' in sent, 'an untouched Discord ID field must not be sent').toBe(false);
      await expect(modal).not.toBeVisible();

      expect(await getDiscordId(request, steamId)).toBe(discordId);
    }
  );
});

test.describe.serial('Player Discord ID: self-service on the profile page', () => {
  const ownSteamId = uniqueSteamId(20);
  const otherSteamId = uniqueSteamId(21);

  test.beforeEach(async ({ request }) => {
    // Seed both players as admin on the standalone request context (createPlayer
    // tolerates an existing row); the browser page is signed in as a normal
    // player only.
    expect(await signInViaRequest(request), 'admin sign-in should succeed').toBe(true);
    expect(await createPlayer(request, { id: ownSteamId, name: 'Discord Self' })).toBeTruthy();
    expect(await createPlayer(request, { id: otherSteamId, name: 'Discord Other' })).toBeTruthy();
  });

  test(
    'a player sets their own Discord ID from their profile',
    { tag: ['@ui', '@players', '@discord'] },
    async ({ page, request }) => {
      const discordId = uniqueDiscordId(20);
      expect(await signInAsPlayer(page, ownSteamId), 'player sign-in should succeed').toBe(true);

      await page.goto(`/player/${ownSteamId}`);
      await expect(page.getByTestId('public-player-page')).toBeVisible();

      const section = page.getByTestId('profile-discord-id-section');
      await expect(section).toBeVisible();

      const input = page.getByTestId('profile-discord-id-input');
      const save = page.getByTestId('profile-discord-id-save');
      await expect(input).toHaveValue('');

      await input.fill('not-a-snowflake');
      await expect(save).toBeDisabled();

      await input.fill(discordId);
      const [saveResponse] = await Promise.all([
        page.waitForResponse(
          (resp) =>
            resp.url().includes('/api/players/me/discord-id') && resp.request().method() === 'PUT'
        ),
        save.click(),
      ]);
      expect(saveResponse.ok(), 'PUT /api/players/me/discord-id should succeed').toBe(true);

      await page.reload();
      await expect(page.getByTestId('profile-discord-id-section')).toBeVisible();
      await expect(page.getByTestId('profile-discord-id-input')).toHaveValue(discordId);

      expect(await getDiscordId(request, ownSteamId)).toBe(discordId);
    }
  );

  test(
    "a player does not see the section on another player's profile",
    { tag: ['@ui', '@players', '@discord', '@permissions'] },
    async ({ page }) => {
      expect(await signInAsPlayer(page, ownSteamId), 'player sign-in should succeed').toBe(true);

      const selfServiceCalls: string[] = [];
      page.on('request', (req) => {
        if (req.url().includes('/api/players/me/discord-id')) {
          selfServiceCalls.push(`${req.method()} ${req.url()}`);
        }
      });

      await page.goto(`/player/${otherSteamId}`);
      await expect(page.getByTestId('public-player-page')).toBeVisible();
      await expect(page.getByTestId('public-player-name')).toBeVisible();
      await page.waitForLoadState('networkidle');

      await expect(page.getByTestId('profile-discord-id-section')).toHaveCount(0);
      expect(selfServiceCalls, 'the self-service endpoint must not be called').toEqual([]);
    }
  );
});
