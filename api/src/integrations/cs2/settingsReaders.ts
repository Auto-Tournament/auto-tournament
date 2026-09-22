/**
 * Typed readers for the CS2 instance settings (./settings), with the MatchZy
 * defaults applied. Moved unchanged from the core settings service; the
 * values still come from the core settings store.
 *
 * The simulation readers (`isSimulationModeEnabled`, `getSimulationTimescale`)
 * stay on the core `settingsService`: the scheduler and Swiss progression
 * read simulation mode too.
 */

import { settingsService } from '../../services/settingsService';
import type { Cs2SettingKey } from './settings';

class Cs2Settings {
  private getSetting(key: Cs2SettingKey): Promise<string | null> {
    return settingsService.getSetting(key);
  }

  async getMatchzyChatPrefix(): Promise<string | null> {
    const value = await this.getSetting('matchzy_chat_prefix');
    const trimmed = value ? value.trim() : '';
    // Default to a sensible prefix if none is configured explicitly
    return trimmed !== '' ? trimmed : '[{Green}Auto Tournament{Default}]';
  }

  async getMatchzyAdminChatPrefix(): Promise<string | null> {
    const value = await this.getSetting('matchzy_admin_chat_prefix');
    const trimmed = value ? value.trim() : '';
    // Default to a sensible admin prefix if none is configured explicitly
    return trimmed !== '' ? trimmed : '[{Red}ADMIN{Default}]';
  }

  async isMatchzyDebugChatEnabled(): Promise<boolean> {
    const value = await this.getSetting('matchzy_debug_chat');
    if (!value) {
      // Explicit default: debug chat off unless enabled.
      return false;
    }
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isKnifeRoundEnabledByDefault(): Promise<boolean> {
    const value = await this.getSetting('matchzy_knife_enabled_default');
    if (!value) {
      // Defer to MatchZy plugin defaults when not explicitly configured
      return true;
    }

    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async getMatchzyMinimumReadyRequired(): Promise<number> {
    const value = await this.getSetting('matchzy_minimum_ready_required');
    if (!value) return 0; // MatchZy Enhanced default (0 = everyone connected must ready)
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 0;
    return parsed;
  }

  async getMatchzyAutostartMode(): Promise<0 | 1 | 2> {
    const value = await this.getSetting('matchzy_autostart_mode');
    if (!value) return 1; // MatchZy default
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2) return 1;
    return parsed as 0 | 1 | 2;
  }

  async isMatchzyAllowForceReadyEnabled(): Promise<boolean> {
    const value = await this.getSetting('matchzy_allow_force_ready');
    if (!value) return true; // MatchZy default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isMatchzyKickWhenNoMatchLoadedEnabled(): Promise<boolean> {
    const value = await this.getSetting('matchzy_kick_when_no_match_loaded');
    if (!value) return false; // MatchZy default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isMatchzyWhitelistEnabledDefault(): Promise<boolean> {
    const value = await this.getSetting('matchzy_whitelist_enabled_default');
    if (!value) return false; // MatchZy default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isMatchzyPauseAfterRestoreEnabled(): Promise<boolean> {
    const value = await this.getSetting('matchzy_pause_after_restore');
    if (!value) return true; // MatchZy default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isMatchzyStopCommandAvailable(): Promise<boolean> {
    const value = await this.getSetting('matchzy_stop_command_available');
    if (!value) return false; // MatchZy default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isMatchzyStopCommandNoDamage(): Promise<boolean> {
    const value = await this.getSetting('matchzy_stop_command_no_damage');
    if (!value) return false; // MatchZy default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isMatchzyUsePauseCommandForTacticalPause(): Promise<boolean> {
    const value = await this.getSetting('matchzy_use_pause_command_for_tactical_pause');
    if (!value) return false; // MatchZy default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  /**
   * Hostname format MatchZy applies when a match loads.
   *
   * Returns `''` when the operator has explicitly cleared it, which tells the
   * plugin to leave the server's own `hostname` (from server.cfg) untouched.
   * A missing row means "never configured", which keeps MatchZy's own default.
   * The two are deliberately distinct — see `setSetting`.
   */
  async getMatchzyHostnameFormat(): Promise<string> {
    const value = await this.getSetting('matchzy_hostname_format');
    if (value === null) return '{TEAM1} vs {TEAM2}'; // MatchZy default
    return value.trim();
  }

  async getMatchzyDemoPath(): Promise<string> {
    const value = await this.getSetting('matchzy_demo_path');
    if (!value) return 'MatchZy/'; // MatchZy default
    const trimmed = value.trim();
    if (!trimmed) return 'MatchZy/';
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }

  async getMatchzyDemoNameFormat(): Promise<string> {
    const value = await this.getSetting('matchzy_demo_name_format');
    if (!value) return '{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}'; // MatchZy default
    const trimmed = value.trim();
    return trimmed !== '' ? trimmed : '{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}';
  }

  async getMatchzySeriesEndKickDelayNoDemo(): Promise<number> {
    const value = await this.getSetting('matchzy_series_end_kick_delay_no_demo');
    if (!value) return 5; // MatchZy default
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 5;
    return parsed;
  }

  async getMatchzySeriesEndKickDelayDemoNoUpload(): Promise<number> {
    const value = await this.getSetting('matchzy_series_end_kick_delay_demo_no_upload');
    if (!value) return 10; // MatchZy default
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 10;
    return parsed;
  }

  async getMatchzySeriesEndKickDelayDemoUpload(): Promise<number> {
    const value = await this.getSetting('matchzy_series_end_kick_delay_demo_upload');
    if (!value) return 60; // MatchZy default
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 60;
    return parsed;
  }

  async getMatchzyCoreDefaults(): Promise<{
    autostartMode: 0 | 1 | 2;
    minimumReadyRequired: number;
    allowForceReady: boolean;
    kickWhenNoMatchLoaded: boolean;
    whitelistEnabledDefault: boolean;
    pauseAfterRestore: boolean;
    stopCommandAvailable: boolean;
    stopCommandNoDamage: boolean;
    usePauseCommandForTacticalPause: boolean;
    hostnameFormat: string;
    demoPath: string;
    demoNameFormat: string;
    seriesEndKickDelayNoDemo: number;
    seriesEndKickDelayDemoNoUpload: number;
    seriesEndKickDelayDemoUpload: number;
  }> {
    const [
      autostartMode,
      minimumReadyRequired,
      allowForceReady,
      kickWhenNoMatchLoaded,
      whitelistEnabledDefault,
      pauseAfterRestore,
      stopCommandAvailable,
      stopCommandNoDamage,
      usePauseCommandForTacticalPause,
      hostnameFormat,
      demoPath,
      demoNameFormat,
      seriesEndKickDelayNoDemo,
      seriesEndKickDelayDemoNoUpload,
      seriesEndKickDelayDemoUpload,
    ] = await Promise.all([
      this.getMatchzyAutostartMode(),
      this.getMatchzyMinimumReadyRequired(),
      this.isMatchzyAllowForceReadyEnabled(),
      this.isMatchzyKickWhenNoMatchLoadedEnabled(),
      this.isMatchzyWhitelistEnabledDefault(),
      this.isMatchzyPauseAfterRestoreEnabled(),
      this.isMatchzyStopCommandAvailable(),
      this.isMatchzyStopCommandNoDamage(),
      this.isMatchzyUsePauseCommandForTacticalPause(),
      this.getMatchzyHostnameFormat(),
      this.getMatchzyDemoPath(),
      this.getMatchzyDemoNameFormat(),
      this.getMatchzySeriesEndKickDelayNoDemo(),
      this.getMatchzySeriesEndKickDelayDemoNoUpload(),
      this.getMatchzySeriesEndKickDelayDemoUpload(),
    ]);

    return {
      autostartMode,
      minimumReadyRequired,
      allowForceReady,
      kickWhenNoMatchLoaded,
      whitelistEnabledDefault,
      pauseAfterRestore,
      stopCommandAvailable,
      stopCommandNoDamage,
      usePauseCommandForTacticalPause,
      hostnameFormat,
      demoPath,
      demoNameFormat,
      seriesEndKickDelayNoDemo,
      seriesEndKickDelayDemoNoUpload,
      seriesEndKickDelayDemoUpload,
    };
  }

  /**
   * Get MatchZy Enhanced v1.3.0 global configuration overrides.
   * Returns null for any setting that is not explicitly configured (use tournament defaults).
   */
  async getMatchzyEnhancedSettings(): Promise<{
    matchzy_autoready_enabled: 0 | 1 | null;
    matchzy_both_teams_unpause_required: 0 | 1 | null;
    matchzy_max_pauses_per_team: number | null;
    matchzy_pause_duration: number | null;
    matchzy_side_selection_enabled: 0 | 1 | null;
    matchzy_side_selection_time: number | null;
    matchzy_gg_enabled: 0 | 1 | null;
    matchzy_gg_threshold: number | null;
    matchzy_gg_min_score_diff: number | null;
    matchzy_ffw_enabled: 0 | 1 | null;
    matchzy_ffw_time: number | null;
    matchzy_demo_recording_enabled: 0 | 1 | null;
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
      matchzy_autoready_enabled: await parseBooleanSetting('matchzy_autoready_enabled'),
      matchzy_both_teams_unpause_required: await parseBooleanSetting(
        'matchzy_both_teams_unpause_required'
      ),
      matchzy_max_pauses_per_team: await parseIntSetting('matchzy_max_pauses_per_team'),
      matchzy_pause_duration: await parseIntSetting('matchzy_pause_duration'),
      matchzy_side_selection_enabled: await parseBooleanSetting('matchzy_side_selection_enabled'),
      matchzy_side_selection_time: await parseIntSetting('matchzy_side_selection_time'),
      matchzy_gg_enabled: await parseBooleanSetting('matchzy_gg_enabled'),
      matchzy_gg_threshold: await parseFloatSetting('matchzy_gg_threshold'),
      matchzy_gg_min_score_diff: await parseIntSetting('matchzy_gg_min_score_diff'),
      matchzy_ffw_enabled: await parseBooleanSetting('matchzy_ffw_enabled'),
      matchzy_ffw_time: await parseIntSetting('matchzy_ffw_time'),
      matchzy_demo_recording_enabled: await parseBooleanSetting('matchzy_demo_recording_enabled'),
    };
  }
}

export const cs2Settings = new Cs2Settings();

/** CS2's fields of the `GET /api/settings` response (`readInstanceSettings`). */
export async function readCs2InstanceSettings(): Promise<Record<string, unknown>> {
  const simulateMatches = await settingsService.isSimulationModeEnabled();
  const simulationTimescale = await settingsService.getSimulationTimescale();
  const matchzyChatPrefix = await cs2Settings.getMatchzyChatPrefix();
  const matchzyAdminChatPrefix = await cs2Settings.getMatchzyAdminChatPrefix();
  const matchzyKnifeEnabledDefault = await cs2Settings.isKnifeRoundEnabledByDefault();
  const matchzyDebugChatEnabled = await cs2Settings.isMatchzyDebugChatEnabled();
  const matchzyCore = await cs2Settings.getMatchzyCoreDefaults();

  // MatchZy Enhanced v1.3.0 settings
  const matchzyEnhanced = await cs2Settings.getMatchzyEnhancedSettings();

  return {
    simulateMatches,
    simulationTimescale,
    matchzyChatPrefix,
    matchzyAdminChatPrefix,
    matchzyKnifeEnabledDefault,
    matchzyDebugChatEnabled,
    // MatchZy core defaults
    matchzyAutostartMode: matchzyCore.autostartMode,
    matchzyMinimumReadyRequired: matchzyCore.minimumReadyRequired,
    matchzyAllowForceReady: matchzyCore.allowForceReady,
    matchzyKickWhenNoMatchLoaded: matchzyCore.kickWhenNoMatchLoaded,
    matchzyWhitelistEnabledDefault: matchzyCore.whitelistEnabledDefault,
    matchzyPauseAfterRestore: matchzyCore.pauseAfterRestore,
    matchzyStopCommandAvailable: matchzyCore.stopCommandAvailable,
    matchzyStopCommandNoDamage: matchzyCore.stopCommandNoDamage,
    matchzyUsePauseCommandForTacticalPause: matchzyCore.usePauseCommandForTacticalPause,
    matchzyHostnameFormat: matchzyCore.hostnameFormat,
    matchzyDemoPath: matchzyCore.demoPath,
    matchzyDemoNameFormat: matchzyCore.demoNameFormat,
    matchzySeriesEndKickDelayNoDemo: matchzyCore.seriesEndKickDelayNoDemo,
    matchzySeriesEndKickDelayDemoNoUpload: matchzyCore.seriesEndKickDelayDemoNoUpload,
    matchzySeriesEndKickDelayDemoUpload: matchzyCore.seriesEndKickDelayDemoUpload,
    // MatchZy Enhanced v1.3.0 settings (null = use tournament defaults)
    matchzyAutoreadyEnabled: matchzyEnhanced.matchzy_autoready_enabled,
    matchzyBothTeamsUnpauseRequired: matchzyEnhanced.matchzy_both_teams_unpause_required,
    matchzyMaxPausesPerTeam: matchzyEnhanced.matchzy_max_pauses_per_team,
    matchzyPauseDuration: matchzyEnhanced.matchzy_pause_duration,
    matchzySideSelectionEnabled: matchzyEnhanced.matchzy_side_selection_enabled,
    matchzySideSelectionTime: matchzyEnhanced.matchzy_side_selection_time,
    matchzyGgEnabled: matchzyEnhanced.matchzy_gg_enabled,
    matchzyGgThreshold: matchzyEnhanced.matchzy_gg_threshold,
    matchzyGgMinScoreDiff: matchzyEnhanced.matchzy_gg_min_score_diff,
    matchzyFfwEnabled: matchzyEnhanced.matchzy_ffw_enabled,
    matchzyFfwTime: matchzyEnhanced.matchzy_ffw_time,
    matchzyDemoRecordingEnabled: matchzyEnhanced.matchzy_demo_recording_enabled,
  };
}
