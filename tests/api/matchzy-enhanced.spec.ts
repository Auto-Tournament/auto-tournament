import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';

/**
 * MatchZy Enhanced cvar tests
 *
 * Every generated match config carries the MatchZy Enhanced cvar block that the
 * game servers read. These tests pin down two things:
 *
 *  1. the baseline cvar set and its default values, and
 *  2. that the admin's global settings override those defaults in new configs.
 *
 * NOTE: there are deliberately no "official vs shuffle profile" assertions here.
 * `generateMatchzyEnhancedCvars` takes a tournament type but does not branch on
 * it — the resolution order is baseline defaults → global settings → explicit
 * overrides. An earlier version of this file asserted per-type profiles that the
 * API has never implemented, which is why it sat disabled.
 *
 * @tag api
 * @tag matchzy
 */

/** Baseline values from DEFAULT_MATCHZY_ENHANCED_CVARS (api/src/services/matchzyConfigService.ts). */
const DEFAULT_CVARS = {
  matchzy_autoready_enabled: 0,
  matchzy_both_teams_unpause_required: 1,
  matchzy_max_pauses_per_team: 0,
  matchzy_pause_duration: 0,
  matchzy_side_selection_enabled: 1,
  matchzy_side_selection_time: 60,
  matchzy_gg_enabled: 0,
  matchzy_gg_threshold: 0.8,
  matchzy_gg_min_score_diff: 0,
  matchzy_ffw_enabled: 0,
  matchzy_ffw_time: 240,
  matchzy_demo_recording_enabled: 1,
};

/** Reset the global MatchZy Enhanced settings back to "unset" (null = use defaults). */
const CLEARED_SETTINGS = {
  matchzyAutoreadyEnabled: null,
  matchzyBothTeamsUnpauseRequired: null,
  matchzyMaxPausesPerTeam: null,
  matchzyPauseDuration: null,
  matchzySideSelectionEnabled: null,
  matchzySideSelectionTime: null,
  matchzyGgEnabled: null,
  matchzyGgThreshold: null,
  matchzyGgMinScoreDiff: null,
  matchzyFfwEnabled: null,
  matchzyFfwTime: null,
  matchzyDemoRecordingEnabled: null,
};

test.describe.serial('MatchZy Enhanced cvars', () => {
  test.beforeEach(async ({ page, request }) => {
    await setupTestContext(page, request);
    // Start from defaults so one test's overrides cannot leak into the next.
    await request.put('/api/settings', { data: CLEARED_SETTINGS });
  });

  test.afterEach(async ({ request }) => {
    await request.put('/api/settings', { data: CLEARED_SETTINGS });
  });

  test(
    'should include the full Enhanced cvar block with default values in a tournament match config',
    { tag: ['@api', '@matchzy', '@cvars'] },
    async ({ request }) => {
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
        serverCount: 1,
        prefix: 'matchzy-defaults',
      });
      expect(setup).toBeTruthy();

      const match = await findMatchByTeams(request, setup!.teams[0].id, setup!.teams[1].id);
      expect(match).toBeTruthy();

      const config = await (await request.get(`/api/matches/${match!.slug}.json`)).json();
      expect(config.cvars).toBeDefined();

      for (const [cvar, value] of Object.entries(DEFAULT_CVARS)) {
        expect(config.cvars[cvar], `${cvar} should use its documented default`).toBe(value);
      }

      // mp_maxrounds is added alongside the Enhanced block, from tournament settings.
      expect(config.cvars.mp_maxrounds).toBeGreaterThan(0);
    }
  );

  test(
    'should apply global MatchZy Enhanced settings as overrides in generated configs',
    { tag: ['@api', '@matchzy', '@cvars', '@settings'] },
    async ({ request }) => {
      // Deliberately different from every default above.
      const overrides = {
        matchzyAutoreadyEnabled: 1,
        matchzyMaxPausesPerTeam: 2,
        matchzyPauseDuration: 300,
        matchzySideSelectionTime: 30,
        matchzyFfwEnabled: 1,
        matchzyFfwTime: 120,
      };

      const settingsResponse = await request.put('/api/settings', { data: overrides });
      expect(settingsResponse.ok()).toBe(true);

      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
        serverCount: 1,
        prefix: 'matchzy-overrides',
      });
      expect(setup).toBeTruthy();

      const match = await findMatchByTeams(request, setup!.teams[0].id, setup!.teams[1].id);
      expect(match).toBeTruthy();

      const config = await (await request.get(`/api/matches/${match!.slug}.json`)).json();

      expect(config.cvars.matchzy_autoready_enabled).toBe(1);
      expect(config.cvars.matchzy_max_pauses_per_team).toBe(2);
      expect(config.cvars.matchzy_pause_duration).toBe(300);
      expect(config.cvars.matchzy_side_selection_time).toBe(30);
      expect(config.cvars.matchzy_ffw_enabled).toBe(1);
      expect(config.cvars.matchzy_ffw_time).toBe(120);

      // Settings that were not overridden keep their defaults.
      expect(config.cvars.matchzy_both_teams_unpause_required).toBe(1);
      expect(config.cvars.matchzy_gg_enabled).toBe(0);
      expect(config.cvars.matchzy_demo_recording_enabled).toBe(1);
    }
  );

  test(
    'should reject invalid MatchZy Enhanced setting values',
    { tag: ['@api', '@matchzy', '@settings', '@validation'] },
    async ({ request }) => {
      const response = await request.put('/api/settings', {
        data: { matchzyAutoreadyEnabled: 'yes-please' },
      });

      expect(response.ok()).toBe(false);
      expect((await response.json()).error).toContain('matchzyAutoreadyEnabled');
    }
  );
});
