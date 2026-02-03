import type { TournamentType } from '../types/tournament.types';
import { log } from '../utils/logger';
import { settingsService } from './settingsService';

/**
 * MatchZy Enhanced v1.3.0 Configuration Service
 *
 * Generates MatchZy Enhanced cvars for match configs.
 *
 * Important: We intentionally include a baseline set of MatchZy Enhanced cvars
 * even when the MAT Settings page does not define any overrides. This ensures
 * all matches and servers follow the same configuration (useful when servers
 * have stale persistent config or are running with drift).
 */

export interface MatchzyEnhancedCvars {
  // Auto-Ready System
  matchzy_autoready_enabled?: 0 | 1;
  
  // Pause System
  matchzy_both_teams_unpause_required?: 0 | 1;
  matchzy_max_pauses_per_team?: number;
  matchzy_pause_duration?: number;
  
  // Side Selection Timer
  matchzy_side_selection_enabled?: 0 | 1;
  matchzy_side_selection_time?: number;
  
  // Early Match Termination (.gg)
  matchzy_gg_enabled?: 0 | 1;
  matchzy_gg_threshold?: number;
  matchzy_gg_min_score_diff?: number; // Minimum score difference required for .gg (0 = disabled)
  
  // Forfeit/Walkover System
  matchzy_ffw_enabled?: 0 | 1;
  matchzy_ffw_time?: number;
  
  // Demo Recording
  matchzy_demo_recording_enabled?: 0 | 1;
}

/**
 * Baseline defaults aligned with MatchZy Enhanced plugin defaults.
 * These match the defaults documented in the plugin's shipped config.
 */
const DEFAULT_MATCHZY_ENHANCED_CVARS: MatchzyEnhancedCvars = {
  // READY / AUTO-READY
  matchzy_autoready_enabled: 0,

  // PAUSES
  matchzy_both_teams_unpause_required: 1,
  matchzy_max_pauses_per_team: 0,
  matchzy_pause_duration: 0,

  // ENHANCED FEATURES
  matchzy_side_selection_enabled: 1,
  matchzy_side_selection_time: 60,

  // .gg
  matchzy_gg_enabled: 0,
  matchzy_gg_threshold: 0.8,
  matchzy_gg_min_score_diff: 0,

  // FFW
  matchzy_ffw_enabled: 0,
  matchzy_ffw_time: 240,

  // DEMOS
  matchzy_demo_recording_enabled: 1,
};

/**
 * Generate MatchZy Enhanced cvars for a tournament
 * Loads global settings from SettingsService and uses them as overrides.
 */
export async function generateMatchzyEnhancedCvars(
  tournamentType: TournamentType,
  overrides?: Partial<MatchzyEnhancedCvars>
): Promise<MatchzyEnhancedCvars> {
  // Load global settings from SettingsService (only non-null values override)
  const globalSettings = await settingsService.getMatchzyEnhancedSettings();
  const globalOverrides: Partial<MatchzyEnhancedCvars> = {};
  
  // Only include non-null global settings as overrides
  if (globalSettings.matchzy_autoready_enabled !== null) {
    globalOverrides.matchzy_autoready_enabled = globalSettings.matchzy_autoready_enabled;
  }
  if (globalSettings.matchzy_both_teams_unpause_required !== null) {
    globalOverrides.matchzy_both_teams_unpause_required = globalSettings.matchzy_both_teams_unpause_required;
  }
  if (globalSettings.matchzy_max_pauses_per_team !== null) {
    globalOverrides.matchzy_max_pauses_per_team = globalSettings.matchzy_max_pauses_per_team;
  }
  if (globalSettings.matchzy_pause_duration !== null) {
    globalOverrides.matchzy_pause_duration = globalSettings.matchzy_pause_duration;
  }
  if (globalSettings.matchzy_side_selection_enabled !== null) {
    globalOverrides.matchzy_side_selection_enabled = globalSettings.matchzy_side_selection_enabled;
  }
  if (globalSettings.matchzy_side_selection_time !== null) {
    globalOverrides.matchzy_side_selection_time = globalSettings.matchzy_side_selection_time;
  }
  if (globalSettings.matchzy_gg_enabled !== null) {
    globalOverrides.matchzy_gg_enabled = globalSettings.matchzy_gg_enabled;
  }
  if (globalSettings.matchzy_gg_threshold !== null) {
    globalOverrides.matchzy_gg_threshold = globalSettings.matchzy_gg_threshold;
  }
  if (globalSettings.matchzy_gg_min_score_diff !== null) {
    globalOverrides.matchzy_gg_min_score_diff = globalSettings.matchzy_gg_min_score_diff;
  }
  if (globalSettings.matchzy_ffw_enabled !== null) {
    globalOverrides.matchzy_ffw_enabled = globalSettings.matchzy_ffw_enabled;
  }
  if (globalSettings.matchzy_ffw_time !== null) {
    globalOverrides.matchzy_ffw_time = globalSettings.matchzy_ffw_time;
  }
  if (globalSettings.matchzy_demo_recording_enabled !== null) {
    globalOverrides.matchzy_demo_recording_enabled = globalSettings.matchzy_demo_recording_enabled;
  }
  
  // Apply overrides: baseline defaults -> global settings -> explicit overrides
  const config = {
    ...DEFAULT_MATCHZY_ENHANCED_CVARS,
    ...globalOverrides,
    ...overrides, // Explicit overrides take precedence
  };
  
  log.debug('Generated MatchZy Enhanced cvars', {
    tournamentType,
    globalOverrides: Object.keys(globalOverrides).length > 0 ? globalOverrides : undefined,
    config,
  });
  
  return config;
}

/**
 * Get default cvars (backward compatible - all features disabled/unlimited)
 */
export function getDefaultMatchzyEnhancedCvars(): MatchzyEnhancedCvars {
  return DEFAULT_MATCHZY_ENHANCED_CVARS;
}

/**
 * Validate MatchZy Enhanced cvars
 */
export function validateMatchzyEnhancedCvars(
  cvars: Partial<MatchzyEnhancedCvars>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate boolean values (0 or 1)
  const booleanFields: (keyof MatchzyEnhancedCvars)[] = [
    'matchzy_autoready_enabled',
    'matchzy_both_teams_unpause_required',
    'matchzy_side_selection_enabled',
    'matchzy_gg_enabled',
    'matchzy_ffw_enabled',
    'matchzy_demo_recording_enabled',
  ];
  
  for (const field of booleanFields) {
    const value = cvars[field];
    if (value !== undefined && value !== 0 && value !== 1) {
      errors.push(`${field} must be 0 or 1, got ${value}`);
    }
  }
  
  // Validate numeric ranges
  if (cvars.matchzy_max_pauses_per_team !== undefined) {
    const val = cvars.matchzy_max_pauses_per_team;
    if (!Number.isInteger(val) || val < 0 || val > 999) {
      errors.push(`matchzy_max_pauses_per_team must be 0-999, got ${val}`);
    }
  }
  
  if (cvars.matchzy_pause_duration !== undefined) {
    const val = cvars.matchzy_pause_duration;
    if (!Number.isInteger(val) || val < 0 || val > 999) {
      errors.push(`matchzy_pause_duration must be 0-999 seconds, got ${val}`);
    }
  }
  
  if (cvars.matchzy_side_selection_time !== undefined) {
    const val = cvars.matchzy_side_selection_time;
    if (!Number.isInteger(val) || val < 1 || val > 999) {
      errors.push(`matchzy_side_selection_time must be 1-999 seconds, got ${val}`);
    }
  }
  
  if (cvars.matchzy_gg_threshold !== undefined) {
    const val = cvars.matchzy_gg_threshold;
    if (typeof val !== 'number' || val < 0 || val > 1) {
      errors.push(`matchzy_gg_threshold must be 0.0-1.0, got ${val}`);
    }
  }
  
  if (cvars.matchzy_gg_min_score_diff !== undefined) {
    const val = cvars.matchzy_gg_min_score_diff;
    if (!Number.isInteger(val) || val < 0 || val > 16) {
      errors.push(`matchzy_gg_min_score_diff must be 0-16, got ${val}`);
    }
  }
  
  if (cvars.matchzy_ffw_time !== undefined) {
    const val = cvars.matchzy_ffw_time;
    if (!Number.isInteger(val) || val < 1 || val > 999) {
      errors.push(`matchzy_ffw_time must be 1-999 seconds, got ${val}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

export const matchzyConfigService = {
  generateMatchzyEnhancedCvars,
  getDefaultMatchzyEnhancedCvars,
  validateMatchzyEnhancedCvars,
};
