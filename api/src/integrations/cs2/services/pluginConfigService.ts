import type { TournamentType } from '../../../types/tournament.types';
import { log } from '../../../utils/logger';
import { cs2Settings } from '../settingsReaders';

/**
 * Auto Tournament CS2 v1.3.0 Configuration Service
 *
 * Generates Auto Tournament CS2 cvars for match configs.
 *
 * Important: We intentionally include a baseline set of Auto Tournament CS2 cvars
 * even when the MAT Settings page does not define any overrides. This ensures
 * all matches and servers follow the same configuration (useful when servers
 * have stale persistent config or are running with drift).
 */

export interface AtEnhancedCvars {
  // Auto-Ready System
  at_autoready_enabled?: 0 | 1;
  
  // Pause System
  at_both_teams_unpause_required?: 0 | 1;
  at_max_pauses_per_team?: number;
  at_pause_duration?: number;
  
  // Side Selection Timer
  at_side_selection_enabled?: 0 | 1;
  at_side_selection_time?: number;
  
  // Early Match Termination (.gg)
  at_gg_enabled?: 0 | 1;
  at_gg_threshold?: number;
  at_gg_min_score_diff?: number; // Minimum score difference required for .gg (0 = disabled)
  
  // Forfeit/Walkover System
  at_ffw_enabled?: 0 | 1;
  at_ffw_time?: number;
  
  // Demo Recording
  at_demo_recording_enabled?: 0 | 1;
}

/**
 * Baseline defaults aligned with Auto Tournament CS2 plugin defaults.
 * These match the defaults documented in the plugin's shipped config.
 */
const DEFAULT_AT_ENHANCED_CVARS: AtEnhancedCvars = {
  // READY / AUTO-READY
  at_autoready_enabled: 0,

  // PAUSES
  at_both_teams_unpause_required: 1,
  at_max_pauses_per_team: 0,
  at_pause_duration: 0,

  // ENHANCED FEATURES
  at_side_selection_enabled: 1,
  at_side_selection_time: 60,

  // .gg
  at_gg_enabled: 0,
  at_gg_threshold: 0.8,
  at_gg_min_score_diff: 0,

  // FFW
  at_ffw_enabled: 0,
  at_ffw_time: 240,

  // DEMOS
  at_demo_recording_enabled: 1,
};

/**
 * Generate Auto Tournament CS2 cvars for a tournament
 * Loads global settings from SettingsService and uses them as overrides.
 */
export async function generateAtEnhancedCvars(
  tournamentType: TournamentType,
  overrides?: Partial<AtEnhancedCvars>
): Promise<AtEnhancedCvars> {
  // Load global settings from SettingsService (only non-null values override)
  const globalSettings = await cs2Settings.getAtEnhancedSettings();
  const globalOverrides: Partial<AtEnhancedCvars> = {};
  
  // Only include non-null global settings as overrides
  if (globalSettings.at_autoready_enabled !== null) {
    globalOverrides.at_autoready_enabled = globalSettings.at_autoready_enabled;
  }
  if (globalSettings.at_both_teams_unpause_required !== null) {
    globalOverrides.at_both_teams_unpause_required = globalSettings.at_both_teams_unpause_required;
  }
  if (globalSettings.at_max_pauses_per_team !== null) {
    globalOverrides.at_max_pauses_per_team = globalSettings.at_max_pauses_per_team;
  }
  if (globalSettings.at_pause_duration !== null) {
    globalOverrides.at_pause_duration = globalSettings.at_pause_duration;
  }
  if (globalSettings.at_side_selection_enabled !== null) {
    globalOverrides.at_side_selection_enabled = globalSettings.at_side_selection_enabled;
  }
  if (globalSettings.at_side_selection_time !== null) {
    globalOverrides.at_side_selection_time = globalSettings.at_side_selection_time;
  }
  if (globalSettings.at_gg_enabled !== null) {
    globalOverrides.at_gg_enabled = globalSettings.at_gg_enabled;
  }
  if (globalSettings.at_gg_threshold !== null) {
    globalOverrides.at_gg_threshold = globalSettings.at_gg_threshold;
  }
  if (globalSettings.at_gg_min_score_diff !== null) {
    globalOverrides.at_gg_min_score_diff = globalSettings.at_gg_min_score_diff;
  }
  if (globalSettings.at_ffw_enabled !== null) {
    globalOverrides.at_ffw_enabled = globalSettings.at_ffw_enabled;
  }
  if (globalSettings.at_ffw_time !== null) {
    globalOverrides.at_ffw_time = globalSettings.at_ffw_time;
  }
  if (globalSettings.at_demo_recording_enabled !== null) {
    globalOverrides.at_demo_recording_enabled = globalSettings.at_demo_recording_enabled;
  }
  
  // Apply overrides: baseline defaults -> global settings -> explicit overrides
  const config = {
    ...DEFAULT_AT_ENHANCED_CVARS,
    ...globalOverrides,
    ...overrides, // Explicit overrides take precedence
  };
  
  log.debug('Generated Auto Tournament CS2 cvars', {
    tournamentType,
    globalOverrides: Object.keys(globalOverrides).length > 0 ? globalOverrides : undefined,
    config,
  });
  
  return config;
}

/**
 * Get default cvars (backward compatible - all features disabled/unlimited)
 */
export function getDefaultAtEnhancedCvars(): AtEnhancedCvars {
  return DEFAULT_AT_ENHANCED_CVARS;
}

/**
 * Validate Auto Tournament CS2 cvars
 */
export function validateAtEnhancedCvars(
  cvars: Partial<AtEnhancedCvars>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate boolean values (0 or 1)
  const booleanFields: (keyof AtEnhancedCvars)[] = [
    'at_autoready_enabled',
    'at_both_teams_unpause_required',
    'at_side_selection_enabled',
    'at_gg_enabled',
    'at_ffw_enabled',
    'at_demo_recording_enabled',
  ];
  
  for (const field of booleanFields) {
    const value = cvars[field];
    if (value !== undefined && value !== 0 && value !== 1) {
      errors.push(`${field} must be 0 or 1, got ${value}`);
    }
  }
  
  // Validate numeric ranges
  if (cvars.at_max_pauses_per_team !== undefined) {
    const val = cvars.at_max_pauses_per_team;
    if (!Number.isInteger(val) || val < 0 || val > 999) {
      errors.push(`at_max_pauses_per_team must be 0-999, got ${val}`);
    }
  }
  
  if (cvars.at_pause_duration !== undefined) {
    const val = cvars.at_pause_duration;
    if (!Number.isInteger(val) || val < 0 || val > 999) {
      errors.push(`at_pause_duration must be 0-999 seconds, got ${val}`);
    }
  }
  
  if (cvars.at_side_selection_time !== undefined) {
    const val = cvars.at_side_selection_time;
    if (!Number.isInteger(val) || val < 1 || val > 999) {
      errors.push(`at_side_selection_time must be 1-999 seconds, got ${val}`);
    }
  }
  
  if (cvars.at_gg_threshold !== undefined) {
    const val = cvars.at_gg_threshold;
    if (typeof val !== 'number' || val < 0 || val > 1) {
      errors.push(`at_gg_threshold must be 0.0-1.0, got ${val}`);
    }
  }
  
  if (cvars.at_gg_min_score_diff !== undefined) {
    const val = cvars.at_gg_min_score_diff;
    if (!Number.isInteger(val) || val < 0 || val > 16) {
      errors.push(`at_gg_min_score_diff must be 0-16, got ${val}`);
    }
  }
  
  if (cvars.at_ffw_time !== undefined) {
    const val = cvars.at_ffw_time;
    if (!Number.isInteger(val) || val < 1 || val > 999) {
      errors.push(`at_ffw_time must be 1-999 seconds, got ${val}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

export const pluginConfigService = {
  generateAtEnhancedCvars,
  getDefaultAtEnhancedCvars,
  validateAtEnhancedCvars,
};
