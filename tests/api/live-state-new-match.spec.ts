import { test, expect } from '@playwright/test';
import { getAuthHeader, signInViaRequest } from '../helpers/auth';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import { createPendingServer } from '../helpers/fleet';

/**
 * Match slugs come back (every tournament has an r1m1). A Ready Up live
 * record left by a deleted tournament's match must not show up as the new
 * match's state: no old phase, score or rosters on its pages.
 *
 * @tag api
 * @tag regression
 */
test(
  'a new match does not inherit the live state of a deleted one with its slug',
  {
    tag: ['@api'],
  },
  async ({ request }) => {
    test.setTimeout(90_000);
    expect(await signInViaRequest(request)).toBe(true);
    const headers = getAuthHeader();
    const first = await setupTournament(request, {
      teamCount: 2,
      serverCount: 1,
      prefix: 'live-old',
    });
    expect(first).toBeTruthy();
    const old = await findMatchByTeams(request, first!.teams[0].id, first!.teams[1].id);
    const slug = old!.slug;
    const fleet = await createPendingServer(request, `live-old-${Date.now()}`);
    const snap = await request.post('/api/test/fleet/snapshot', {
      headers,
      data: {
        serverId: fleet.serverId,
        state: {
          match_id: slug,
          epoch: 1000, // above any epoch other specs left for this slug
          server_id: fleet.serverId,
          config_rev: 1,
          live_rev: 1,
          phase: 'live',
          series: { num_maps: 1, current_map: 1, score: { team1: 0, team2: 0 }, maps: {} },
          teams: {
            team1: { name: 'Old One', score: 9, players: {} },
            team2: { name: 'Old Two', score: 3, players: {} },
          },
        },
      },
    });
    expect(snap.ok(), await snap.text()).toBe(true);
    const before = await (
      await request.get(`/api/game/cs2/matches/${slug}/manage`, { headers })
    ).json();
    expect(before.live?.state?.phase).toBe('live');

    // The tournament goes; a new one gets the same slug a second later.
    expect((await request.delete('/api/tournament', { headers })).ok()).toBe(true);
    await new Promise((r) => setTimeout(r, 1100));
    const second = await setupTournament(request, {
      teamCount: 2,
      serverCount: 1,
      prefix: 'live-new',
    });
    expect(second).toBeTruthy();
    const fresh = await findMatchByTeams(request, second!.teams[0].id, second!.teams[1].id);
    expect(fresh!.slug).toBe(slug);

    const after = await (
      await request.get(`/api/game/cs2/matches/${slug}/manage`, { headers })
    ).json();
    expect(after.live?.state ?? null).toBeNull();
  }
);
