/**
 * Tournament Verification Rules
 * 
 * Centralized system for validating tournament configurations based on type and format.
 * Makes it easy to add new tournament types and their specific rules.
 */

export interface MapValidationRule {
  minMaps?: number;
  maxMaps?: number;
  exactMaps?: number;
  requiresVeto?: boolean;
  message?: string;
}

export interface TeamValidationRule {
  minTeams?: number;
  maxTeams?: number;
  requirePowerOfTwo?: boolean;
  validCounts?: number[];
  message?: string;
}

export interface TournamentValidationRules {
  type: string;
  format?: string; // Optional format-specific rules
  maps: MapValidationRule;
  teams?: TeamValidationRule;
  players?: {
    minPlayers?: number;
    maxPlayers?: number;
    requireEven?: boolean;
    message?: string;
  };
}

/**
 * Get verification rules for a tournament type and format
 */
export function getTournamentVerificationRules(
  type: string,
  format?: string
): TournamentValidationRules {
  // Shuffle tournaments
  if (type === 'shuffle') {
    return {
      type: 'shuffle',
      maps: {
        minMaps: 1,
        requiresVeto: false,
        message: 'Select at least one map. Each map represents one round.',
      },
      players: {
        requireEven: false, // We handle odd counts with walkover
        message: 'Select players to participate in the tournament.',
      },
    };
  }

  // Veto formats (BO1, BO3, BO5) - require exactly 7 maps
  const isVetoFormat = format && ['bo1', 'bo3', 'bo5'].includes(format);
  if (isVetoFormat) {
    return {
      type,
      format,
      maps: {
        exactMaps: 7,
        requiresVeto: true,
        message: 'Map veto requires exactly 7 maps.',
      },
      teams: {
        requirePowerOfTwo: type === 'single_elimination' || type === 'double_elimination',
        message: 'Team count must be a power of 2 for elimination brackets.',
      },
    };
  }

  // Non-veto formats (Round Robin, Swiss) - just need at least 1 map
  return {
    type,
    format,
    maps: {
      minMaps: 1,
      requiresVeto: false,
      message: 'Select at least one map.',
    },
  };
}

/**
 * Validate map count based on tournament rules
 */
export function validateMapCount(
  maps: string[],
  type: string,
  format?: string
): { valid: boolean; message?: string } {
  const rules = getTournamentVerificationRules(type, format);
  const mapRule = rules.maps;
  const count = maps.length;

  if (mapRule.exactMaps !== undefined) {
    if (count !== mapRule.exactMaps) {
      return {
        valid: false,
        message: `${mapRule.message || `Exactly ${mapRule.exactMaps} maps required.`} You have selected ${count}.`,
      };
    }
  }

  if (mapRule.minMaps !== undefined && count < mapRule.minMaps) {
    return {
      valid: false,
      message: `${mapRule.message || `At least ${mapRule.minMaps} map${mapRule.minMaps !== 1 ? 's' : ''} required.`} You have selected ${count}.`,
    };
  }

  if (mapRule.maxMaps !== undefined && count > mapRule.maxMaps) {
    return {
      valid: false,
      message: `${mapRule.message || `Maximum ${mapRule.maxMaps} maps allowed.`} You have selected ${count}.`,
    };
  }

  return { valid: true };
}

/**
 * Check if tournament type/format requires veto
 */
export function requiresVeto(type: string, format?: string): boolean {
  const rules = getTournamentVerificationRules(type, format);
  return rules.maps.requiresVeto === true;
}

/**
 * Validate team count based on tournament rules
 */
export function validateTeamCount(
  teamCount: number,
  type: string,
  format?: string
): { valid: boolean; message?: string } {
  const rules = getTournamentVerificationRules(type, format);
  const teamRule = rules.teams;

  if (!teamRule) {
    return { valid: true };
  }

  if (teamRule.minTeams !== undefined && teamCount < teamRule.minTeams) {
    return {
      valid: false,
      message: `${teamRule.message || `Minimum ${teamRule.minTeams} teams required.`} You have ${teamCount}.`,
    };
  }

  if (teamRule.maxTeams !== undefined && teamCount > teamRule.maxTeams) {
    return {
      valid: false,
      message: `${teamRule.message || `Maximum ${teamRule.maxTeams} teams allowed.`} You have ${teamCount}.`,
    };
  }

  if (teamRule.requirePowerOfTwo && teamRule.validCounts) {
    if (!teamRule.validCounts.includes(teamCount)) {
      return {
        valid: false,
        message: `${teamRule.message || 'Team count must be a power of 2.'} Valid options: ${teamRule.validCounts.join(', ')}.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validate player count for shuffle tournaments
 */
export function validatePlayerCount(
  playerCount: number,
  teamSize: number
): { valid: boolean; message?: string; warning?: string } {
  const minPlayers = teamSize * 2;
  const isEven = playerCount % 2 === 0;

  if (playerCount > 0 && playerCount < minPlayers) {
    return {
      valid: false,
      message: `Minimum ${minPlayers} players required for ${teamSize}v${teamSize} matches. You have ${playerCount}.`,
    };
  }

  if (playerCount > 0 && !isEven) {
    return {
      valid: true, // Still valid, but with warning
      warning: `Odd player count: ${playerCount} players cannot form even teams. The extra player will wait one round (walkover).`,
    };
  }

  return { valid: true };
}

