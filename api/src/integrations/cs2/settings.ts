/**
 * The CS2 instance settings: the `app_settings` keys CS2 owns (the `at_*`
 * defaults sent to servers, and the simulation switches), with how each is
 * stored (`normalize`) and edited through `PUT /api/settings`
 * (`field`, `order`, `applyRequest`). `CS2_INSTANCE_SCHEMA` is the same list
 * as JSON Schema, for `setupSchema.instance`.
 *
 * Key names, messages and the order fields are applied in are unchanged from
 * when these lived in the core settings service and route, so stored rows and
 * API clients keep working. The typed readers are `./settingsReaders`.
 *
 * Pure declarations: the settings service is imported lazily where a field
 * needs it, so loading the registry stays free of side effects.
 */

import type { JSONSchema, SettingDefinition } from '../types';
import { log } from '../../utils/logger';
import { clampSimulationTimescale } from '../../utils/simulationTimescale';
import {
  binaryRequest,
  booleanRequest,
  normalizeFlag,
  normalizeInteger,
  normalizeText,
  numberRequest,
  stringRequest,
} from '../../utils/settingFields';

export type Cs2SettingKey =
  | 'simulate_matches'
  | 'simulation_timescale'
  | 'at_chat_prefix'
  | 'at_admin_chat_prefix'
  | 'at_knife_enabled_default'
  | 'at_debug_chat'
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
  | 'at_demo_recording_enabled';

type Cs2Setting = SettingDefinition & { key: Cs2SettingKey; schema: JSONSchema };

const BOOLEAN_SCHEMA: JSONSchema = { type: 'string', enum: ['0', '1'] };

function integerSchema(minimum: number, maximum: number): JSONSchema {
  return { type: 'string', pattern: '^-?\\d+$', 'x-minimum': minimum, 'x-maximum': maximum };
}

/** An Auto Tournament CS2 on/off convar edited as a boolean. */
function flag(key: Cs2SettingKey, field: string, order: number): Cs2Setting {
  return {
    key,
    field,
    order,
    schema: BOOLEAN_SCHEMA,
    normalize: normalizeFlag(key),
    applyRequest: booleanRequest(field),
  };
}

/** A Auto Tournament CS2 on/off setting, edited as 0 / 1 / a boolean. */
function binary(key: Cs2SettingKey, field: string, order: number): Cs2Setting {
  return { ...flag(key, field, order), applyRequest: binaryRequest(field) };
}

/** An integer setting within `[min, max]`; `message` is the out-of-range error. */
function integer(
  key: Cs2SettingKey,
  field: string,
  order: number,
  range: { min: number; max: number; message: string },
  expected?: string
): Cs2Setting {
  return {
    key,
    field,
    order,
    schema: integerSchema(range.min, range.max),
    normalize: normalizeInteger(key, range),
    applyRequest: numberRequest(field, expected),
  };
}

function kickDelay(key: Cs2SettingKey, field: string, order: number): Cs2Setting {
  return integer(key, field, order, { min: 0, max: 600, message: `${key} must be 0-600 seconds` });
}

/** Simulation mode is on for "1", "true" and "yes" only (not "on" / "enabled"). */
function isSimulationValueOn(trimmed: string): boolean {
  const normalized = trimmed.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export const CS2_INSTANCE_SETTINGS: ReadonlyArray<Cs2Setting> = [
  {
    key: 'simulate_matches',
    field: 'simulateMatches',
    order: 20,
    schema: BOOLEAN_SCHEMA,
    normalize(trimmed) {
      const isEnabled = isSimulationValueOn(trimmed);
      return {
        value: isEnabled ? '1' : '0',
        message: `Simulate matches ${isEnabled ? 'enabled' : 'disabled'}`,
      };
    },
    async applyRequest(simulateMatches, ctx) {
      // This is a **developer-only** option.
      // In production, ignore it by default for safety, unless explicitly enabled
      // via AT_ENABLE_SIMULATION_IN_PROD=true (e.g. lab/test environments).
      const simulationAllowedInProd =
        process.env.AT_ENABLE_SIMULATION_IN_PROD?.toLowerCase() === 'true';
      if (process.env.NODE_ENV === 'production' && !simulationAllowedInProd) {
        log.warn(
          'Received simulateMatches setting update in production environment – ignoring for safety'
        );
        return undefined;
      }
      if (typeof simulateMatches !== 'boolean' && simulateMatches !== null) {
        return 'simulateMatches must be a boolean or null';
      }

      const value = simulateMatches === null ? null : simulateMatches === true ? '1' : '0';

      const { settingsService } = await import('../../services/settingsService');
      const wasSimulating = await settingsService.isSimulationModeEnabled();
      await ctx.set(value);

      // Tournament start and match progression only auto-veto matches while
      // simulation is on. Switching it on mid-tournament must pick up the
      // matches already waiting on a veto, or they stay stuck.
      if (!wasSimulating && simulateMatches === true) {
        await ctx.startPendingPreMatchPhases();
      }
      return undefined;
    },
  },
  {
    key: 'simulation_timescale',
    field: 'simulationTimescale',
    order: 30,
    schema: { type: 'string', 'x-minimum': 0.1, 'x-maximum': 10 },
    normalize(trimmed) {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        throw new Error('Simulation timescale must be a number');
      }
      const clamped = clampSimulationTimescale(parsed);
      return { value: String(clamped), message: `Simulation timescale updated to ${clamped}` };
    },
    async applyRequest(simulationTimescale, ctx) {
      if (typeof simulationTimescale !== 'number' && simulationTimescale !== null) {
        return 'simulationTimescale must be a number or null';
      }
      let value: string | null = null;
      if (typeof simulationTimescale === 'number' && Number.isFinite(simulationTimescale)) {
        value = String(clampSimulationTimescale(simulationTimescale));
      }
      await ctx.set(value);
      return undefined;
    },
  },
  {
    key: 'at_chat_prefix',
    field: 'atChatPrefix',
    order: 40,
    schema: { type: 'string' },
    normalize: normalizeText('Auto Tournament CS2 chat prefix updated'),
    applyRequest: stringRequest('atChatPrefix'),
  },
  {
    key: 'at_admin_chat_prefix',
    field: 'atAdminChatPrefix',
    order: 50,
    schema: { type: 'string' },
    normalize: normalizeText('Auto Tournament CS2 admin chat prefix updated'),
    applyRequest: stringRequest('atAdminChatPrefix'),
  },
  {
    ...flag('at_knife_enabled_default', 'atKnifeEnabledDefault', 60),
    normalize: normalizeFlag('Auto Tournament CS2 knife round default'),
  },
  // order 70: the core's ratingsEnabled
  {
    ...flag('at_debug_chat', 'atDebugChatEnabled', 80),
    normalize: normalizeFlag('Auto Tournament CS2 debug chat'),
  },
  // order 90: the core's allowSelfRegister
  integer('at_minimum_ready_required', 'atMinimumReadyRequired', 100, {
    min: 0,
    max: 10,
    message: 'at_minimum_ready_required must be 0-10',
  }),
  integer(
    'at_autostart_mode',
    'atAutostartMode',
    110,
    { min: 0, max: 2, message: 'at_autostart_mode must be 0, 1, or 2' },
    'a number (0-2)'
  ),
  // Auto Tournament CS2 core defaults (booleans)
  flag('at_allow_force_ready', 'atAllowForceReady', 120),
  flag('at_kick_when_no_match_loaded', 'atKickWhenNoMatchLoaded', 130),
  flag('at_whitelist_enabled_default', 'atWhitelistEnabledDefault', 140),
  flag('at_pause_after_restore', 'atPauseAfterRestore', 150),
  flag('at_stop_command_available', 'atStopCommandAvailable', 160),
  flag('at_stop_command_no_damage', 'atStopCommandNoDamage', 170),
  flag(
    'at_use_pause_command_for_tactical_pause',
    'atUsePauseCommandForTacticalPause',
    180
  ),
  // Auto Tournament CS2 core defaults (strings)
  {
    key: 'at_hostname_format',
    field: 'atHostnameFormat',
    order: 190,
    schema: { type: 'string' },
    // An empty hostname format is a real choice, not an absent one: it is how
    // Auto Tournament CS2 is told to leave the server's own `hostname` alone. Every other
    // setting folds "" to NULL and falls back to its default, which would make
    // "don't touch my hostname" indistinguishable from "never configured".
    keepEmpty: true,
    normalize(trimmed) {
      // The value is sent as `at_hostname_format "<value>"`, so an
      // embedded quote would terminate the argument and produce a malformed
      // command. Drop them on write, so what is stored is what is sent.
      const sanitized = trimmed.replace(/"/g, '');
      return {
        value: sanitized,
        message:
          sanitized === ''
            ? 'at_hostname_format cleared - servers keep their own hostname'
            : `at_hostname_format updated to ${sanitized}`,
      };
    },
    applyRequest: stringRequest('atHostnameFormat'),
  },
  {
    key: 'at_demo_path',
    field: 'atDemoPath',
    order: 200,
    schema: { type: 'string' },
    normalize(trimmed) {
      // Auto Tournament CS2 expects a path relative to csgo/ and it must end with "/".
      const normalized = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
      return { value: normalized, message: 'at_demo_path updated' };
    },
    applyRequest: stringRequest('atDemoPath'),
  },
  {
    key: 'at_demo_name_format',
    field: 'atDemoNameFormat',
    order: 210,
    schema: { type: 'string' },
    normalize: normalizeText('at_demo_name_format updated'),
    applyRequest: stringRequest('atDemoNameFormat'),
  },
  // Auto Tournament CS2 core defaults (numbers)
  kickDelay('at_series_end_kick_delay_no_demo', 'atSeriesEndKickDelayNoDemo', 220),
  kickDelay(
    'at_series_end_kick_delay_demo_no_upload',
    'atSeriesEndKickDelayDemoNoUpload',
    230
  ),
  kickDelay('at_series_end_kick_delay_demo_upload', 'atSeriesEndKickDelayDemoUpload', 240),
  // Auto Tournament CS2 v1.3.0 settings
  binary('at_autoready_enabled', 'atAutoreadyEnabled', 250),
  binary('at_both_teams_unpause_required', 'atBothTeamsUnpauseRequired', 260),
  integer('at_max_pauses_per_team', 'atMaxPausesPerTeam', 270, {
    min: 0,
    max: 999,
    message: 'at_max_pauses_per_team must be 0-999',
  }),
  integer('at_pause_duration', 'atPauseDuration', 280, {
    min: 0,
    max: 999,
    message: 'at_pause_duration must be 0-999 seconds',
  }),
  binary('at_side_selection_enabled', 'atSideSelectionEnabled', 290),
  integer('at_side_selection_time', 'atSideSelectionTime', 300, {
    min: 1,
    max: 999,
    message: 'at_side_selection_time must be 1-999 seconds',
  }),
  binary('at_gg_enabled', 'atGgEnabled', 310),
  {
    key: 'at_gg_threshold',
    field: 'atGgThreshold',
    order: 320,
    schema: { type: 'string', 'x-minimum': 0, 'x-maximum': 1 },
    normalize(trimmed) {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        throw new Error('at_gg_threshold must be 0.0-1.0');
      }
      return { value: String(parsed), message: `at_gg_threshold updated to ${parsed}` };
    },
    applyRequest: numberRequest('atGgThreshold', 'a number (0.0-1.0)'),
  },
  integer(
    'at_gg_min_score_diff',
    'atGgMinScoreDiff',
    330,
    { min: 0, max: 16, message: 'at_gg_min_score_diff must be 0-16' },
    'a number (0-16)'
  ),
  binary('at_ffw_enabled', 'atFfwEnabled', 340),
  integer('at_ffw_time', 'atFfwTime', 350, {
    min: 1,
    max: 999,
    message: 'at_ffw_time must be 1-999 seconds',
  }),
  binary('at_demo_recording_enabled', 'atDemoRecordingEnabled', 360),
];

/**
 * `setupSchema.instance`: one property per key, holding the stored string.
 * `x-minimum` / `x-maximum` document the accepted numeric range.
 */
export const CS2_INSTANCE_SCHEMA: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    CS2_INSTANCE_SETTINGS.map((setting) => [setting.key, { ...setting.schema, nullable: true }])
  ),
};
