import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import { createPlayer } from '../helpers/players';

/**
 * Player presence: what a player is doing right now (offline, online,
 * searching, in a match), from GET /api/players/presence, shown on their
 * profile with a link to the match they are in.
 *
 * @tag ui
 * @tag players
 * @tag social
 */

function uniqueSteamId(): string {
  return `7656119${String(Date.now() % 1e10).padStart(10, '0')}`;
}

test.describe('Player presence', () => {
  test('the API answers for any id and refuses an empty ask', async ({ request }) => {
    const id = uniqueSteamId();
    const res = await request.get(`/api/players/presence?ids=${id}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { presence: Record<string, unknown> };
    expect(body.presence[id]).toEqual({ online: false, status: 'offline', activity: null });
    expect((await request.get('/api/players/presence?ids=')).status()).toBe(400);
  });

  test('a profile says the player is in a tournament match and links to it', async ({
    page,
    request,
  }) => {
    const id = uniqueSteamId();
    await signInViaRequest(request);
    expect(await createPlayer(request, { id, name: 'Presence Player' })).not.toBeNull();
    await page.route('**/api/players/presence?**', (route) =>
      route.fulfill({
        json: {
          success: true,
          presence: {
            [id]: {
              online: true,
              activity: {
                kind: 'playing',
                source: 'tournament',
                matchSlug: 't9-r1m1',
                label: 'Alpha vs Bravo',
              },
            },
          },
        },
      })
    );
    await page.goto(`/player/${id}`, { waitUntil: 'domcontentloaded' });
    const label = page.getByTestId('presence-label');
    await expect(label).toBeVisible({ timeout: 15000 });
    await expect(label.getByTestId('presence-dot')).toHaveAttribute('data-presence', 'playing');
    const link = label.getByRole('link', { name: 'In a tournament match: Alpha vs Bravo' });
    await expect(link).toHaveAttribute('href', /t9-r1m1/);
  });
});
