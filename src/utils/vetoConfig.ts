/**
 * Veto configuration and utilities
 */

export interface VetoStep {
  step: number;
  team: 'team1' | 'team2';
  action: 'ban' | 'pick' | 'side_pick';
}

export const BO1_VETO_ORDER: VetoStep[] = [
  { step: 1, team: 'team1', action: 'ban' },
  { step: 2, team: 'team2', action: 'ban' },
  { step: 3, team: 'team1', action: 'ban' },
  { step: 4, team: 'team2', action: 'ban' },
  { step: 5, team: 'team1', action: 'ban' },
  { step: 6, team: 'team2', action: 'ban' },
  { step: 7, team: 'team1', action: 'side_pick' },
];

export const BO3_VETO_ORDER: VetoStep[] = [
  { step: 1, team: 'team1', action: 'ban' },
  { step: 2, team: 'team2', action: 'ban' },
  { step: 3, team: 'team1', action: 'pick' },
  { step: 4, team: 'team2', action: 'side_pick' },
  { step: 5, team: 'team2', action: 'pick' },
  { step: 6, team: 'team1', action: 'side_pick' },
  { step: 7, team: 'team1', action: 'ban' },
  { step: 8, team: 'team2', action: 'ban' },
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

export function getVetoOrder(format: string): VetoStep[] {
  if (format === 'bo1') return BO1_VETO_ORDER;
  if (format === 'bo3') return BO3_VETO_ORDER;
  if (format === 'bo5') return BO5_VETO_ORDER;
  return BO1_VETO_ORDER;
}

