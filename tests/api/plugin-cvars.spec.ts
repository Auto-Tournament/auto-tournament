import { test, expect } from '@playwright/test';
import { setupTestContext } from '../helpers/setup';
import { setupTournament } from '../helpers/tournamentSetup';
import { findMatchByTeams } from '../helpers/matches';

/**
 * Auto Tournament CS2 cvar tests
 *
 * Every generated match config carries the Auto Tournament CS2 cvar block that the
 * game servers read. These tests pin down two things:
 *
 *  1. the baseline cvar set and its default values, and
 *  2. that the admin's global settings override those defaults in new configs.
 *
 * NOTE: there are deliberately no "official vs shuffle profile" assertions here.
 * `generateAtEnhancedCvars` takes a tournament type but does not branch on
 * it — the resolution order is baseline defaults → global settings → explicit
 * overrides. An earlier version of this file asserted per-type profiles that the
 * API has never implemented, which is why it sat disabled.
 *
 * @tag api
 * @tag cs2-plugin
 */

/** Baseline values from DEFAULT_AT_ENHANCED_CVARS (api/src/integrations/cs2/services/pluginConfigService.ts). */
const DEFAULT_CVARS = {
  at_autoready_enabled: 0,
  at_both_teams_unpause_required: 1,
  at_max_pauses_per_team: 0,
  at_pause_duration: 0,
  at_side_selection_enabled: 1,
  at_side_selection_time: 60,
  at_gg_enabled: 0,
  at_gg_threshold: 0.8,
  at_gg_min_score_diff: 0,
  at_ffw_enabled: 0,
  at_ffw_time: 240,
  at_demo_recording_enabled: 1,
};

/** Reset the global Auto Tournament CS2 settings back to "unset" (null = use defaults). */
const CLEARED_SETTINGS = {
  atAutoreadyEnabled: null,
  atBothTeamsUnpauseRequired: null,
  atMaxPausesPerTeam: null,
  atPauseDuration: null,
  atSideSelectionEnabled: null,
  atSideSelectionTime: null,
  atGgEnabled: null,
  atGgThreshold: null,
  atGgMinScoreDiff: null,
  atFfwEnabled: null,
  atFfwTime: null,
  atDemoRecordingEnabled: null,
};

test.describe.serial('Auto Tournament CS2 cvars', () => {
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
    { tag: ['@api', '@cs2-plugin', '@cvars'] },
    async ({ request }) => {
      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
        serverCount: 1,
        prefix: 'at-defaults',
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
    'should apply global Auto Tournament CS2 settings as overrides in generated configs',
    { tag: ['@api', '@cs2-plugin', '@cvars', '@settings'] },
    async ({ request }) => {
      // Deliberately different from every default above.
      const overrides = {
        atAutoreadyEnabled: 1,
        atMaxPausesPerTeam: 2,
        atPauseDuration: 300,
        atSideSelectionTime: 30,
        atFfwEnabled: 1,
        atFfwTime: 120,
      };

      const settingsResponse = await request.put('/api/settings', { data: overrides });
      expect(settingsResponse.ok()).toBe(true);

      const setup = await setupTournament(request, {
        type: 'single_elimination',
        format: 'bo1',
        teamCount: 2,
        serverCount: 1,
        prefix: 'at-overrides',
      });
      expect(setup).toBeTruthy();

      const match = await findMatchByTeams(request, setup!.teams[0].id, setup!.teams[1].id);
      expect(match).toBeTruthy();

      const config = await (await request.get(`/api/matches/${match!.slug}.json`)).json();

      expect(config.cvars.at_autoready_enabled).toBe(1);
      expect(config.cvars.at_max_pauses_per_team).toBe(2);
      expect(config.cvars.at_pause_duration).toBe(300);
      expect(config.cvars.at_side_selection_time).toBe(30);
      expect(config.cvars.at_ffw_enabled).toBe(1);
      expect(config.cvars.at_ffw_time).toBe(120);

      // Settings that were not overridden keep their defaults.
      expect(config.cvars.at_both_teams_unpause_required).toBe(1);
      expect(config.cvars.at_gg_enabled).toBe(0);
      expect(config.cvars.at_demo_recording_enabled).toBe(1);
    }
  );

  test(
    'should reject invalid Auto Tournament CS2 setting values',
    { tag: ['@api', '@cs2-plugin', '@settings', '@validation'] },
    async ({ request }) => {
      const response = await request.put('/api/settings', {
        data: { atAutoreadyEnabled: 'yes-please' },
      });

      expect(response.ok()).toBe(false);
      expect((await response.json()).error).toContain('atAutoreadyEnabled');
    }
  );
});
