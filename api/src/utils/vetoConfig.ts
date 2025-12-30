/**
 * Veto configuration and utilities
 * Supports both standard CS Major formats and custom veto orders
 */

export interface VetoStep {
  step: number;
  team: 'team1' | 'team2';
  action: 'ban' | 'pick' | 'side_pick';
}

/**
 * Standard CS Major veto formats
 * These follow the official Counter-Strike Major Supplemental Rulebook standards
 * 
 * Best of 1:
 * - Team A removes 2 maps
 * - Team B removes 3 maps
 * - Team A removes 1 map
 * - Team B chooses starting side
 * 
 * Best of 3:
 * - Team A removes 1 map
 * - Team B removes 1 map
 * - Team A picks Map 1
 * - Team B chooses starting side on Map 1
 * - Team B picks Map 2
 * - Team A chooses starting side on Map 2
 * - Team B removes 1 map
 * - Team A removes 1 map
 * - Team B chooses starting side on Map 3
 */
export const BO1_VETO_ORDER: VetoStep[] = [
  { step: 1, team: 'team1', action: 'ban' }, // Team A removes 2 maps (first)
  { step: 2, team: 'team1', action: 'ban' }, // Team A removes 2 maps (second)
  { step: 3, team: 'team2', action: 'ban' }, // Team B removes 3 maps (first)
  { step: 4, team: 'team2', action: 'ban' }, // Team B removes 3 maps (second)
  { step: 5, team: 'team2', action: 'ban' }, // Team B removes 3 maps (third)
  { step: 6, team: 'team1', action: 'ban' }, // Team A removes 1 map
  { step: 7, team: 'team2', action: 'side_pick' }, // Team B chooses starting side
];

export const BO3_VETO_ORDER: VetoStep[] = [
  { step: 1, team: 'team1', action: 'ban' }, // Team A removes 1 map
  { step: 2, team: 'team2', action: 'ban' }, // Team B removes 1 map
  { step: 3, team: 'team1', action: 'pick' }, // Team A picks Map 1
  { step: 4, team: 'team2', action: 'side_pick' }, // Team B chooses starting side on Map 1
  { step: 5, team: 'team2', action: 'pick' }, // Team B picks Map 2
  { step: 6, team: 'team1', action: 'side_pick' }, // Team A chooses starting side on Map 2
  { step: 7, team: 'team2', action: 'ban' }, // Team B removes 1 map
  { step: 8, team: 'team1', action: 'ban' }, // Team A removes 1 map
  { step: 9, team: 'team2', action: 'side_pick' }, // Team B chooses starting side on Map 3
];

export const BO5_VETO_ORDER: VetoStep[] = [
  { step: 1, team: 'team1', action: 'ban' },
  { step: 2, team: 'team2', action: 'ban' },
  { step: 3, team: 'team1', action: 'pick' },
  { step: 4, team: 'team2', action: 'side_pick' },
  { step: 5, team: 'team2', action: 'pick' },
  { step: 6, team: 'team1', action: 'side_pick' },
  { step: 7, team: 'team1', action: 'pick' },
  { step: 8, team: 'team2', action: 'side_pick' },
  { step: 9, team: 'team2', action: 'pick' },
  { step: 10, team: 'team1', action: 'side_pick' },
];

/**
 * Validates a custom veto order to ensure it complies with CS Major rules
 * @param vetoOrder The veto order to validate
 * @param format The match format (bo1, bo3, bo5)
 * @param totalMaps Total number of maps in the pool (should be 7 for standard formats)
 * @returns Validation result with error message if invalid
 */
export function validateVetoOrder(
  vetoOrder: VetoStep[],
  format: 'bo1' | 'bo3' | 'bo5',
  totalMaps: number = 7
): { valid: boolean; error?: string } {
  if (!vetoOrder || vetoOrder.length === 0) {
    return { valid: false, error: 'Veto order cannot be empty' };
  }

  // Validate step numbers are sequential and start at 1
  for (let i = 0; i < vetoOrder.length; i++) {
    if (vetoOrder[i].step !== i + 1) {
      return {
        valid: false,
        error: `Veto steps must be sequential starting from 1. Found step ${vetoOrder[i].step} at position ${i + 1}`,
      };
    }
  }

  // Count actions
  const banCount = vetoOrder.filter((s) => s.action === 'ban').length;
  const pickCount = vetoOrder.filter((s) => s.action === 'pick').length;
  const sidePickCount = vetoOrder.filter((s) => s.action === 'side_pick').length;

  // Validate team assignments
  for (const step of vetoOrder) {
    if (step.team !== 'team1' && step.team !== 'team2') {
      return {
        valid: false,
        error: `Invalid team in step ${step.step}: ${step.team}. Must be 'team1' or 'team2'`,
      };
    }
    if (step.action !== 'ban' && step.action !== 'pick' && step.action !== 'side_pick') {
      return {
        valid: false,
        error: `Invalid action in step ${step.step}: ${step.action}. Must be 'ban', 'pick', or 'side_pick'`,
      };
    }
  }

  // Validate format-specific requirements
  if (format === 'bo1') {
    // BO1 CS Major format: Team A removes 2, Team B removes 3, Team A removes 1, Team B picks side
    // Total: 6 bans, leaving 1 map
    if (vetoOrder[vetoOrder.length - 1].action !== 'side_pick') {
      return {
        valid: false,
        error: 'BO1 veto must end with a side_pick action',
      };
    }
    if (banCount !== 6) {
      return {
        valid: false,
        error: `BO1 veto must have exactly 6 bans (Team A: 2, Team B: 3, Team A: 1), got ${banCount}`,
      };
    }
    if (pickCount > 0) {
      return {
        valid: false,
        error: 'BO1 veto should not include map picks, only bans and a side pick',
      };
    }
    // Verify Team B picks side (last action should be team2 side_pick)
    if (vetoOrder[vetoOrder.length - 1].team !== 'team2') {
      return {
        valid: false,
        error: 'BO1 veto must end with Team B (team2) picking the starting side',
      };
    }
  } else if (format === 'bo3') {
    // BO3 CS Major format: 
    // - Team A removes 1, Team B removes 1
    // - Team A picks Map 1, Team B picks side on Map 1
    // - Team B picks Map 2, Team A picks side on Map 2
    // - Team B removes 1, Team A removes 1
    // - Team B picks side on Map 3
    // Total: 2 picks, 3 side picks (one per map including decider), 4 bans
    if (pickCount !== 2) {
      return {
        valid: false,
        error: `BO3 veto must pick exactly 2 maps, got ${pickCount}`,
      };
    }
    if (sidePickCount !== 3) {
      return {
        valid: false,
        error: `BO3 veto must have exactly 3 side picks (one per map including decider), got ${sidePickCount}`,
      };
    }
    if (banCount !== 4) {
      return {
        valid: false,
        error: `BO3 veto must have exactly 4 bans (Team A: 1, Team B: 1, Team B: 1, Team A: 1), got ${banCount}`,
      };
    }
    // Check that each pick has exactly one side pick after it, plus one side pick for the decider
    let pickIndices: number[] = [];
    let sidePickIndices: number[] = [];
    for (let i = 0; i < vetoOrder.length; i++) {
      if (vetoOrder[i].action === 'pick') {
        pickIndices.push(i);
      } else if (vetoOrder[i].action === 'side_pick') {
        sidePickIndices.push(i);
      }
    }
    // We need 2 side picks for the 2 picked maps, plus 1 side pick for the decider map
    if (sidePickIndices.length !== 3) {
      return {
        valid: false,
        error: `BO3 veto must have exactly 3 side picks (2 for picked maps + 1 for decider), got ${sidePickIndices.length}`,
      };
    }
    // Verify each pick has exactly one side pick after it (excluding the decider side pick)
    // The decider side pick is the last one, so we exclude it from this check
    const deciderSidePickIndex = sidePickIndices[sidePickIndices.length - 1];
    const sidePicksForPickedMaps = sidePickIndices.slice(0, -1); // All except the last (decider)
    
    for (let i = 0; i < pickIndices.length; i++) {
      const pickIndex = pickIndices[i];
      // Find side picks that come after this pick but before the next pick (or before decider side pick)
      const sidePicksAfterThisPick = sidePicksForPickedMaps.filter((spi) => spi > pickIndex);
      const nextPickIndex = i < pickIndices.length - 1 ? pickIndices[i + 1] : deciderSidePickIndex;
      const sidePicksBeforeNextPick = sidePicksAfterThisPick.filter((spi) => spi < nextPickIndex);
      
      if (sidePicksBeforeNextPick.length !== 1) {
        return {
          valid: false,
          error: `Each map pick must have exactly one side pick after it. Pick at step ${vetoOrder[pickIndex].step} has ${sidePicksBeforeNextPick.length} side pick(s)`,
        };
      }
    }
    // Verify the last side pick is for the decider (should be Team B)
    if (vetoOrder[deciderSidePickIndex].team !== 'team2') {
      return {
        valid: false,
        error: `The decider map side pick (last side pick) must be chosen by Team B (team2)`,
      };
    }
    // Verify the last action is a side pick (for the decider)
    if (vetoOrder[vetoOrder.length - 1].action !== 'side_pick') {
      return {
        valid: false,
        error: `BO3 veto must end with a side pick for the decider map`,
      };
    }
    // Should leave 1 map as decider
    if (banCount + pickCount !== totalMaps - 1) {
      return {
        valid: false,
        error: `BO3 veto should result in exactly 1 decider map. Expected ${totalMaps - 1} bans/picks, got ${banCount + pickCount}`,
      };
    }
  } else if (format === 'bo5') {
    // BO5: Should pick 4 maps, ban 2 maps (leaving 1 decider), with side picks after each pick
    if (pickCount !== 4) {
      return {
        valid: false,
        error: `BO5 veto must pick exactly 4 maps, got ${pickCount}`,
      };
    }
    if (sidePickCount !== 4) {
      return {
        valid: false,
        error: `BO5 veto must have exactly 4 side picks (one per picked map), got ${sidePickCount}`,
      };
    }
    // Check that each pick has exactly one side pick after it
    let pickIndices: number[] = [];
    let sidePickIndices: number[] = [];
    for (let i = 0; i < vetoOrder.length; i++) {
      if (vetoOrder[i].action === 'pick') {
        pickIndices.push(i);
      } else if (vetoOrder[i].action === 'side_pick') {
        sidePickIndices.push(i);
      }
    }
    // Each side pick must come after at least one pick, and we need exactly one side pick per pick
    if (sidePickIndices.length !== pickIndices.length) {
      return {
        valid: false,
        error: `BO5 veto must have exactly one side pick for each map pick`,
      };
    }
    // Verify each pick has exactly one side pick after it
    for (let i = 0; i < pickIndices.length; i++) {
      const pickIndex = pickIndices[i];
      // Find side picks that come after this pick
      const sidePicksAfterThisPick = sidePickIndices.filter((spi) => spi > pickIndex);
      // Find side picks that come after the next pick (if any)
      const nextPickIndex = i < pickIndices.length - 1 ? pickIndices[i + 1] : vetoOrder.length;
      const sidePicksBeforeNextPick = sidePicksAfterThisPick.filter((spi) => spi < nextPickIndex);
      
      if (sidePicksBeforeNextPick.length !== 1) {
        return {
          valid: false,
          error: `Each map pick must have exactly one side pick after it. Pick at step ${vetoOrder[pickIndex].step} has ${sidePicksBeforeNextPick.length} side pick(s)`,
        };
      }
    }
    // Also verify no side picks come before any pick
    if (sidePickIndices.length > 0 && sidePickIndices[0] < pickIndices[0]) {
      return {
        valid: false,
        error: `Side pick at step ${vetoOrder[sidePickIndices[0]].step} must come after a map pick`,
      };
    }
    // Should leave 1 map as decider
    if (banCount + pickCount !== totalMaps - 1) {
      return {
        valid: false,
        error: `BO5 veto should result in exactly 1 decider map. Expected ${totalMaps - 1} bans/picks, got ${banCount + pickCount}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get veto order for a format, using custom order from settings if available
 * @param format The match format (bo1, bo3, bo5)
 * @param customVetoOrder Optional custom veto order from tournament settings
 * @param totalMaps Total number of maps in the pool (for validation)
 * @returns The veto order to use
 */
export function getVetoOrder(
  format: string,
  customVetoOrder?: { bo1?: VetoStep[]; bo3?: VetoStep[]; bo5?: VetoStep[] },
  totalMaps: number = 7
): VetoStep[] {
  // Use custom veto order if provided and valid
  if (customVetoOrder) {
    let customOrder: VetoStep[] | undefined;
    if (format === 'bo1' && customVetoOrder.bo1) {
      customOrder = customVetoOrder.bo1;
    } else if (format === 'bo3' && customVetoOrder.bo3) {
      customOrder = customVetoOrder.bo3;
    } else if (format === 'bo5' && customVetoOrder.bo5) {
      customOrder = customVetoOrder.bo5;
    }

    if (customOrder) {
      // Validate the custom order
      const validation = validateVetoOrder(customOrder, format as 'bo1' | 'bo3' | 'bo5', totalMaps);
      if (validation.valid) {
        return customOrder;
      } else {
        console.warn(
          `Custom veto order for ${format} failed validation: ${validation.error}. Falling back to standard format.`
        );
      }
    }
  }

  // Fall back to standard formats
  if (format === 'bo1') return BO1_VETO_ORDER;
  if (format === 'bo3') return BO3_VETO_ORDER;
  if (format === 'bo5') return BO5_VETO_ORDER;
  return BO1_VETO_ORDER;
}

