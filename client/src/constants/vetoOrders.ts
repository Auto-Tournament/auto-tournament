/**
 * Standard veto orders for different match formats
 * Following CS Major Supplemental Rulebook standards
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

import type { VetoStep } from '../types/veto.types';

export const BO1_VETO_ORDER: VetoStep[] = [
  { step: 1, team: 'team1', action: 'ban', description: 'Team A removes 2 maps (first)' },
  { step: 2, team: 'team1', action: 'ban', description: 'Team A removes 2 maps (second)' },
  { step: 3, team: 'team2', action: 'ban', description: 'Team B removes 3 maps (first)' },
  { step: 4, team: 'team2', action: 'ban', description: 'Team B removes 3 maps (second)' },
  { step: 5, team: 'team2', action: 'ban', description: 'Team B removes 3 maps (third)' },
  { step: 6, team: 'team1', action: 'ban', description: 'Team A removes 1 map' },
  { step: 7, team: 'team2', action: 'side_pick', description: 'Team B chooses starting side on remaining map' },
];

export const BO3_VETO_ORDER: VetoStep[] = [
  { step: 1, team: 'team1', action: 'ban', description: 'Team A removes 1 map' },
  { step: 2, team: 'team2', action: 'ban', description: 'Team B removes 1 map' },
  { step: 3, team: 'team1', action: 'pick', description: 'Team A picks Map 1' },
  { step: 4, team: 'team2', action: 'side_pick', description: 'Team B chooses starting side on Map 1' },
  { step: 5, team: 'team2', action: 'pick', description: 'Team B picks Map 2' },
  { step: 6, team: 'team1', action: 'side_pick', description: 'Team A chooses starting side on Map 2' },
  { step: 7, team: 'team2', action: 'ban', description: 'Team B removes 1 map' },
  { step: 8, team: 'team1', action: 'ban', description: 'Team A removes 1 map' },
  { step: 9, team: 'team2', action: 'side_pick', description: 'Team B chooses starting side on Map 3 (decider)' },
];

export const BO5_VETO_ORDER: VetoStep[] = [
  { step: 1, team: 'team1', action: 'ban', description: 'Team A bans a map' },
  { step: 2, team: 'team2', action: 'ban', description: 'Team B bans a map' },
  { step: 3, team: 'team1', action: 'pick', description: 'Team A picks Map 1' },
  { step: 4, team: 'team2', action: 'side_pick', description: 'Team B picks starting side on Map 1' },
  { step: 5, team: 'team2', action: 'pick', description: 'Team B picks Map 2' },
  { step: 6, team: 'team1', action: 'side_pick', description: 'Team A picks starting side on Map 2' },
  { step: 7, team: 'team1', action: 'pick', description: 'Team A picks Map 3' },
  { step: 8, team: 'team2', action: 'side_pick', description: 'Team B picks starting side on Map 3' },
  { step: 9, team: 'team2', action: 'pick', description: 'Team B picks Map 4' },
  { step: 10, team: 'team1', action: 'side_pick', description: 'Team A picks starting side on Map 4' },
  // Remaining map is decider with knife round
];

export const getVetoOrder = (format: 'bo1' | 'bo3' | 'bo5'): VetoStep[] => {
  switch (format) {
    case 'bo1':
      return BO1_VETO_ORDER;
    case 'bo3':
      return BO3_VETO_ORDER;
    case 'bo5':
      return BO5_VETO_ORDER;
    default:
      return BO1_VETO_ORDER;
  }
};

export const getTotalMapsNeeded = (format: 'bo1' | 'bo3' | 'bo5'): number => {
  switch (format) {
    case 'bo1':
      return 1;
    case 'bo3':
      return 3;
    case 'bo5':
      return 5;
    default:
      return 1;
  }
};

