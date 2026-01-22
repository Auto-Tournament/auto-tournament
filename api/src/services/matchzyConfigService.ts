import { TournamentType } from '../types/tournament.types';
import { log } from '../utils/logger';
import { settingsService } from './settingsService';

/**
 * MatchZy Enhanced v1.3.0 Configuration Service
 * 
 * Generates appropriate MatchZy cvars based on tournament/match type.
 * All features are disabled by default or set to safe/unlimited values.
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
 * Match profile types for MatchZy configuration
 */
export type MatchzyConfigProfile = 
  | 'official'      // High-stakes official matches
  | 'fast'          // Fast-paced tournaments
  | 'shuffle'       // Shuffle tournaments (similar to fast but tailored)
  | 'default';      // Safe fallback

/**
 * Configuration templates based on the MatchZy Enhanced v1.3.0 documentation
 */
const CONFIG_TEMPLATES: Record<MatchzyConfigProfile, MatchzyEnhancedCvars> = {
  /**
   * Official Competitive Tournament
   * Use case: High-stakes official matches, no forfeits allowed
   */
  official: {
    matchzy_autoready_enabled: 0,              // Manual ready (players need warmup)
    matchzy_both_teams_unpause_required: 1,    // Both teams must unpause (prevent trolling)
    matchzy_max_pauses_per_team: 2,            // 2 pauses per team (standard competitive)
    matchzy_pause_duration: 300,               // 5 minute pause limit (prevents abuse)
    matchzy_side_selection_enabled: 1,         // Timer enabled
    matchzy_side_selection_time: 60,           // 60 seconds (standard)
    matchzy_gg_enabled: 0,                     // NO forfeits in official matches
    matchzy_ffw_enabled: 1,                    // Handle connection issues fairly
    matchzy_ffw_time: 240,                     // 4 minutes (default)
    matchzy_demo_recording_enabled: 1,         // Always record demos
  },

  /**
   * Fast-Paced Tournament
   * Use case: Multiple matches per day, quick turnaround
   */
  fast: {
    matchzy_autoready_enabled: 1,              // Auto-ready (start immediately)
    matchzy_both_teams_unpause_required: 1,    // Both teams must unpause
    matchzy_max_pauses_per_team: 1,            // 1 pause per team (minimize delays)
    matchzy_pause_duration: 180,               // 3 minute pause limit (fast-paced)
    matchzy_side_selection_enabled: 1,         // Timer enabled
    matchzy_side_selection_time: 30,           // 30 seconds (quick decisions)
    matchzy_gg_enabled: 0,                     // Complete all matches
    matchzy_ffw_enabled: 1,                    // Handle disconnects
    matchzy_ffw_time: 120,                     // 2 minutes (fast walkover)
    matchzy_demo_recording_enabled: 1,         // Record demos
  },

  /**
   * Shuffle Tournament
   * Use case: Quick rotating teams, casual/fast-paced
   */
  shuffle: {
    matchzy_autoready_enabled: 1,              // Auto-ready (quick start)
    matchzy_both_teams_unpause_required: 1,    // Both teams must unpause
    matchzy_max_pauses_per_team: 1,            // 1 pause (fast pace)
    matchzy_pause_duration: 180,               // 3 minutes
    matchzy_side_selection_enabled: 1,         // Timer enabled
    matchzy_side_selection_time: 30,           // 30 seconds (quick)
    matchzy_gg_enabled: 0,                     // No forfeits (complete rounds)
    matchzy_ffw_enabled: 0,                    // No FFW (temporary teams)
    matchzy_demo_recording_enabled: 1,         // Record demos
  },

  /**
   * Default/Safe Configuration
   * Use case: When uncertain, or testing
   */
  default: {
    matchzy_autoready_enabled: 0,              // Manual ready (safe default)
    matchzy_both_teams_unpause_required: 1,    // Both teams must unpause
    matchzy_max_pauses_per_team: 0,            // Unlimited pauses (safe)
    matchzy_pause_duration: 0,                 // No time limit (safe)
    matchzy_side_selection_enabled: 1,         // Timer enabled
    matchzy_side_selection_time: 60,           // 60 seconds (standard)
    matchzy_gg_enabled: 0,                     // No forfeits (safe)
    matchzy_ffw_enabled: 0,                    // No automatic forfeit (safe)
    matchzy_demo_recording_enabled: 1,         // Record demos (safe default)
  },
};

/**
 * Map tournament types to MatchZy configuration profiles
 */
function getProfileForTournamentType(tournamentType: TournamentType): MatchzyConfigProfile {
  switch (tournamentType) {
    case 'shuffle':
      return 'shuffle';
    
    case 'single_elimination':
    case 'double_elimination':
    case 'swiss':
    case 'round_robin':
      // Standard competitive tournaments use official profile
      return 'official';
    
    default:
      log.warn('Unknown tournament type, using default MatchZy config', { tournamentType });
      return 'default';
  }
}

/**
 * Generate MatchZy Enhanced cvars for a tournament
 * Loads global settings from SettingsService and uses them as overrides to tournament defaults
 */
export async function generateMatchzyEnhancedCvars(
  tournamentType: TournamentType,
  overrides?: Partial<MatchzyEnhancedCvars>
): Promise<MatchzyEnhancedCvars> {
  const profile = getProfileForTournamentType(tournamentType);
  const baseConfig = CONFIG_TEMPLATES[profile];
  
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
  
  // Apply overrides: tournament defaults -> global settings -> explicit overrides
  const config = {
    ...baseConfig,
    ...globalOverrides,
    ...overrides, // Explicit overrides take precedence
  };
  
  log.debug('Generated MatchZy Enhanced cvars', {
    tournamentType,
    profile,
    globalOverrides: Object.keys(globalOverrides).length > 0 ? globalOverrides : undefined,
    config,
  });
  
  return config;
}

/**
 * Get default cvars (backward compatible - all features disabled/unlimited)
 */
export function getDefaultMatchzyEnhancedCvars(): MatchzyEnhancedCvars {
  return CONFIG_TEMPLATES.default;
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

/**
 * Get a human-readable description of a MatchZy configuration profile
 */
export function getProfileDescription(profile: MatchzyConfigProfile): string {
  switch (profile) {
    case 'official':
      return 'Official competitive tournament (strict rules, no forfeits, FFW enabled)';
    case 'fast':
      return 'Fast-paced tournament (auto-ready, short timers, quick walkovers)';
    case 'shuffle':
      return 'Shuffle tournament (auto-ready, quick pace, no FFW)';
    case 'default':
      return 'Default safe configuration (manual ready, unlimited pauses, no forfeits)';
    default:
      return 'Unknown profile';
  }
}

export const matchzyConfigService = {
  generateMatchzyEnhancedCvars,
  getDefaultMatchzyEnhancedCvars,
  validateMatchzyEnhancedCvars,
  getProfileDescription,
  getProfileForTournamentType,
};
