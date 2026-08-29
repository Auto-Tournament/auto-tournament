import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import type { Team } from '../helpers/teams';

/**
 * Plugin phase → match status.
 *
 * `mapPhaseToLiveStatus` defaults to 'warmup', so every phase name it does not
 * know silently reads as WARMUP. MatchZy Enhanced reports `knife_decision`
 * while the knife winner picks a side, and MAT had no case for it — so the UI
 * dropped back to WARMUP mid-knife, which is the reported bug. `paused` and
 * `round_restore` had the same hole: both happen inside a live match.
 *
 * Reports normally arrive over RCON, which is stubbed for fake test servers, so
 * these inject one through the test-only endpoint instead.
 *
 * @tag api
 * @tag matchzy
 * @tag regression
 */

/** A minimal match report carrying just the phase and a map/score block. */
function reportWithPhase(phase: string) {
  return {
    match: {
      phase,
      map: { name: 'de_mirage', index: 0, number: 1, total: 1, round: 7 },
      score: { team1: 4, team2: 3, series: { team1: 0, team2: 0 } },
    },
  };
}

async function applyPhase(request: APIRequestContext, slug: string, phase: string) {
  const res = await request.post('/api/test/match-report', {
    data: { slug, report: reportWithPhase(phase) },
  });
  expect(res.ok(), `injecting phase ${phase} failed: ${await res.text()}`).toBe(true);
}

async function liveStatus(
  request: APIRequestContext,
  teamId: string
): Promise<string | undefined> {
  const res = await request.get(`/api/team/${teamId}/match`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { match?: { liveStats?: { status?: string } } };
  return body.match?.liveStats?.status;
}

test.describe.serial('Plugin phase to match status', () => {
  let team1: Team;
  let team2: Team;
  let slug: string;

  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'],
      teamCount: 2,
      serverCount: 1,
      prefix: 'phase',
    });
    expect(setup).toBeTruthy();
    [team1, team2] = [setup!.teams[0], setup!.teams[1]];

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug).toBeTruthy();
    slug = match!.slug;

    // A match the plugin is reporting on has been loaded onto a server. Without
    // this the status reconciliation has nothing to move forward from.
    const state = await request.post('/api/test/match-state', {
      data: { slug, status: 'loaded', serverId: setup!.servers[0].id },
    });
    expect(state.ok()).toBe(true);
  });

  test(
    'side selection after the knife round does not read as warmup',
    { tag: ['@api', '@matchzy', '@regression'] },
    async ({ request }) => {
      await applyPhase(request, slug, 'knife_decision');

      // The bug: with no case for `knife_decision` this fell to the 'warmup'
      // default, so the board dropped out of the knife round while the winning
      // team was still choosing a side.
      expect(await liveStatus(request, team1.id)).toBe('knife');

      const match = await findMatchByTeams(request, team1.id, team2.id);
      expect(match?.status).toBe('live');
    }
  );

  test(
    'a paused match stays live',
    { tag: ['@api', '@matchzy', '@regression'] },
    async ({ request }) => {
      await applyPhase(request, slug, 'paused');

      expect(await liveStatus(request, team1.id)).toBe('live');
      const match = await findMatchByTeams(request, team1.id, team2.id);
      expect(match?.status).toBe('live');
    }
  );

  test(
    'a round restore stays live',
    { tag: ['@api', '@matchzy', '@regression'] },
    async ({ request }) => {
      await applyPhase(request, slug, 'round_restore');

      expect(await liveStatus(request, team1.id)).toBe('live');
      const match = await findMatchByTeams(request, team1.id, team2.id);
      expect(match?.status).toBe('live');
    }
  );

  test(
    'CONTROL: a real warmup still reads as warmup',
    { tag: ['@api', '@matchzy'] },
    async ({ request }) => {
      await applyPhase(request, slug, 'warmup');

      // Guards the fix from the lazy version of itself — mapping everything to
      // 'live' would pass all three tests above.
      expect(await liveStatus(request, team1.id)).toBe('warmup');

      const match = await findMatchByTeams(request, team1.id, team2.id);
      expect(match?.status).toBe('loaded');
    }
  );
});
