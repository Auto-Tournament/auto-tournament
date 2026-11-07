/**
 * How many maps a CS2 tournament needs, and whether its format runs a veto.
 *
 * This module's copy of the map half of core's
 * `utils/tournamentVerification.ts` (DESIGN-module-client-api.md §2.4: the
 * rules are CS2's, and a module built on its own cannot reach core's file).
 * Same rules, same messages: shuffle takes at least one map, a bo1/bo3/bo5
 * veto exactly 7, anything else at least one. A Wingman veto takes its series'
 * smallest pool up to 7 (Bo1 2, Bo3 3, Bo5 5): Wingman pools are small and the
 * veto order fits any pool (veto/config.ts standardVetoOrder).
 */

interface MapRule {
  minMaps?: number;
  maxMaps?: number;
  exactMaps?: number;
  requiresVeto: boolean;
  message: string;
}

/** The fewest maps a veto can run on: one left for a Bo1 after a ban, else one per map. */
export function wingmanMinMaps(format?: string): number {
  if (format === 'bo5') return 5;
  if (format === 'bo3') return 3;
  return 2;
}

function mapRule(type: string, format?: string, veto = true, mapMode?: string): MapRule {
  if (type === 'shuffle') {
    return {
      minMaps: 1,
      requiresVeto: false,
      message: 'Select at least one map. Each map represents one round.',
    };
  }
  if (format && ['bo1', 'bo3', 'bo5'].includes(format) && !veto) {
    // No veto: each match draws its maps from the pool.
    return {
      minMaps: 1,
      requiresVeto: false,
      message: 'Select at least one map. Each match draws its maps from the pool.',
    };
  }
  if (format && ['bo1', 'bo3', 'bo5'].includes(format) && mapMode === 'wingman') {
    const min = wingmanMinMaps(format);
    return {
      minMaps: min,
      maxMaps: 7,
      requiresVeto: true,
      message: `A Wingman map veto takes ${min} to 7 maps.`,
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
  format?: string,
  veto = true,
  /** `settings.cs2.mapMode`: a Wingman veto takes a smaller pool. */
  mapMode?: string
): { valid: boolean; message?: string } {
  const rule = mapRule(type, format, veto, mapMode);
  const count = maps.length;

  if (rule.exactMaps !== undefined && count !== rule.exactMaps) {
    return { valid: false, message: `${rule.message} You have selected ${count}.` };
  }
  if (rule.minMaps !== undefined && count < rule.minMaps) {
    return { valid: false, message: `${rule.message} You have selected ${count}.` };
  }
  if (rule.maxMaps !== undefined && count > rule.maxMaps) {
    return { valid: false, message: `${rule.message} You have selected ${count}.` };
  }
  return { valid: true };
}

/** Whether the type and format run a map veto (bo1/bo3/bo5, not shuffle). */
export function requiresVeto(type: string, format?: string, veto = true): boolean {
  return mapRule(type, format, veto).requiresVeto;
}

/** The veto's map range for the checklist: "7", or a Wingman pool's "2–7". */
export function vetoMapRange(format?: string, mapMode?: string): { min: number; max: number } {
  return mapMode === 'wingman' ? { min: wingmanMinMaps(format), max: 7 } : { min: 7, max: 7 };
}
