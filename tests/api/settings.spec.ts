import { test, expect, type APIRequestContext } from '@playwright/test';
import { db } from '../../api/src/config/database';
import { getIntegration } from '../../api/src/integrations/registry';
import {
  CORE_SETTINGS,
  listSettingDefinitions,
  settingsService,
} from '../../api/src/services/settingsService';
import { CS2_INSTANCE_SCHEMA } from '../../api/src/integrations/cs2/settings';
import { clampSimulationTimescale } from '../../api/src/utils/simulationTimescale';
import { signInViaRequest } from '../helpers/auth';
import { log } from '../../api/src/utils/logger';

/**
 * 3.0 phase C, PR 11: the settings namespace. `app_settings` keys are the
 * core's (`CORE_SETTINGS`) plus the ones integrations declare
 * (`instanceSettings`; CS2: the `at_*` and simulation keys), and
 * `PUT /api/settings` applies the union.
 *
 * The first part runs without a server. The legacy settings service
 * (`setSetting`) and `PUT /api/settings` handler below are the code this
 * replaced, copied as they were, over an in-memory `app_settings`. The new
 * path, with the database calls stubbed the same way, must store the same
 * values in the same order and fail with the same messages, for every field
 * and for random multi-field bodies. The second part checks the HTTP API on
 * the running server.
 *
 * @tag api
 * @tag settings
 * @tag regression
 */

// --- legacy reference (pre-PR 11) ------------------------------------------

type Store = Map<string, string | null>;
type Write = [string, string | null];

const noopLog = {
  success: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** The pre-PR 11 settings service and PUT handler, over `store`. */
function makeLegacy(store: Store, writes: Write[], onAutoVeto: () => void) {
  const log = noopLog;
  const db = {
    async getAppSettingAsync(key: string) {
      return store.has(key) ? (store.get(key) as string | null) : null;
    },
    async setAppSettingAsync(key: string, value: string | null) {
      writes.push([key, value]);
      store.set(key, value);
    },
  };

  type AppSettingKey =
    | 'webhook_url'
    | 'simulate_matches'
    | 'simulation_timescale'
    | 'at_chat_prefix'
    | 'at_admin_chat_prefix'
    | 'at_knife_enabled_default'
    | 'at_debug_chat'
    | 'ratings_enabled'
    | 'allow_self_register'
    // Auto Tournament CS2 core defaults (persisted convars)
    | 'at_autostart_mode'
    | 'at_minimum_ready_required'
    | 'at_allow_force_ready'
    | 'at_kick_when_no_match_loaded'
    | 'at_whitelist_enabled_default'
    | 'at_pause_after_restore'
    | 'at_stop_command_available'
    | 'at_stop_command_no_damage'
    | 'at_use_pause_command_for_tactical_pause'
    | 'at_hostname_format'
    | 'at_demo_path'
    | 'at_demo_name_format'
    | 'at_series_end_kick_delay_no_demo'
    | 'at_series_end_kick_delay_demo_no_upload'
    | 'at_series_end_kick_delay_demo_upload'
    // Auto Tournament CS2 v1.3.0 settings
    | 'at_autoready_enabled'
    | 'at_both_teams_unpause_required'
    | 'at_max_pauses_per_team'
    | 'at_pause_duration'
    | 'at_side_selection_enabled'
    | 'at_side_selection_time'
    | 'at_gg_enabled'
    | 'at_gg_threshold'
    | 'at_gg_min_score_diff'
    | 'at_ffw_enabled'
    | 'at_ffw_time'
    | 'at_demo_recording_enabled'
    // IGDB (game catalogue) credentials. The secret is write-only: it is never
    // returned by any endpoint, and env (IGDB_CLIENT_ID / IGDB_CLIENT_SECRET) wins.
    | 'igdb_client_id'
    | 'igdb_client_secret';


  const ALLOWED_KEYS: AppSettingKey[] = [
    'webhook_url',
    'simulate_matches',
    'simulation_timescale',
    'at_chat_prefix',
    'at_admin_chat_prefix',
    'at_knife_enabled_default',
    'at_debug_chat',
    'ratings_enabled',
    'allow_self_register',
    // Auto Tournament CS2 core defaults (persisted convars)
    'at_autostart_mode',
    'at_minimum_ready_required',
    'at_allow_force_ready',
    'at_kick_when_no_match_loaded',
    'at_whitelist_enabled_default',
    'at_pause_after_restore',
    'at_stop_command_available',
    'at_stop_command_no_damage',
    'at_use_pause_command_for_tactical_pause',
    'at_hostname_format',
    'at_demo_path',
    'at_demo_name_format',
    'at_series_end_kick_delay_no_demo',
    'at_series_end_kick_delay_demo_no_upload',
    'at_series_end_kick_delay_demo_upload',
    // Auto Tournament CS2 v1.3.0 settings
    'at_autoready_enabled',
    'at_both_teams_unpause_required',
    'at_max_pauses_per_team',
    'at_pause_duration',
    'at_side_selection_enabled',
    'at_side_selection_time',
    'at_gg_enabled',
    'at_gg_threshold',
    'at_gg_min_score_diff',
    'at_ffw_enabled',
    'at_ffw_time',
    'at_demo_recording_enabled',
    'igdb_client_id',
    'igdb_client_secret',
  ];

  class LegacySettingsService {
    async getSetting(key: AppSettingKey): Promise<string | null> {
      if (!ALLOWED_KEYS.includes(key)) {
        throw new Error(`Unknown setting: ${key}`);
      }

      return await db.getAppSettingAsync(key);
    }

    async setSetting(key: AppSettingKey, value: string | null): Promise<void> {
      if (!ALLOWED_KEYS.includes(key)) {
        throw new Error(`Unknown setting: ${key}`);
      }

      if (value !== null) {
        const trimmed = value.trim();

        // An empty hostname format is a real choice, not an absent one: it is how
        // Auto Tournament CS2 is told to leave the server's own `hostname` alone. Every other
        // setting folds "" to NULL and falls back to its default, which would make
        // "don't touch my hostname" indistinguishable from "never configured".
        if (key === 'at_hostname_format') {
          // The value is sent as `at_hostname_format "<value>"`, so an
          // embedded quote would terminate the argument and produce a malformed
          // command. Drop them on write, so what is stored is what is sent.
          const sanitized = trimmed.replace(/"/g, '');
          await db.setAppSettingAsync(key, sanitized);
          log.success(
            sanitized === ''
              ? 'at_hostname_format cleared - servers keep their own hostname'
              : `at_hostname_format updated to ${sanitized}`
          );
          return;
        }

        if (!trimmed) {
          await db.setAppSettingAsync(key, null);
          return;
        }

        if (key === 'igdb_client_id' || key === 'igdb_client_secret') {
          await db.setAppSettingAsync(key, trimmed);
          // Never log the value.
          log.success(`${key} updated`);
          return;
        }

        if (key === 'webhook_url') {
          this.validateWebhookUrl(trimmed);
          const normalized = this.normalizeUrl(trimmed);
          await db.setAppSettingAsync(key, normalized);
          log.success(`Webhook URL updated to ${normalized}`);
          return;
        }

        if (key === 'simulate_matches') {
          const normalized = trimmed.toLowerCase();
          const isEnabled = normalized === '1' || normalized === 'true' || normalized === 'yes';
          await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
          log.success(`Simulate matches ${isEnabled ? 'enabled' : 'disabled'}`);
          return;
        }

        if (key === 'simulation_timescale') {
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed)) {
            throw new Error('Simulation timescale must be a number');
          }

          const clamped = clampSimulationTimescale(parsed);
          await db.setAppSettingAsync(key, String(clamped));
          log.success(`Simulation timescale updated to ${clamped}`);
          return;
        }

        if (key === 'at_chat_prefix' || key === 'at_admin_chat_prefix') {
          await db.setAppSettingAsync(key, trimmed);
          log.success(
            `Auto Tournament CS2 ${key === 'at_chat_prefix' ? 'chat prefix' : 'admin chat prefix'} updated`
          );
          return;
        }

        if (key === 'at_knife_enabled_default') {
          const normalized = trimmed.toLowerCase();
          const isEnabled =
            normalized === '1' ||
            normalized === 'true' ||
            normalized === 'yes' ||
            normalized === 'on' ||
            normalized === 'enabled';
          await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
          log.success(`Auto Tournament CS2 knife round default ${isEnabled ? 'enabled' : 'disabled'}`);
          return;
        }

        if (key === 'ratings_enabled') {
          const normalized = trimmed.toLowerCase();
          const isEnabled =
            normalized === '1' ||
            normalized === 'true' ||
            normalized === 'yes' ||
            normalized === 'on' ||
            normalized === 'enabled';
          await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
          log.success(`Player rating updates ${isEnabled ? 'enabled' : 'disabled'}`);
          return;
        }

        if (key === 'at_debug_chat') {
          const normalized = trimmed.toLowerCase();
          const isEnabled =
            normalized === '1' ||
            normalized === 'true' ||
            normalized === 'yes' ||
            normalized === 'on' ||
            normalized === 'enabled';
          await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
          log.success(`Auto Tournament CS2 debug chat ${isEnabled ? 'enabled' : 'disabled'}`);
          return;
        }

        if (key === 'allow_self_register') {
          const normalized = trimmed.toLowerCase();
          const isEnabled =
            normalized === '1' ||
            normalized === 'true' ||
            normalized === 'yes' ||
            normalized === 'on' ||
            normalized === 'enabled';
          await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
          log.success(`Player self‑registration ${isEnabled ? 'enabled' : 'disabled'}`);
          return;
        }

        // Auto Tournament CS2 core boolean settings (0/1)
        if (
          key === 'at_allow_force_ready' ||
          key === 'at_kick_when_no_match_loaded' ||
          key === 'at_whitelist_enabled_default' ||
          key === 'at_pause_after_restore' ||
          key === 'at_stop_command_available' ||
          key === 'at_stop_command_no_damage' ||
          key === 'at_use_pause_command_for_tactical_pause'
        ) {
          const normalized = trimmed.toLowerCase();
          const isEnabled =
            normalized === '1' ||
            normalized === 'true' ||
            normalized === 'yes' ||
            normalized === 'on' ||
            normalized === 'enabled';
          await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
          log.success(`${key} ${isEnabled ? 'enabled' : 'disabled'}`);
          return;
        }

        // Auto Tournament CS2 core integer settings
        if (
          key === 'at_autostart_mode' ||
          key === 'at_minimum_ready_required' ||
          key === 'at_series_end_kick_delay_no_demo' ||
          key === 'at_series_end_kick_delay_demo_no_upload' ||
          key === 'at_series_end_kick_delay_demo_upload'
        ) {
          const parsed = Number(trimmed);
          if (!Number.isInteger(parsed)) {
            throw new Error(`${key} must be an integer`);
          }
          if (key === 'at_autostart_mode' && (parsed < 0 || parsed > 2)) {
            throw new Error('at_autostart_mode must be 0, 1, or 2');
          }
          if (key === 'at_minimum_ready_required' && (parsed < 0 || parsed > 10)) {
            throw new Error('at_minimum_ready_required must be 0-10');
          }
          if (
            (key === 'at_series_end_kick_delay_no_demo' ||
              key === 'at_series_end_kick_delay_demo_no_upload' ||
              key === 'at_series_end_kick_delay_demo_upload') &&
            (parsed < 0 || parsed > 600)
          ) {
            throw new Error(`${key} must be 0-600 seconds`);
          }
          await db.setAppSettingAsync(key, String(parsed));
          log.success(`${key} updated to ${parsed}`);
          return;
        }

        // Auto Tournament CS2 core string settings
        if (key === 'at_demo_path') {
          // Auto Tournament CS2 expects a path relative to csgo/ and it must end with "/".
          const normalized = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
          await db.setAppSettingAsync(key, normalized);
          log.success('at_demo_path updated');
          return;
        }

        if (key === 'at_demo_name_format') {
          await db.setAppSettingAsync(key, trimmed);
          log.success('at_demo_name_format updated');
          return;
        }

        // Auto Tournament CS2 v1.3.0 boolean settings (0/1)
        if (
          key === 'at_autoready_enabled' ||
          key === 'at_both_teams_unpause_required' ||
          key === 'at_side_selection_enabled' ||
          key === 'at_gg_enabled' ||
          key === 'at_ffw_enabled' ||
          key === 'at_demo_recording_enabled'
        ) {
          const normalized = trimmed.toLowerCase();
          const isEnabled =
            normalized === '1' ||
            normalized === 'true' ||
            normalized === 'yes' ||
            normalized === 'on' ||
            normalized === 'enabled';
          await db.setAppSettingAsync(key, isEnabled ? '1' : '0');
          log.success(`${key} ${isEnabled ? 'enabled' : 'disabled'}`);
          return;
        }

        // Auto Tournament CS2 integer settings
        if (
          key === 'at_max_pauses_per_team' ||
          key === 'at_pause_duration' ||
          key === 'at_side_selection_time' ||
          key === 'at_ffw_time' ||
          key === 'at_gg_min_score_diff'
        ) {
          const parsed = Number(trimmed);
          if (!Number.isInteger(parsed)) {
            throw new Error(`${key} must be an integer`);
          }

          // Validate ranges
          if (key === 'at_max_pauses_per_team' && (parsed < 0 || parsed > 999)) {
            throw new Error('at_max_pauses_per_team must be 0-999');
          }
          if (key === 'at_pause_duration' && (parsed < 0 || parsed > 999)) {
            throw new Error('at_pause_duration must be 0-999 seconds');
          }
          if (key === 'at_side_selection_time' && (parsed < 1 || parsed > 999)) {
            throw new Error('at_side_selection_time must be 1-999 seconds');
          }
          if (key === 'at_ffw_time' && (parsed < 1 || parsed > 999)) {
            throw new Error('at_ffw_time must be 1-999 seconds');
          }
          if (key === 'at_gg_min_score_diff' && (parsed < 0 || parsed > 16)) {
            throw new Error('at_gg_min_score_diff must be 0-16');
          }

          await db.setAppSettingAsync(key, String(parsed));
          log.success(`${key} updated to ${parsed}`);
          return;
        }

        // Auto Tournament CS2 float settings
        if (key === 'at_gg_threshold') {
          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
            throw new Error('at_gg_threshold must be 0.0-1.0');
          }
          await db.setAppSettingAsync(key, String(parsed));
          log.success(`at_gg_threshold updated to ${parsed}`);
          return;
        }
      }

      await db.setAppSettingAsync(key, null);
      log.success(`Setting ${key} cleared`);
    }

    async isSimulationModeEnabled(): Promise<boolean> {
      // By default, hard-disable simulation in production for safety. It can be
      // explicitly enabled by setting AT_ENABLE_SIMULATION_IN_PROD=true in
      // the API environment (e.g. for test events or lab environments).
      if (process.env.NODE_ENV === 'production') {
        if (process.env.AT_ENABLE_SIMULATION_IN_PROD?.toLowerCase() !== 'true') {
          return false;
        }
      }

      const value = await this.getSetting('simulate_matches');
      if (!value) return false;

      const normalized = value.toLowerCase();
      return normalized === '1' || normalized === 'true' || normalized === 'yes';
    }

    private normalizeUrl(url: string): string {
      const normalized = url.replace(/\/+$/, '');
      return normalized || url;
    }

    private validateWebhookUrl(url: string): void {
      try {
        new URL(url);
      } catch {
        throw new Error(
          'Invalid webhook URL. Please provide a full URL including protocol (e.g., https://example.com)'
        );
      }
    }
  }


  const settingsService = new LegacySettingsService();
  const resolveTournamentId = (_req: unknown) => 1;
  const mapSettingsResponse = async () => 'settings';
  const startAutoVetoForRunningTournament = async (_id: number) => {
    onAutoVeto();
  };

  type Result = { status: number; body: Record<string, unknown> };
  const res = {
    status: (status: number) => ({
      json: (body: Record<string, unknown>): Result => ({ status, body }),
    }),
    json: (body: Record<string, unknown>): Result => ({ status: 200, body }),
  };

  async function put(req: { body: Record<string, unknown> }): Promise<Result> {
    const tournamentId = resolveTournamentId(req);
    const {
      webhookUrl,
      simulateMatches,
      simulationTimescale,
      atChatPrefix,
      atAdminChatPrefix,
      atKnifeEnabledDefault,
      ratingsEnabled,
      atDebugChatEnabled,
      allowSelfRegister,
      // Auto Tournament CS2 core defaults
      atAutostartMode,
      atMinimumReadyRequired,
      atAllowForceReady,
      atKickWhenNoMatchLoaded,
      atWhitelistEnabledDefault,
      atPauseAfterRestore,
      atStopCommandAvailable,
      atStopCommandNoDamage,
      atUsePauseCommandForTacticalPause,
      atHostnameFormat,
      atDemoPath,
      atDemoNameFormat,
      atSeriesEndKickDelayNoDemo,
      atSeriesEndKickDelayDemoNoUpload,
      atSeriesEndKickDelayDemoUpload,
      // Auto Tournament CS2 v1.3.0 settings
      atAutoreadyEnabled,
      atBothTeamsUnpauseRequired,
      atMaxPausesPerTeam,
      atPauseDuration,
      atSideSelectionEnabled,
      atSideSelectionTime,
      atGgEnabled,
      atGgThreshold,
      atGgMinScoreDiff,
      atFfwEnabled,
      atFfwTime,
      atDemoRecordingEnabled,
    } = req.body as {
      webhookUrl?: unknown;
      simulateMatches?: unknown;
      simulationTimescale?: unknown;
      atChatPrefix?: unknown;
      atAdminChatPrefix?: unknown;
      atKnifeEnabledDefault?: unknown;
      ratingsEnabled?: unknown;
      atDebugChatEnabled?: unknown;
      allowSelfRegister?: unknown;
      // Auto Tournament CS2 core defaults
      atAutostartMode?: unknown;
      atMinimumReadyRequired?: unknown;
      atAllowForceReady?: unknown;
      atKickWhenNoMatchLoaded?: unknown;
      atWhitelistEnabledDefault?: unknown;
      atPauseAfterRestore?: unknown;
      atStopCommandAvailable?: unknown;
      atStopCommandNoDamage?: unknown;
      atUsePauseCommandForTacticalPause?: unknown;
      atHostnameFormat?: unknown;
      atDemoPath?: unknown;
      atDemoNameFormat?: unknown;
      atSeriesEndKickDelayNoDemo?: unknown;
      atSeriesEndKickDelayDemoNoUpload?: unknown;
      atSeriesEndKickDelayDemoUpload?: unknown;
      // Auto Tournament CS2 v1.3.0 settings
      atAutoreadyEnabled?: unknown;
      atBothTeamsUnpauseRequired?: unknown;
      atMaxPausesPerTeam?: unknown;
      atPauseDuration?: unknown;
      atSideSelectionEnabled?: unknown;
      atSideSelectionTime?: unknown;
      atGgEnabled?: unknown;
      atGgThreshold?: unknown;
      atGgMinScoreDiff?: unknown;
      atFfwEnabled?: unknown;
      atFfwTime?: unknown;
      atDemoRecordingEnabled?: unknown;
    };

    try {
      if (webhookUrl !== undefined) {
        if (typeof webhookUrl !== 'string' && webhookUrl !== null) {
          return res.status(400).json({
            success: false,
            error: 'webhookUrl must be a string or null',
          });
        }
        await settingsService.setSetting(
          'webhook_url',
          typeof webhookUrl === 'string' ? webhookUrl : null
        );
      }

      if (simulateMatches !== undefined) {
        // This is a **developer-only** option.
        // In production, ignore it by default for safety, unless explicitly enabled
        // via AT_ENABLE_SIMULATION_IN_PROD=true (e.g. lab/test environments).
        const simulationAllowedInProd =
          process.env.AT_ENABLE_SIMULATION_IN_PROD?.toLowerCase() === 'true';
        if (process.env.NODE_ENV === 'production' && !simulationAllowedInProd) {
          log.warn(
            'Received simulateMatches setting update in production environment – ignoring for safety'
          );
        } else {
          if (typeof simulateMatches !== 'boolean' && simulateMatches !== null) {
            return res.status(400).json({
              success: false,
              error: 'simulateMatches must be a boolean or null',
            });
          }

          const value =
            simulateMatches === null ? null : simulateMatches === true ? '1' : '0';

          const wasSimulating = await settingsService.isSimulationModeEnabled();
          await settingsService.setSetting('simulate_matches', value);

          // Tournament start and match progression only auto-veto matches while
          // simulation is on. Switching it on mid-tournament must pick up the
          // matches already waiting on a veto, or they stay stuck.
          if (!wasSimulating && simulateMatches === true) {
            await startAutoVetoForRunningTournament(tournamentId);
          }
        }
      }

      if (simulationTimescale !== undefined) {
        if (typeof simulationTimescale !== 'number' && simulationTimescale !== null) {
          return res.status(400).json({
            success: false,
            error: 'simulationTimescale must be a number or null',
          });
        }

        let value: string | null = null;
        if (typeof simulationTimescale === 'number' && Number.isFinite(simulationTimescale)) {
          const clamped = clampSimulationTimescale(simulationTimescale);
          value = String(clamped);
        }

        await settingsService.setSetting('simulation_timescale', value);
      }

      if (atChatPrefix !== undefined) {
        if (typeof atChatPrefix !== 'string' && atChatPrefix !== null) {
          return res.status(400).json({
            success: false,
            error: 'atChatPrefix must be a string or null',
          });
        }

        await settingsService.setSetting(
          'at_chat_prefix',
          typeof atChatPrefix === 'string' ? atChatPrefix : null
        );
      }

      if (atAdminChatPrefix !== undefined) {
        if (typeof atAdminChatPrefix !== 'string' && atAdminChatPrefix !== null) {
          return res.status(400).json({
            success: false,
            error: 'atAdminChatPrefix must be a string or null',
          });
        }

        await settingsService.setSetting(
          'at_admin_chat_prefix',
          typeof atAdminChatPrefix === 'string' ? atAdminChatPrefix : null
        );
      }

      if (atKnifeEnabledDefault !== undefined) {
        if (typeof atKnifeEnabledDefault !== 'boolean' && atKnifeEnabledDefault !== null) {
          return res.status(400).json({
            success: false,
            error: 'atKnifeEnabledDefault must be a boolean or null',
          });
        }

        const value =
          atKnifeEnabledDefault === null
            ? null
            : atKnifeEnabledDefault === true
            ? '1'
            : '0';

        await settingsService.setSetting('at_knife_enabled_default', value);
      }

      if (ratingsEnabled !== undefined) {
        if (typeof ratingsEnabled !== 'boolean' && ratingsEnabled !== null) {
          return res.status(400).json({
            success: false,
            error: 'ratingsEnabled must be a boolean or null',
          });
        }

        const value =
          ratingsEnabled === null ? null : ratingsEnabled === true ? '1' : '0';

        await settingsService.setSetting('ratings_enabled', value);
      }

      if (atDebugChatEnabled !== undefined) {
        if (typeof atDebugChatEnabled !== 'boolean' && atDebugChatEnabled !== null) {
          return res.status(400).json({
            success: false,
            error: 'atDebugChatEnabled must be a boolean or null',
          });
        }

        const value =
          atDebugChatEnabled === null
            ? null
            : atDebugChatEnabled === true
            ? '1'
            : '0';

        await settingsService.setSetting('at_debug_chat', value);
      }

      if (allowSelfRegister !== undefined) {
        if (typeof allowSelfRegister !== 'boolean' && allowSelfRegister !== null) {
          return res.status(400).json({
            success: false,
            error: 'allowSelfRegister must be a boolean or null',
          });
        }

        const value =
          allowSelfRegister === null ? null : allowSelfRegister === true ? '1' : '0';

        await settingsService.setSetting('allow_self_register', value);
      }

      if (atMinimumReadyRequired !== undefined) {
        if (
          typeof atMinimumReadyRequired !== 'number' &&
          atMinimumReadyRequired !== null
        ) {
          return res.status(400).json({
            success: false,
            error: 'atMinimumReadyRequired must be a number or null',
          });
        }
        await settingsService.setSetting(
          'at_minimum_ready_required',
          atMinimumReadyRequired === null ? null : String(atMinimumReadyRequired)
        );
      }

      if (atAutostartMode !== undefined) {
        if (typeof atAutostartMode !== 'number' && atAutostartMode !== null) {
          return res.status(400).json({
            success: false,
            error: 'atAutostartMode must be a number (0-2) or null',
          });
        }
        await settingsService.setSetting(
          'at_autostart_mode',
          atAutostartMode === null ? null : String(atAutostartMode)
        );
      }

      const putBoolOrNull = async (key: Parameters<typeof settingsService.setSetting>[0], v: unknown, label: string) => {
        if (v === undefined) return;
        if (typeof v !== 'boolean' && v !== null) {
          return res.status(400).json({
            success: false,
            error: `${label} must be a boolean or null`,
          });
        }
        const value = v === null ? null : v === true ? '1' : '0';
        await settingsService.setSetting(key, value);
        return;
      };

      const putStringOrNull = async (key: Parameters<typeof settingsService.setSetting>[0], v: unknown, label: string) => {
        if (v === undefined) return;
        if (typeof v !== 'string' && v !== null) {
          return res.status(400).json({
            success: false,
            error: `${label} must be a string or null`,
          });
        }
        await settingsService.setSetting(key, typeof v === 'string' ? v : null);
        return;
      };

      const putNumberOrNull = async (key: Parameters<typeof settingsService.setSetting>[0], v: unknown, label: string) => {
        if (v === undefined) return;
        if (typeof v !== 'number' && v !== null) {
          return res.status(400).json({
            success: false,
            error: `${label} must be a number or null`,
          });
        }
        await settingsService.setSetting(key, v === null ? null : String(v));
        return;
      };

      // Auto Tournament CS2 core defaults (booleans)
      if (atAllowForceReady !== undefined) {
        const resp = await putBoolOrNull('at_allow_force_ready', atAllowForceReady, 'atAllowForceReady');
        if (resp) return resp;
      }
      if (atKickWhenNoMatchLoaded !== undefined) {
        const resp = await putBoolOrNull('at_kick_when_no_match_loaded', atKickWhenNoMatchLoaded, 'atKickWhenNoMatchLoaded');
        if (resp) return resp;
      }
      if (atWhitelistEnabledDefault !== undefined) {
        const resp = await putBoolOrNull('at_whitelist_enabled_default', atWhitelistEnabledDefault, 'atWhitelistEnabledDefault');
        if (resp) return resp;
      }
      if (atPauseAfterRestore !== undefined) {
        const resp = await putBoolOrNull('at_pause_after_restore', atPauseAfterRestore, 'atPauseAfterRestore');
        if (resp) return resp;
      }
      if (atStopCommandAvailable !== undefined) {
        const resp = await putBoolOrNull('at_stop_command_available', atStopCommandAvailable, 'atStopCommandAvailable');
        if (resp) return resp;
      }
      if (atStopCommandNoDamage !== undefined) {
        const resp = await putBoolOrNull('at_stop_command_no_damage', atStopCommandNoDamage, 'atStopCommandNoDamage');
        if (resp) return resp;
      }
      if (atUsePauseCommandForTacticalPause !== undefined) {
        const resp = await putBoolOrNull('at_use_pause_command_for_tactical_pause', atUsePauseCommandForTacticalPause, 'atUsePauseCommandForTacticalPause');
        if (resp) return resp;
      }

      // Auto Tournament CS2 core defaults (strings)
      // Note: an empty string is preserved here rather than clearing the setting.
      // "" is how Auto Tournament CS2 is told to leave the server's own hostname alone.
      if (atHostnameFormat !== undefined) {
        const resp = await putStringOrNull('at_hostname_format', atHostnameFormat, 'atHostnameFormat');
        if (resp) return resp;
      }
      if (atDemoPath !== undefined) {
        const resp = await putStringOrNull('at_demo_path', atDemoPath, 'atDemoPath');
        if (resp) return resp;
      }
      if (atDemoNameFormat !== undefined) {
        const resp = await putStringOrNull('at_demo_name_format', atDemoNameFormat, 'atDemoNameFormat');
        if (resp) return resp;
      }

      // Auto Tournament CS2 core defaults (numbers)
      if (atSeriesEndKickDelayNoDemo !== undefined) {
        const resp = await putNumberOrNull('at_series_end_kick_delay_no_demo', atSeriesEndKickDelayNoDemo, 'atSeriesEndKickDelayNoDemo');
        if (resp) return resp;
      }
      if (atSeriesEndKickDelayDemoNoUpload !== undefined) {
        const resp = await putNumberOrNull('at_series_end_kick_delay_demo_no_upload', atSeriesEndKickDelayDemoNoUpload, 'atSeriesEndKickDelayDemoNoUpload');
        if (resp) return resp;
      }
      if (atSeriesEndKickDelayDemoUpload !== undefined) {
        const resp = await putNumberOrNull('at_series_end_kick_delay_demo_upload', atSeriesEndKickDelayDemoUpload, 'atSeriesEndKickDelayDemoUpload');
        if (resp) return resp;
      }

      // Auto Tournament CS2 v1.3.0 settings
      if (atAutoreadyEnabled !== undefined) {
        if (
          typeof atAutoreadyEnabled !== 'number' &&
          typeof atAutoreadyEnabled !== 'boolean' &&
          atAutoreadyEnabled !== null
        ) {
          return res.status(400).json({
            success: false,
            error: 'atAutoreadyEnabled must be 0, 1, boolean, or null',
          });
        }
        const value =
          atAutoreadyEnabled === null
            ? null
            : atAutoreadyEnabled === true || atAutoreadyEnabled === 1
            ? '1'
            : '0';
        await settingsService.setSetting('at_autoready_enabled', value);
      }

      if (atBothTeamsUnpauseRequired !== undefined) {
        if (
          typeof atBothTeamsUnpauseRequired !== 'number' &&
          typeof atBothTeamsUnpauseRequired !== 'boolean' &&
          atBothTeamsUnpauseRequired !== null
        ) {
          return res.status(400).json({
            success: false,
            error: 'atBothTeamsUnpauseRequired must be 0, 1, boolean, or null',
          });
        }
        const value =
          atBothTeamsUnpauseRequired === null
            ? null
            : atBothTeamsUnpauseRequired === true || atBothTeamsUnpauseRequired === 1
            ? '1'
            : '0';
        await settingsService.setSetting('at_both_teams_unpause_required', value);
      }

      if (atMaxPausesPerTeam !== undefined) {
        if (
          typeof atMaxPausesPerTeam !== 'number' &&
          atMaxPausesPerTeam !== null
        ) {
          return res.status(400).json({
            success: false,
            error: 'atMaxPausesPerTeam must be a number or null',
          });
        }
        await settingsService.setSetting(
          'at_max_pauses_per_team',
          atMaxPausesPerTeam === null ? null : String(atMaxPausesPerTeam)
        );
      }

      if (atPauseDuration !== undefined) {
        if (typeof atPauseDuration !== 'number' && atPauseDuration !== null) {
          return res.status(400).json({
            success: false,
            error: 'atPauseDuration must be a number or null',
          });
        }
        await settingsService.setSetting(
          'at_pause_duration',
          atPauseDuration === null ? null : String(atPauseDuration)
        );
      }

      if (atSideSelectionEnabled !== undefined) {
        if (
          typeof atSideSelectionEnabled !== 'number' &&
          typeof atSideSelectionEnabled !== 'boolean' &&
          atSideSelectionEnabled !== null
        ) {
          return res.status(400).json({
            success: false,
            error: 'atSideSelectionEnabled must be 0, 1, boolean, or null',
          });
        }
        const value =
          atSideSelectionEnabled === null
            ? null
            : atSideSelectionEnabled === true || atSideSelectionEnabled === 1
            ? '1'
            : '0';
        await settingsService.setSetting('at_side_selection_enabled', value);
      }

      if (atSideSelectionTime !== undefined) {
        if (
          typeof atSideSelectionTime !== 'number' &&
          atSideSelectionTime !== null
        ) {
          return res.status(400).json({
            success: false,
            error: 'atSideSelectionTime must be a number or null',
          });
        }
        await settingsService.setSetting(
          'at_side_selection_time',
          atSideSelectionTime === null ? null : String(atSideSelectionTime)
        );
      }

      if (atGgEnabled !== undefined) {
        if (
          typeof atGgEnabled !== 'number' &&
          typeof atGgEnabled !== 'boolean' &&
          atGgEnabled !== null
        ) {
          return res.status(400).json({
            success: false,
            error: 'atGgEnabled must be 0, 1, boolean, or null',
          });
        }
        const value =
          atGgEnabled === null
            ? null
            : atGgEnabled === true || atGgEnabled === 1
            ? '1'
            : '0';
        await settingsService.setSetting('at_gg_enabled', value);
      }

      if (atGgThreshold !== undefined) {
        if (typeof atGgThreshold !== 'number' && atGgThreshold !== null) {
          return res.status(400).json({
            success: false,
            error: 'atGgThreshold must be a number (0.0-1.0) or null',
          });
        }
        await settingsService.setSetting(
          'at_gg_threshold',
          atGgThreshold === null ? null : String(atGgThreshold)
        );
      }

      if (atGgMinScoreDiff !== undefined) {
        if (typeof atGgMinScoreDiff !== 'number' && atGgMinScoreDiff !== null) {
          return res.status(400).json({
            success: false,
            error: 'atGgMinScoreDiff must be a number (0-16) or null',
          });
        }
        await settingsService.setSetting(
          'at_gg_min_score_diff',
          atGgMinScoreDiff === null ? null : String(atGgMinScoreDiff)
        );
      }

      if (atFfwEnabled !== undefined) {
        if (
          typeof atFfwEnabled !== 'number' &&
          typeof atFfwEnabled !== 'boolean' &&
          atFfwEnabled !== null
        ) {
          return res.status(400).json({
            success: false,
            error: 'atFfwEnabled must be 0, 1, boolean, or null',
          });
        }
        const value =
          atFfwEnabled === null
            ? null
            : atFfwEnabled === true || atFfwEnabled === 1
            ? '1'
            : '0';
        await settingsService.setSetting('at_ffw_enabled', value);
      }

      if (atFfwTime !== undefined) {
        if (typeof atFfwTime !== 'number' && atFfwTime !== null) {
          return res.status(400).json({
            success: false,
            error: 'atFfwTime must be a number or null',
          });
        }
        await settingsService.setSetting(
          'at_ffw_time',
          atFfwTime === null ? null : String(atFfwTime)
        );
      }

      if (atDemoRecordingEnabled !== undefined) {
        if (
          typeof atDemoRecordingEnabled !== 'number' &&
          typeof atDemoRecordingEnabled !== 'boolean' &&
          atDemoRecordingEnabled !== null
        ) {
          return res.status(400).json({
            success: false,
            error: 'atDemoRecordingEnabled must be 0, 1, boolean, or null',
          });
        }
        const value =
          atDemoRecordingEnabled === null
            ? null
            : atDemoRecordingEnabled === true || atDemoRecordingEnabled === 1
            ? '1'
            : '0';
        await settingsService.setSetting('at_demo_recording_enabled', value);
      }

      return res.json({
        success: true,
        settings: await mapSettingsResponse(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update settings';
      log.error('Failed to update settings', error);
      return res.status(400).json({
        success: false,
        error: message,
      });
    }
  }

  return { put, ALLOWED_KEYS };
}

// --- harness -----------------------------------------------------------------

interface Outcome {
  status: number;
  error?: string;
  writes: Write[];
  autoVeto: number;
  store: Record<string, string | null>;
}

async function runLegacy(initial: Record<string, string | null>, body: Record<string, unknown>) {
  const store: Store = new Map(Object.entries(initial));
  const writes: Write[] = [];
  let autoVeto = 0;
  const legacy = makeLegacy(store, writes, () => {
    autoVeto += 1;
  });
  const result = await legacy.put({ body });
  return {
    status: result.status,
    error: result.body.error as string | undefined,
    writes,
    autoVeto,
    store: Object.fromEntries(store),
  } satisfies Outcome;
}

/** The new path: `settingsService.applyUpdate`, with the route's status mapping. */
async function runNew(initial: Record<string, string | null>, body: Record<string, unknown>) {
  const store: Store = new Map(Object.entries(initial));
  const writes: Write[] = [];
  let autoVeto = 0;
  const stubbed = db as unknown as Record<string, unknown>;
  const saved = {
    get: stubbed.getAppSettingAsync,
    set: stubbed.setAppSettingAsync,
  };
  stubbed.getAppSettingAsync = async (key: string) =>
    store.has(key) ? (store.get(key) as string | null) : null;
  stubbed.setAppSettingAsync = async (key: string, value: string | null) => {
    writes.push([key, value]);
    store.set(key, value);
  };
  const quiet = log as unknown as Record<string, unknown>;
  const savedLog = { success: quiet.success, warn: quiet.warn, error: quiet.error };
  Object.assign(quiet, noopLog);
  let status = 200;
  let error: string | undefined;
  try {
    error = await settingsService.applyUpdate(body, {
      tournamentId: 1,
      startPendingPreMatchPhases: async () => {
        autoVeto += 1;
      },
    });
    if (error) status = 400;
  } catch (err) {
    status = 400;
    error = err instanceof Error ? err.message : 'Failed to update settings';
  } finally {
    stubbed.getAppSettingAsync = saved.get;
    stubbed.setAppSettingAsync = saved.set;
    Object.assign(quiet, savedLog);
  }
  return { status, error, writes, autoVeto, store: Object.fromEntries(store) } satisfies Outcome;
}

/** Every `PUT /api/settings` field, in the legacy handler's order. */
const LEGACY_FIELDS = [
  'webhookUrl',
  'simulateMatches',
  'simulationTimescale',
  'atChatPrefix',
  'atAdminChatPrefix',
  'atKnifeEnabledDefault',
  'ratingsEnabled',
  'atDebugChatEnabled',
  'allowSelfRegister',
  'atMinimumReadyRequired',
  'atAutostartMode',
  'atAllowForceReady',
  'atKickWhenNoMatchLoaded',
  'atWhitelistEnabledDefault',
  'atPauseAfterRestore',
  'atStopCommandAvailable',
  'atStopCommandNoDamage',
  'atUsePauseCommandForTacticalPause',
  'atHostnameFormat',
  'atDemoPath',
  'atDemoNameFormat',
  'atSeriesEndKickDelayNoDemo',
  'atSeriesEndKickDelayDemoNoUpload',
  'atSeriesEndKickDelayDemoUpload',
  'atAutoreadyEnabled',
  'atBothTeamsUnpauseRequired',
  'atMaxPausesPerTeam',
  'atPauseDuration',
  'atSideSelectionEnabled',
  'atSideSelectionTime',
  'atGgEnabled',
  'atGgThreshold',
  'atGgMinScoreDiff',
  'atFfwEnabled',
  'atFfwTime',
  'atDemoRecordingEnabled',
];

const SAMPLE_VALUES: unknown[] = [
  null,
  true,
  false,
  0,
  1,
  2,
  -1,
  3,
  5,
  10,
  11,
  16,
  17,
  0.5,
  1.5,
  0.05,
  25,
  600,
  601,
  999,
  1000,
  '',
  '   ',
  'abc',
  ' 7 ',
  '1',
  'true',
  'Yes',
  'on',
  'enabled',
  'off',
  '0.3',
  'Auto Tournament CS2',
  'demos/',
  '  "quoted" {TEAM1}  ',
  'https://example.com/',
  'https://example.com///',
  'not a url',
  [],
  {},
];

/** Stored values a request can start from (reads matter for simulation). */
const INITIAL_STORES: Array<Record<string, string | null>> = [
  {},
  { simulate_matches: '1' },
  { simulate_matches: '0', at_hostname_format: 'x' },
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function compare(initial: Record<string, string | null>, body: Record<string, unknown>) {
  const legacy = await runLegacy(initial, body);
  const next = await runNew(initial, body);
  expect(next, JSON.stringify({ initial, body })).toEqual(legacy);
}

// --- tests -------------------------------------------------------------------

test.describe('settings namespace', () => {
  test('the store accepts exactly the legacy keys, core plus CS2', async () => {
    const legacy = makeLegacy(new Map(), [], () => undefined);
    const keys = (await listSettingDefinitions()).map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...legacy.ALLOWED_KEYS].sort());

    const cs2 = getIntegration('cs2');
    const cs2Keys = (cs2.instanceSettings ?? []).map((definition) => definition.key);
    const coreKeys = CORE_SETTINGS.map((definition) => definition.key);
    expect(coreKeys.filter((key) => cs2Keys.includes(key))).toEqual([]);
    for (const key of cs2Keys) {
      expect(key.startsWith('at_') || key.startsWith('simulat'), key).toBe(true);
    }
    expect(coreKeys.some((key) => key.startsWith('at_'))).toBe(false);

    // setupSchema.instance declares the same keys.
    expect(cs2.setupSchema?.instance).toBe(CS2_INSTANCE_SCHEMA);
    expect(Object.keys(CS2_INSTANCE_SCHEMA.properties as object).sort()).toEqual(
      [...cs2Keys].sort()
    );
  });

  test('the PUT fields are the legacy ones, applied in the legacy order', async () => {
    const fields = (await listSettingDefinitions())
      .filter((definition) => definition.field && definition.applyRequest)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((definition) => definition.field);
    expect(fields).toEqual(LEGACY_FIELDS);
  });

  test('unknown keys are rejected as before', async () => {
    await expect(settingsService.getSetting('not_a_setting')).rejects.toThrow(
      'Unknown setting: not_a_setting'
    );
    await expect(settingsService.setSetting('not_a_setting', 'x')).rejects.toThrow(
      'Unknown setting: not_a_setting'
    );
  });

  test('every field stores and rejects exactly as the legacy handler', async () => {
    for (const initial of INITIAL_STORES) {
      for (const field of LEGACY_FIELDS) {
        for (const value of SAMPLE_VALUES) {
          await compare(initial, { [field]: value });
        }
      }
    }
  });

  test('random multi-field bodies store the same values in the same order', async () => {
    const random = mulberry32(11);
    for (let i = 0; i < 1500; i++) {
      const body: Record<string, unknown> = {};
      const count = 1 + Math.floor(random() * 8);
      for (let j = 0; j < count; j++) {
        const field = LEGACY_FIELDS[Math.floor(random() * LEGACY_FIELDS.length)];
        body[field] = SAMPLE_VALUES[Math.floor(random() * SAMPLE_VALUES.length)];
      }
      if (random() < 0.2) body.unrelatedField = 'ignored';
      await compare(INITIAL_STORES[i % INITIAL_STORES.length], body);
    }
  });

  test('simulation stays ignored in production unless allowed', async () => {
    const saved = {
      nodeEnv: process.env.NODE_ENV,
      allow: process.env.AT_ENABLE_SIMULATION_IN_PROD,
    };
    try {
      process.env.NODE_ENV = 'production';
      for (const allow of [undefined, 'true', 'false']) {
        if (allow === undefined) delete process.env.AT_ENABLE_SIMULATION_IN_PROD;
        else process.env.AT_ENABLE_SIMULATION_IN_PROD = allow;
        for (const value of SAMPLE_VALUES) {
          await compare({}, { simulateMatches: value, atChatPrefix: 'x' });
          await compare({ simulate_matches: '1' }, { simulateMatches: value });
        }
      }
    } finally {
      if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved.nodeEnv;
      if (saved.allow === undefined) delete process.env.AT_ENABLE_SIMULATION_IN_PROD;
      else process.env.AT_ENABLE_SIMULATION_IN_PROD = saved.allow;
    }
  });
});

// --- HTTP ----------------------------------------------------------------------

/** Every field of the legacy `GET /api/settings` response. */
const LEGACY_RESPONSE_FIELDS = [
  'webhookUrl',
  'steamApiKey',
  'steamApiKeySet',
  'webhookConfigured',
  'defaultPlayerElo',
  ...LEGACY_FIELDS.filter((field) => field !== 'webhookUrl'),
];

async function getSettings(request: APIRequestContext) {
  const response = await request.get('/api/settings');
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { settings: Record<string, unknown> }).settings;
}

test.describe('settings API', () => {
  test.beforeEach(async ({ request }) => {
    await signInViaRequest(request);
  });

  test('GET returns the legacy fields', async ({ request }) => {
    const settings = await getSettings(request);
    expect(Object.keys(settings).sort()).toEqual([...LEGACY_RESPONSE_FIELDS].sort());
    expect(settings.steamApiKey).toBeNull();
    expect(settings.defaultPlayerElo).toBeNull();
  });

  test('PUT stores integration fields, rejects bad types, and returns the settings', async ({
    request,
  }) => {
    const before = await getSettings(request);
    try {
      const ok = await request.put('/api/settings', {
        data: { atGgThreshold: 0.4, atFfwTime: 30 },
      });
      expect(ok.status(), await ok.text()).toBe(200);
      const saved = ((await ok.json()) as { settings: Record<string, unknown> }).settings;
      expect(saved.atGgThreshold).toBe(0.4);
      expect(saved.atFfwTime).toBe(30);

      const badType = await request.put('/api/settings', {
        data: { atGgThreshold: 'high' },
      });
      expect(badType.status()).toBe(400);
      expect(await badType.json()).toEqual({
        success: false,
        error: 'atGgThreshold must be a number (0.0-1.0) or null',
      });

      const outOfRange = await request.put('/api/settings', {
        data: { atFfwTime: 0 },
      });
      expect(outOfRange.status()).toBe(400);
      expect(await outOfRange.json()).toEqual({
        success: false,
        error: 'at_ffw_time must be 1-999 seconds',
      });
    } finally {
      await request.put('/api/settings', {
        data: {
          atGgThreshold: before.atGgThreshold ?? null,
          atFfwTime: before.atFfwTime ?? null,
        },
      });
    }
  });
});
