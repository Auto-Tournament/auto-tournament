import { test, expect, type APIRequestContext } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';
import {
  executeVetoActions,
  getVetoState,
  getCSMajorBO1Actions,
  actingSteamIdFor,
} from '../helpers/veto';
import { stopImpersonating } from '../helpers/auth';
import type { Team } from '../helpers/teams';

/**
 * Switching simulation on while a tournament is running must auto-veto the
 * matches already waiting on a veto.
 *
 * Automated veto used to be triggered only at tournament start and when match
 * progression readied a new match. A tournament started with simulation off
 * and switched on afterwards left its current matches waiting for a manual
 * veto that nobody was going to do.
 *
 * Needs simulation to be allowed: CI runs NODE_ENV=production with
 * MATCHZY_ENABLE_SIMULATION_IN_PROD=true. Where it is not allowed the settings
 * API ignores the flag, and the tests skip rather than fail.
 *
 * @tag api
 * @tag veto
 * @tag simulation
 * @tag regression
 */

const MAPS = ['de_mirage', 'de_inferno', 'de_ancient', 'de_anubis', 'de_dust2', 'de_vertigo', 'de_nuke'];

// BO1 is 7 steps at ~1s each when automated; leave CI headroom.
const VETO_TIMEOUT_MS = 45_000;

async function setSimulation(request: APIRequestContext, enabled: boolean): Promise<boolean> {
  const response = await request.put('/api/settings', { data: { simulateMatches: enabled } });
  expect(response.ok(), `settings update failed: ${await response.text()}`).toBe(true);
  const body = await response.json();
  return Boolean(body.settings?.simulateMatches);
}

test.describe.serial('Enabling simulation mid-tournament', () => {
  let team1: Team;
  let team2: Team;
  let matchSlug: string;

  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);

    // Start the tournament with simulation off, the state that got stuck.
    await setSimulation(request, false);

    const setup = await setupTournament(request, {
      type: 'single_elimination',
      format: 'bo1',
      maps: MAPS,
      teamCount: 2,
      serverCount: 1,
      prefix: 'sim-mid',
    });
    expect(setup, 'tournament setup failed').toBeTruthy();
    [team1, team2] = setup!.teams;

    const match = await findMatchByTeams(request, team1.id, team2.id);
    expect(match?.slug, 'match not created').toBeTruthy();
    matchSlug = match!.slug;
  });

  test.afterEach(async ({ request }) => {
    await stopImpersonating(request);
    await setSimulation(request, false);
  });

  async function expectVetoCompletes(request: APIRequestContext) {
    let veto: { status?: string; actions?: Array<{ mapName: string }>; pickedMaps?: unknown[] } | null =
      null;
    await expect
      .poll(
        async () => {
          veto = await getVetoState(request, matchSlug, actingSteamIdFor(team1));
          return veto?.status;
        },
        { message: 'automated veto to complete', timeout: VETO_TIMEOUT_MS, intervals: [1000] }
      )
      .toBe('completed');
    return veto!;
  }

  test('auto-completes a veto nobody has started', async ({ request }) => {
    const before = await getVetoState(request, matchSlug, actingSteamIdFor(team1));
    expect(before?.status ?? 'pending').not.toBe('completed');

    const enabled = await setSimulation(request, true);
    test.skip(!enabled, 'simulation mode is not allowed in this environment');

    const veto = await expectVetoCompletes(request);
    expect(veto.pickedMaps).toHaveLength(1);
  });

  test('resumes a veto the players already started', async ({ request }) => {
    // Players make the first two bans by hand.
    const [first, second] = getCSMajorBO1Actions(team1, team2);
    expect(await executeVetoActions(request, matchSlug, [first, second])).toBeTruthy();

    const partial = await getVetoState(request, matchSlug, actingSteamIdFor(team1));
    expect(partial?.status).toBe('in_progress');
    expect(partial?.currentStep).toBe(3);

    const enabled = await setSimulation(request, true);
    test.skip(!enabled, 'simulation mode is not allowed in this environment');

    const veto = await expectVetoCompletes(request);
    // Resumed, not restarted: the manual bans are still the first two actions.
    expect(veto.actions?.slice(0, 2).map((a) => a.mapName)).toEqual([
      first.mapName,
      second.mapName,
    ]);
    expect(veto.actions).toHaveLength(7);
    expect(veto.pickedMaps).toHaveLength(1);
  });
});
