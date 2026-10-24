/**
 * Tournament Verification Rules
 *
 * Centralized system for validating tournament configurations based on type and format.
 * Makes it easy to add new tournament types and their specific rules.
 */

interface MapValidationRule {
  minMaps?: number;
  maxMaps?: number;
  exactMaps?: number;
  requiresVeto?: boolean;
  message?: string;
}

interface TeamValidationRule {
  minTeams?: number;
  maxTeams?: number;
  requirePowerOfTwo?: boolean;
  validCounts?: number[];
  message?: string;
}

interface TournamentValidationRules {
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
function getTournamentVerificationRules(type: string, format?: string): TournamentValidationRules {
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
