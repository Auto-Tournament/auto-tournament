import { test, expect } from '@playwright/test';
import { ensureSignedIn, signInViaRequest, impersonatePlayer, stopImpersonating } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { actingSteamIdFor } from '../helpers/veto';
import type { Team } from '../helpers/teams';

/**
 * A server that is assigned and answering must not read as "not assigned yet".
 *
 * `/api/players/:id/current-match` reports `server.status` as a MatchZy plugin
 * status — idle | loading | warmup | knife | live | ... — and only fills it in
 * when the server actually answered. The player page used to test that against
 * `'online' | 'checking' | 'loading'`, two of which this endpoint never
 * produces, so a server sitting in `idle` or `warmup` read as offline and the
 * page claimed it was still waiting for a server to be assigned.
 *
 * Verified against a real CS2 server, which reports `idle` for a freshly loaded
 * match. Fake test servers report `idle` too, so this reproduces in CI.
 *
 * The match here deliberately has **no live stats**: `isServerOnline` also
 * accepts live stats, which would mask the bug entirely.
 *
 * @tag ui
 * @tag regression
 */
test.describe.serial('Assigned server on the player page', () => {
  test.setTimeout(120000);

  let team1: Team;
  let team2: Team;

  test.beforeEach(async ({ page, request }) => {
    await ensureSignedIn(page);
    await signInViaRequest(request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
      teamCount: 2,
      serverCount: 1,
      prefix: 'assigned',
    });
    expect(setup).toBeTruthy();
    [team1, team2] = [setup!.teams[0], setup!.teams[1]];

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();

    const state = await request.post('/api/test/match-state', {
      data: { slug: match!.slug, serverId: setup!.servers[0].id, status: 'loaded' },
    });
    expect(state.ok()).toBe(true);
  });

  test.afterEach(async ({ page, request }) => {
    await stopImpersonating(page.request);
    await stopImpersonating(request);
  });

  test(
    'shows the connect panel for a server reporting idle, not "waiting for assignment"',
    { tag: ['@ui', '@regression'] },
    async ({ page }) => {
      const steamId = actingSteamIdFor(team1);
      expect(await impersonatePlayer(page.request, steamId)).toBe(true);

      await page.goto(`/player/${steamId}`, { waitUntil: 'domcontentloaded' });

      // The connect controls are the visible proof the server is treated as
      // assigned and reachable.
      await expect(page.getByRole('button', { name: /Copy Console Command/i })).toBeVisible({
        timeout: 20000,
      });

      await expect(page.getByText(/Waiting for Server Assignment/i)).toHaveCount(0);
    }
  );
});
