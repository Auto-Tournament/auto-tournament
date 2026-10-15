/**
 * Typed readers for the CS2 instance settings (./settings), with the MatchZy Enhanced
 * defaults applied. Moved unchanged from the core settings service; the
 * values still come from the core settings store.
 *
 * The simulation readers (`isSimulationModeEnabled`, `getSimulationTimescale`)
 * stay on the core `settingsService`: the scheduler and Swiss progression
 * read simulation mode too.
 */

import { settingsService } from '../../services/settingsService';
import type { Cs2SettingKey } from './settings';

/**
 * A veto step's time limit when the admin never set one: 45 seconds, or
 * AT_VETO_TURN_SECONDS_DEFAULT (the test suite sets 0, so tournaments other
 * specs leave waiting on a veto stay put).
 */
export function defaultVetoTurnSeconds(): number {
  const env = Number(process.env.AT_VETO_TURN_SECONDS_DEFAULT);
  return process.env.AT_VETO_TURN_SECONDS_DEFAULT !== undefined && Number.isInteger(env) && env >= 0
    ? Math.min(env, 600)
    : 45;
}

class Cs2Settings {
  private getSetting(key: Cs2SettingKey): Promise<string | null> {
    return settingsService.getSetting(key);
  }

  async getAtMinimumReadyRequired(): Promise<number> {
    const value = await this.getSetting('at_minimum_ready_required');
    if (!value) return 0; // MatchZy Enhanced default (0 = everyone connected must ready)
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 0;
    return parsed;
  }

  async isAtAllowForceReadyEnabled(): Promise<boolean> {
    const value = await this.getSetting('at_allow_force_ready');
    if (!value) return true; // MatchZy Enhanced default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isAtPauseAfterRestoreEnabled(): Promise<boolean> {
    const value = await this.getSetting('at_pause_after_restore');
    if (!value) return true; // MatchZy Enhanced default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  /**
   * Ready Up match servers get a join password (sv_password). Off by default: the
   * roster whitelist already keeps everyone else out, and a password only made
   * players type more (and went stale when a restarted server got a new one).
   */
  /** Minutes a loaded match waits in warmup before it starts anyway; 0 = it waits for ready. */
  async getAtAutostartAfterMinutes(): Promise<number> {
    const value = await this.getSetting('at_autostart_after_minutes');
    const parsed = Number(value);
    return value && Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 120) : 0;
  }

  /** Seconds per veto step before the platform picks for the team (unset = defaultVetoTurnSeconds, 0 = no limit). */
  /** Minutes between a team's matches before the next one's veto opens (0 = none; default 5). */
  async getMatchBreakMinutes(): Promise<number> {
    const value = await this.getSetting('at_match_break_minutes');
    if (value === null || value === undefined || value === '') return 5;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.round(parsed), 120) : 0;
  }

  /** Seconds for the first veto turn of a match (default 120; 0 = the usual turn). */
  async getVetoFirstTurnSeconds(): Promise<number> {
    const value = await this.getSetting('at_veto_first_turn_seconds');
    if (value === null || value === undefined || value === '') return 120;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 900) : 0;
  }

  async getVetoTurnSeconds(): Promise<number> {
    const value = await this.getSetting('at_veto_turn_seconds');
    if (value === null || value === undefined || value === '') return defaultVetoTurnSeconds();
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 600) : 0;
  }

  async isAtJoinPasswordEnabled(): Promise<boolean> {
    const value = await this.getSetting('at_join_password');
    if (!value) return false;
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async getAtSeriesEndKickDelayNoDemo(): Promise<number> {
    const value = await this.getSetting('at_series_end_kick_delay_no_demo');
    // 30 s: players read the final scoreboard before they are kicked (5 s was too short).
    if (!value) return 30;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 30;
    return parsed;
  }

  /** The ready / restore defaults Ready Up gets with every match (fleet/driver.ts, matchConfig.ts). */
  async getAtCoreDefaults(): Promise<{
    minimumReadyRequired: number;
    allowForceReady: boolean;
    pauseAfterRestore: boolean;
    seriesEndKickDelayNoDemo: number;
  }> {
    const [minimumReadyRequired, allowForceReady, pauseAfterRestore, seriesEndKickDelayNoDemo] =
      await Promise.all([
        this.getAtMinimumReadyRequired(),
        this.isAtAllowForceReadyEnabled(),
        this.isAtPauseAfterRestoreEnabled(),
        this.getAtSeriesEndKickDelayNoDemo(),
      ]);
    return { minimumReadyRequired, allowForceReady, pauseAfterRestore, seriesEndKickDelayNoDemo };
  }

  /**
   * Get MatchZy Enhanced v1.3.0 global configuration overrides.
   * Returns null for any setting that is not explicitly configured (use tournament defaults).
   */
  async getAtEnhancedSettings(): Promise<{
    at_autoready_enabled: 0 | 1 | null;
    at_both_teams_unpause_required: 0 | 1 | null;
    at_pause_on_disconnect: 0 | 1 | null;
    at_max_pauses_per_team: number | null;
    at_pause_duration: number | null;
    at_side_selection_enabled: 0 | 1 | null;
    at_side_selection_time: number | null;
    at_gg_enabled: 0 | 1 | null;
    at_gg_threshold: number | null;
    at_gg_min_score_diff: number | null;
    at_ffw_enabled: 0 | 1 | null;
    at_ffw_time: number | null;
    at_demo_recording_enabled: 0 | 1 | null;
  }> {
    const parseBooleanSetting = async (key: Cs2SettingKey): Promise<0 | 1 | null> => {
      const value = await this.getSetting(key);
      if (!value) return null;
      const normalized = value.toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes' ? 1 : 0;
    };

    const parseIntSetting = async (key: Cs2SettingKey): Promise<number | null> => {
      const value = await this.getSetting(key);
      if (!value) return null;
      const parsed = Number(value);
      return Number.isInteger(parsed) ? parsed : null;
    };

    const parseFloatSetting = async (key: Cs2SettingKey): Promise<number | null> => {
      const value = await this.getSetting(key);
      if (!value) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    return {
      at_autoready_enabled: await parseBooleanSetting('at_autoready_enabled'),
      at_both_teams_unpause_required: await parseBooleanSetting('at_both_teams_unpause_required'),
      at_pause_on_disconnect: await parseBooleanSetting('at_pause_on_disconnect'),
      at_max_pauses_per_team: await parseIntSetting('at_max_pauses_per_team'),
      at_pause_duration: await parseIntSetting('at_pause_duration'),
      at_side_selection_enabled: await parseBooleanSetting('at_side_selection_enabled'),
      at_side_selection_time: await parseIntSetting('at_side_selection_time'),
      at_gg_enabled: await parseBooleanSetting('at_gg_enabled'),
      at_gg_threshold: await parseFloatSetting('at_gg_threshold'),
      at_gg_min_score_diff: await parseIntSetting('at_gg_min_score_diff'),
      at_ffw_enabled: await parseBooleanSetting('at_ffw_enabled'),
      at_ffw_time: await parseIntSetting('at_ffw_time'),
      at_demo_recording_enabled: await parseBooleanSetting('at_demo_recording_enabled'),
    };
  }
}

export const cs2Settings = new Cs2Settings();

/** CS2's fields of the `GET /api/settings` response (`readInstanceSettings`). */
export async function readCs2InstanceSettings(): Promise<Record<string, unknown>> {
  const simulateMatches = await settingsService.isSimulationModeEnabled();
  const simulationTimescale = await settingsService.getSimulationTimescale();
  const atCore = await cs2Settings.getAtCoreDefaults();

  // MatchZy Enhanced v1.3.0 settings
  const atEnhanced = await cs2Settings.getAtEnhancedSettings();

  return {
    simulateMatches,
    simulationTimescale,
    // MatchZy Enhanced core defaults
    atMinimumReadyRequired: atCore.minimumReadyRequired,
    atAllowForceReady: atCore.allowForceReady,
    atPauseAfterRestore: atCore.pauseAfterRestore,
    atJoinPassword: await cs2Settings.isAtJoinPasswordEnabled(),
    atAutostartAfterMinutes: await cs2Settings.getAtAutostartAfterMinutes(),
    vetoTurnSeconds: await cs2Settings.getVetoTurnSeconds(),
    vetoFirstTurnSeconds: await cs2Settings.getVetoFirstTurnSeconds(),
    matchBreakMinutes: await cs2Settings.getMatchBreakMinutes(),
    atSeriesEndKickDelayNoDemo: atCore.seriesEndKickDelayNoDemo,
    // MatchZy Enhanced v1.3.0 settings (null = use tournament defaults)
    atAutoreadyEnabled: atEnhanced.at_autoready_enabled,
    atBothTeamsUnpauseRequired: atEnhanced.at_both_teams_unpause_required,
    atPauseOnDisconnect: atEnhanced.at_pause_on_disconnect,
    atMaxPausesPerTeam: atEnhanced.at_max_pauses_per_team,
    atPauseDuration: atEnhanced.at_pause_duration,
    atSideSelectionEnabled: atEnhanced.at_side_selection_enabled,
    atSideSelectionTime: atEnhanced.at_side_selection_time,
    atGgEnabled: atEnhanced.at_gg_enabled,
    atGgThreshold: atEnhanced.at_gg_threshold,
    atGgMinScoreDiff: atEnhanced.at_gg_min_score_diff,
    atFfwEnabled: atEnhanced.at_ffw_enabled,
    atFfwTime: atEnhanced.at_ffw_time,
    atDemoRecordingEnabled: atEnhanced.at_demo_recording_enabled,
    // The highlight settings are core's (services/highlights/settings.ts).
  };
}
