import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { setupTestContext, configureWebhook } from '../helpers/setup';
import { getAuthHeader } from '../helpers/auth';
import { createTeam } from '../helpers/teams';

/**
 * Team Discord ID UI tests
 *
 * A Discord ID (a 17–20 digit string) is contact data on the PLAYER record, not
 * on the roster. NTLAN team exports can carry one per player. Covers:
 * - the JSON import preview: IDs shown, players without one marked, invalid
 *   IDs dropped with a warning, and the ID reaching the player record
 * - the team editor: a changed ID is saved as an explicit player edit (so it
 *   overwrites), and the team payload itself carries no Discord IDs
 *
 * @tag ui
 * @tag teams
 * @tag discord
 */

/** The page slugifies team names for its card test ids. */
function teamCardId(name: string): string {
  return `team-card-${name.toLowerCase().replace(/\s+/g, '-')}`;
}

/** Mirrors the id Teams.tsx derives from an imported team's name. */
function importedTeamId(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '_');
}

/** A unique, valid 18-digit Discord snowflake. */
function uniqueDiscordId(offset = 0): string {
  return `10000${Date.now() + offset}`;
}

/** A unique 17-digit Steam ID64 in the test range. */
function uniqueSteamId(offset = 0): string {
  return `7656119${String((Date.now() + offset) % 1e10).padStart(10, '0')}`;
}

/** Discord IDs by Steam ID, from the admin player list. */
async function discordIdsByPlayer(
  request: APIRequestContext
): Promise<Map<string, string | null>> {
  const response = await request.get('/api/players', { headers: getAuthHeader() });
  expect(response.ok(), 'GET /api/players should succeed').toBe(true);
  const body = (await response.json()) as {
    players: Array<{ id: string; discordId: string | null }>;
  };
  return new Map(body.players.map((p) => [p.id, p.discordId]));
}

async function getTeam(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/teams/${encodeURIComponent(id)}`, {
    headers: getAuthHeader(),
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).team as {
    id: string;
    players: Array<{ steamId: string; name: string; discordId: string | null }>;
  };
}

async function deleteTeam(request: APIRequestContext, id: string) {
  await request.delete(`/api/teams/${encodeURIComponent(id)}`, { headers: getAuthHeader() });
}

async function openImportModal(page: Page) {
  await page
    .getByTestId('import-teams-button')
    .or(page.getByTestId('import-teams-empty-button'))
    .first()
    .click();
  await expect(page.getByTestId('team-import-json-input')).toBeVisible();
}

test.describe.serial('Team Discord IDs UI', () => {
  test.beforeEach(async ({ page, request }) => {
    const context = await setupTestContext(page, request);
    // A missing webhook URL raises a banner that can sit over the page actions.
    await configureWebhook(request, context.baseUrl);
  });

  test(
    'import preview shows Discord IDs, marks players without one, and fills the player record',
    { tag: ['@ui', '@teams', '@discord'] },
    async ({ page, request }) => {
      const teamName = `Discord Import ${Date.now()}`;
      const withDiscord = { steamId: uniqueSteamId(1), discordId: uniqueDiscordId(1) };
      const withoutDiscord = { steamId: uniqueSteamId(2) };

      const json = JSON.stringify([
        {
          name: teamName,
          tag: 'DIS',
          players: [
            { name: 'Has Discord', steamId: withDiscord.steamId, discordId: withDiscord.discordId },
            // Key omitted entirely, as NTLAN does for players without Discord.
            { name: 'No Discord', steamId: withoutDiscord.steamId },
          ],
        },
      ]);

      await page.goto('/teams');
      await expect(page.getByTestId('teams-page')).toBeVisible();
      await openImportModal(page);

      await page.getByTestId('team-import-json-input').fill(json);
      await page.getByTestId('team-import-preview-button').click();

      // Valid input: no warnings, one player counted as missing Discord.
      await expect(page.getByTestId('team-import-warnings')).toHaveCount(0);
      await expect(page.getByTestId('team-import-missing-discord-total')).toContainText('1');
      await expect(page.getByTestId('team-import-missing-discord-0')).toContainText('1');

      // Players are listed once the team row is expanded.
      await page.getByTestId('team-import-preview-team-0').click();
      await expect(
        page.getByTestId(`team-import-player-discord-${withDiscord.steamId}`)
      ).toContainText(withDiscord.discordId);
      await expect(
        page.getByTestId(`team-import-player-no-discord-${withDiscord.steamId}`)
      ).toHaveCount(0);
      await expect(
        page.getByTestId(`team-import-player-no-discord-${withoutDiscord.steamId}`)
      ).toBeVisible();
      await expect(
        page.getByTestId(`team-import-player-discord-${withoutDiscord.steamId}`)
      ).toHaveCount(0);

      await page.getByTestId('team-import-submit-button').click();
      await expect(page.getByTestId('team-import-json-input')).toHaveCount(0);
      await expect(page.getByTestId(teamCardId(teamName))).toBeVisible();

      // The ID landed on the player record (as a string), and the other player has none.
      const ids = await discordIdsByPlayer(request);
      expect(ids.get(withDiscord.steamId)).toBe(withDiscord.discordId);
      expect(ids.get(withoutDiscord.steamId) ?? null).toBeNull();

      // The admin team GET reports it from the player record too.
      const teamId = importedTeamId(teamName);
      const team = await getTeam(request, teamId);
      const roster = new Map(team.players.map((p) => [p.steamId, p]));
      expect(roster.get(withDiscord.steamId)?.discordId).toBe(withDiscord.discordId);
      expect(roster.get(withoutDiscord.steamId)?.discordId ?? null).toBeNull();

      await deleteTeam(request, teamId);
    }
  );

  test(
    'import preview drops a numeric discordId with a warning and still imports',
    { tag: ['@ui', '@teams', '@discord'] },
    async ({ page, request }) => {
      const steamId = uniqueSteamId(3);
      const teamName = `Numeric Discord ${Date.now()}`;
      // A bare number: JSON.parse loses precision on snowflakes, so it is refused.
      const json = `[{"name":"${teamName}","players":[{"name":"P","steamId":"${steamId}","discordId":123456789012345678}]}]`;

      await page.goto('/teams');
      await expect(page.getByTestId('teams-page')).toBeVisible();
      await openImportModal(page);

      await page.getByTestId('team-import-json-input').fill(json);
      await page.getByTestId('team-import-preview-button').click();

      await expect(page.getByTestId('team-import-warnings')).toBeVisible();
      await expect(page.getByTestId('team-import-submit-button')).toBeEnabled();

      await page.getByTestId('team-import-preview-team-0').click();
      await expect(page.getByTestId(`team-import-player-no-discord-${steamId}`)).toBeVisible();

      await page.getByTestId('team-import-submit-button').click();
      await expect(page.getByTestId('team-import-json-input')).toHaveCount(0);
      await expect(page.getByTestId(teamCardId(teamName))).toBeVisible();

      const ids = await discordIdsByPlayer(request);
      expect(ids.has(steamId), 'player should be imported').toBe(true);
      expect(ids.get(steamId) ?? null).toBeNull();

      await deleteTeam(request, importedTeamId(teamName));
    }
  );

  test(
    'team editor overwrites an existing Discord ID through the player endpoint',
    { tag: ['@ui', '@teams', '@discord', '@crud'] },
    async ({ page, request }) => {
      const stamp = Date.now();
      const teamName = `Discord Edit ${stamp}`;
      const teamId = `discord_edit_${stamp}`;
      const steamId = uniqueSteamId(4);
      const oldDiscordId = uniqueDiscordId(4);
      const newDiscordId = uniqueDiscordId(5);

      const created = await createTeam(request, {
        id: teamId,
        name: teamName,
        players: [{ steamId, name: 'Changes Discord' }],
      });
      expect(created).not.toBeNull();

      // Give the player an existing ID, which a team import could not overwrite.
      const seeded = await request.put(`/api/players/${steamId}`, {
        headers: getAuthHeader(),
        data: { discordId: oldDiscordId },
      });
      expect(seeded.ok(), 'seeding the Discord ID should succeed').toBe(true);

      await page.goto('/teams');
      const card = page.getByTestId(teamCardId(teamName));
      await expect(card).toBeVisible();
      await card.click();

      const modal = page.getByTestId('team-modal');
      await expect(modal).toBeVisible();

      const discordInput = page.getByTestId(`team-player-discord-${steamId}`);
      await expect(discordInput).toHaveValue(oldDiscordId);
      await expect(page.getByTestId(`team-player-no-discord-${steamId}`)).toHaveCount(0);

      // Clearing shows the marker; an invalid value blocks the save.
      await discordInput.fill('');
      await expect(page.getByTestId(`team-player-no-discord-${steamId}`)).toBeVisible();
      await discordInput.fill('not-a-snowflake');
      await page.getByTestId('team-save-button').click();
      await expect(page.getByTestId('team-modal-error')).toBeVisible();
      await expect(modal).toBeVisible();

      await discordInput.fill(newDiscordId);

      const playerPut = page.waitForRequest(
        (req) => req.method() === 'PUT' && req.url().includes(`/api/players/${steamId}`)
      );
      const teamPut = page.waitForRequest(
        (req) => req.method() === 'PUT' && req.url().includes(`/api/teams/${teamId}`)
      );
      await page.getByTestId('team-save-button').click();

      expect((await playerPut).postDataJSON()).toEqual({ discordId: newDiscordId });
      const teamPayload = (await teamPut).postDataJSON() as {
        players: Array<Record<string, unknown>>;
      };
      for (const player of teamPayload.players) {
        expect(player, 'the team payload must not carry Discord IDs').not.toHaveProperty(
          'discordId'
        );
      }
      await expect(modal).not.toBeVisible();

      // Persisted on the player record, overwriting the old value.
      const ids = await discordIdsByPlayer(request);
      expect(ids.get(steamId)).toBe(newDiscordId);

      // Reopen: the saved ID is loaded back from the team GET.
      await page.getByTestId(teamCardId(teamName)).click();
      await expect(modal).toBeVisible();
      await expect(page.getByTestId(`team-player-discord-${steamId}`)).toHaveValue(newDiscordId);

      await deleteTeam(request, teamId);
    }
  );
});
