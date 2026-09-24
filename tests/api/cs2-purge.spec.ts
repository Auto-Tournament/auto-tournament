import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';

/**
 * Purging CS2's data (DESIGN-modules §10.6). Core keeps foreign keys into
 * CS2's tables — `matches.server_id` into `cs2_servers`, a standalone match
 * template's `map_pool_id` into `cs2_map_pools` — so a purge that dropped the
 * tables alone would always fail. It drops those keys first, in the same
 * transaction.
 *
 * The suite's CS2 is loaded (and has matches), so a real purge is refused
 * here by design; `POST /api/test/modules/cs2/purge-probe` runs exactly the
 * purge's database half and rolls it back. The upgrade test purges CS2 for
 * real on its fresh database, after an uninstall and a restart.
 *
 * @tag api
 * @tag modules
 */

test.describe('CS2 purge', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test("drops core's keys into CS2's tables, then the tables, in one transaction", async ({ request }) => {
    const response = await request.post('/api/test/modules/cs2/purge-probe');
    expect(response.status(), await response.text()).toBe(200);
    const probe = (await response.json()) as { ok: boolean; tables: string[]; constraints: string[]; error?: string };
    expect(probe.error ?? null).toBeNull();
    expect(probe.ok).toBe(true);
    expect(probe.tables).toEqual(expect.arrayContaining(['cs2_servers', 'cs2_maps', 'cs2_map_pools']));
    // Never a core table.
    for (const table of probe.tables) expect(table.startsWith('cs2_')).toBe(true);
    expect(probe.constraints).toEqual(
      expect.arrayContaining([
        'matches.matches_server_id_fkey',
        'manual_match_templates.manual_match_templates_map_pool_id_fkey',
      ])
    );

    // Rolled back: CS2 still has its servers table.
    const servers = await request.get('/api/servers');
    expect(servers.status()).toBe(200);
  });

  test('a real purge of the loaded CS2 is refused, and says why', async ({ request }) => {
    const response = await request.post('/api/catalog/modules/cs2/purge', {
      data: { confirm: 'cs2' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status()).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/Uninstall 'cs2' first|still loaded/);
  });
});
