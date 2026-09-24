/**
 * How many maps a CS2 tournament needs, and whether its format runs a veto.
 *
 * This module's copy of the map half of core's
 * `utils/tournamentVerification.ts` (DESIGN-module-client-api.md §2.4: the
 * rules are CS2's, and a module built on its own cannot reach core's file).
 * Same rules, same messages: shuffle takes at least one map, a bo1/bo3/bo5
 * veto exactly 7, anything else at least one.
 */

interface MapRule {
  minMaps?: number;
  exactMaps?: number;
  requiresVeto: boolean;
  message: string;
}

function mapRule(type: string, format?: string): MapRule {
  if (type === 'shuffle') {
    return {
      minMaps: 1,
      requiresVeto: false,
      message: 'Select at least one map. Each map represents one round.',
    };
  }
  if (format && ['bo1', 'bo3', 'bo5'].includes(format)) {
    return { exactMaps: 7, requiresVeto: true, message: 'Map veto requires exactly 7 maps.' };
  }
  return { minMaps: 1, requiresVeto: false, message: 'Select at least one map.' };
}

/** Whether the picked maps fit the tournament's type and format. */
export function validateMapCount(
  maps: string[],
  type: string,
  format?: string
): { valid: boolean; message?: string } {
  const rule = mapRule(type, format);
  const count = maps.length;

  if (rule.exactMaps !== undefined && count !== rule.exactMaps) {
    return { valid: false, message: `${rule.message} You have selected ${count}.` };
  }
  if (rule.minMaps !== undefined && count < rule.minMaps) {
    return { valid: false, message: `${rule.message} You have selected ${count}.` };
  }
  return { valid: true };
}

/** Whether the type and format run a map veto (bo1/bo3/bo5, not shuffle). */
export function requiresVeto(type: string, format?: string): boolean {
  return mapRule(type, format).requiresVeto;
}
