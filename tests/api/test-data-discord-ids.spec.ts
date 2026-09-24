import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { generateDiscordId } from '../../client/src/generation/discordId';

/**
 * Generated test data carries Discord IDs a bot can actually find.
 *
 * A fresh dev instance had none: every `GET /api/players/by-discord-id/:id`
 * answered `{"players":[]}`, which is a *real* answer — an ID is not unique
 * and "nobody matches" is ordinary — and therefore indistinguishable from a
 * bot that is broken. Someone writing one against a dev instance had nothing
 * to aim at.
 *
 * The risk in generating them is silence. An import drops a malformed Discord
 * ID with a warning rather than failing, because a bad ID must not fail an
 * import of forty players. So a generator that produced 20-plus digits, or
 * anything `isValidDiscordId` refuses, would leave the dev page looking
 * successful and the column empty. That is what this pins.
 *
 * @tag api
 * @tag players
 */

test.describe('Generated Discord IDs', () => {
  test('look like snowflakes the platform accepts', { tag: ['@api', '@players'] }, () => {
    const ids = Array.from({ length: 500 }, () => generateDiscordId());

    for (const id of ids) {
      // What `isValidDiscordId` enforces: 17–20 digits, nothing else.
      expect(id, `${id} should be digits only`).toMatch(/^[0-9]+$/);
      expect(id.length, `${id} should be 17–20 digits`).toBeGreaterThanOrEqual(17);
      expect(id.length, `${id} should be 17–20 digits`).toBeLessThanOrEqual(20);
    }

    // Random, so collisions are possible and fine — but a generator returning
    // the same value every time would pass every check above while making the
    // test data useless.
    expect(new Set(ids).size, 'ids should vary').toBeGreaterThan(400);
  });

  test('survive an import and can be looked up', { tag: ['@api', '@players'] }, async ({
    request,
  }) => {
    expect(await signInViaRequest(request)).toBe(true);

    const stamp = `${Date.now()}`.slice(-9);
    const players = Array.from({ length: 3 }, (_, index) => ({
      id: `7656119${stamp}${index}`,
      name: `Discord ID import ${stamp} ${index}`,
      discordId: generateDiscordId(),
    }));

    const imported = await request.post('/api/players/bulk-import', { data: players });
    expect([201, 207], `importing: ${await imported.text()}`).toContain(imported.status());

    const body = (await imported.json()) as { warnings?: string[]; errors?: unknown[] };
    // The import drops a malformed Discord ID with a warning instead of
    // failing, so a warning here is the generator being wrong.
    expect(body.warnings ?? [], 'no Discord ID should have been dropped').toEqual([]);

    try {
      for (const player of players) {
        const response = await request.get(`/api/players/by-discord-id/${player.discordId}`);
        expect(response.status(), `looking up ${player.discordId}`).toBe(200);
        const found = (await response.json()) as { players: Array<{ id: string }> };
        expect(
          found.players.map((row) => row.id),
          'the imported player should be found by the ID it was imported with'
        ).toContain(player.id);
      }
    } finally {
      await request.post('/api/players/bulk-delete', { data: players.map((p) => p.id) });
    }
  });
});
