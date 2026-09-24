/**
 * Typed readers for the CS2 instance settings (./settings), with the Auto Tournament CS2
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

  async getAtChatPrefix(): Promise<string | null> {
    const value = await this.getSetting('at_chat_prefix');
    const trimmed = value ? value.trim() : '';
    // Default to a sensible prefix if none is configured explicitly
    return trimmed !== '' ? trimmed : '[{Green}Auto Tournament{Default}]';
  }

  async getAtAdminChatPrefix(): Promise<string | null> {
    const value = await this.getSetting('at_admin_chat_prefix');
    const trimmed = value ? value.trim() : '';
    // Default to a sensible admin prefix if none is configured explicitly
    return trimmed !== '' ? trimmed : '[{Red}ADMIN{Default}]';
  }

  async isAtDebugChatEnabled(): Promise<boolean> {
    const value = await this.getSetting('at_debug_chat');
    if (!value) {
      // Explicit default: debug chat off unless enabled.
      return false;
    }
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isKnifeRoundEnabledByDefault(): Promise<boolean> {
    const value = await this.getSetting('at_knife_enabled_default');
    if (!value) {
      // Defer to Auto Tournament CS2 plugin defaults when not explicitly configured
      return true;
    }

    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async getAtMinimumReadyRequired(): Promise<number> {
    const value = await this.getSetting('at_minimum_ready_required');
    if (!value) return 0; // Auto Tournament CS2 default (0 = everyone connected must ready)
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 0;
    return parsed;
  }

  async getAtAutostartMode(): Promise<0 | 1 | 2> {
    const value = await this.getSetting('at_autostart_mode');
    if (!value) return 1; // Auto Tournament CS2 default
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 2) return 1;
    return parsed as 0 | 1 | 2;
  }

  async isAtAllowForceReadyEnabled(): Promise<boolean> {
    const value = await this.getSetting('at_allow_force_ready');
    if (!value) return true; // Auto Tournament CS2 default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isAtKickWhenNoMatchLoadedEnabled(): Promise<boolean> {
    const value = await this.getSetting('at_kick_when_no_match_loaded');
    if (!value) return false; // Auto Tournament CS2 default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isAtWhitelistEnabledDefault(): Promise<boolean> {
    const value = await this.getSetting('at_whitelist_enabled_default');
    if (!value) return false; // Auto Tournament CS2 default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isAtPauseAfterRestoreEnabled(): Promise<boolean> {
    const value = await this.getSetting('at_pause_after_restore');
    if (!value) return true; // Auto Tournament CS2 default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isAtStopCommandAvailable(): Promise<boolean> {
    const value = await this.getSetting('at_stop_command_available');
    if (!value) return false; // Auto Tournament CS2 default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isAtStopCommandNoDamage(): Promise<boolean> {
    const value = await this.getSetting('at_stop_command_no_damage');
    if (!value) return false; // Auto Tournament CS2 default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  async isAtUsePauseCommandForTacticalPause(): Promise<boolean> {
    const value = await this.getSetting('at_use_pause_command_for_tactical_pause');
    if (!value) return false; // Auto Tournament CS2 default
    const normalized = value.toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  /**
   * Hostname format Auto Tournament CS2 applies when a match loads.
   *
   * Returns `''` when the operator has explicitly cleared it, which tells the
   * plugin to leave the server's own `hostname` (from server.cfg) untouched.
   * A missing row means "never configured", which keeps Auto Tournament CS2's own default.
   * The two are deliberately distinct — see `setSetting`.
   */
  async getAtHostnameFormat(): Promise<string> {
    const value = await this.getSetting('at_hostname_format');
    if (value === null) return '{TEAM1} vs {TEAM2}'; // Auto Tournament CS2 default
    return value.trim();
  }

  async getAtDemoPath(): Promise<string> {
    const value = await this.getSetting('at_demo_path');
    if (!value) return 'AutoTournamentCS2/'; // default folder, relative to csgo/
    const trimmed = value.trim();
    if (!trimmed) return 'AutoTournamentCS2/';
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }

  async getAtDemoNameFormat(): Promise<string> {
    const value = await this.getSetting('at_demo_name_format');
    if (!value) return '{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}'; // Auto Tournament CS2 default
    const trimmed = value.trim();
    return trimmed !== '' ? trimmed : '{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}';
  }

  async getAtSeriesEndKickDelayNoDemo(): Promise<number> {
    const value = await this.getSetting('at_series_end_kick_delay_no_demo');
    if (!value) return 5; // Auto Tournament CS2 default
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 5;
    return parsed;
  }

  async getAtSeriesEndKickDelayDemoNoUpload(): Promise<number> {
    const value = await this.getSetting('at_series_end_kick_delay_demo_no_upload');
    if (!value) return 10; // Auto Tournament CS2 default
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 10;
    return parsed;
  }

  async getAtSeriesEndKickDelayDemoUpload(): Promise<number> {
    const value = await this.getSetting('at_series_end_kick_delay_demo_upload');
    if (!value) return 60; // Auto Tournament CS2 default
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 60;
    return parsed;
  }

  async getAtCoreDefaults(): Promise<{
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
      this.getAtAutostartMode(),
      this.getAtMinimumReadyRequired(),
      this.isAtAllowForceReadyEnabled(),
      this.isAtKickWhenNoMatchLoadedEnabled(),
      this.isAtWhitelistEnabledDefault(),
      this.isAtPauseAfterRestoreEnabled(),
      this.isAtStopCommandAvailable(),
      this.isAtStopCommandNoDamage(),
      this.isAtUsePauseCommandForTacticalPause(),
      this.getAtHostnameFormat(),
      this.getAtDemoPath(),
      this.getAtDemoNameFormat(),
      this.getAtSeriesEndKickDelayNoDemo(),
      this.getAtSeriesEndKickDelayDemoNoUpload(),
      this.getAtSeriesEndKickDelayDemoUpload(),
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
   * Get Auto Tournament CS2 v1.3.0 global configuration overrides.
   * Returns null for any setting that is not explicitly configured (use tournament defaults).
   */
  async getAtEnhancedSettings(): Promise<{
    at_autoready_enabled: 0 | 1 | null;
    at_both_teams_unpause_required: 0 | 1 | null;
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
      at_both_teams_unpause_required: await parseBooleanSetting(
        'at_both_teams_unpause_required'
      ),
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
  const atChatPrefix = await cs2Settings.getAtChatPrefix();
  const atAdminChatPrefix = await cs2Settings.getAtAdminChatPrefix();
  const atKnifeEnabledDefault = await cs2Settings.isKnifeRoundEnabledByDefault();
  const atDebugChatEnabled = await cs2Settings.isAtDebugChatEnabled();
  const atCore = await cs2Settings.getAtCoreDefaults();

  // Auto Tournament CS2 v1.3.0 settings
  const atEnhanced = await cs2Settings.getAtEnhancedSettings();

  return {
    simulateMatches,
    simulationTimescale,
    atChatPrefix,
    atAdminChatPrefix,
    atKnifeEnabledDefault,
    atDebugChatEnabled,
    // Auto Tournament CS2 core defaults
    atAutostartMode: atCore.autostartMode,
    atMinimumReadyRequired: atCore.minimumReadyRequired,
    atAllowForceReady: atCore.allowForceReady,
    atKickWhenNoMatchLoaded: atCore.kickWhenNoMatchLoaded,
    atWhitelistEnabledDefault: atCore.whitelistEnabledDefault,
    atPauseAfterRestore: atCore.pauseAfterRestore,
    atStopCommandAvailable: atCore.stopCommandAvailable,
    atStopCommandNoDamage: atCore.stopCommandNoDamage,
    atUsePauseCommandForTacticalPause: atCore.usePauseCommandForTacticalPause,
    atHostnameFormat: atCore.hostnameFormat,
    atDemoPath: atCore.demoPath,
    atDemoNameFormat: atCore.demoNameFormat,
    atSeriesEndKickDelayNoDemo: atCore.seriesEndKickDelayNoDemo,
    atSeriesEndKickDelayDemoNoUpload: atCore.seriesEndKickDelayDemoNoUpload,
    atSeriesEndKickDelayDemoUpload: atCore.seriesEndKickDelayDemoUpload,
    // Auto Tournament CS2 v1.3.0 settings (null = use tournament defaults)
    atAutoreadyEnabled: atEnhanced.at_autoready_enabled,
    atBothTeamsUnpauseRequired: atEnhanced.at_both_teams_unpause_required,
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
  };
}
