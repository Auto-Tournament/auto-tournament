/**
 * Match phase tracking types
 */

export type MatchPhase =
  | 'warmup'
  | 'knife'
  | 'veto'
  | 'live'
  | 'halftime'
  | 'overtime'
  | 'paused'
  | 'post_match';

export interface MatchPhaseInfo {
  phase: MatchPhase;
  mapNumber: number;
  roundNumber?: number;
  overtimeNumber?: number;
  isPaused: boolean;
  pauseInfo?: {
    pausedBy: string;
    pausedAt: number;
    duration?: number;
    isTactical: boolean;
    isAdmin: boolean;
  };
  knifeWinner?: 'team1' | 'team2';
}

export const getPhaseDisplay = (phase: MatchPhase): { label: string; color: string } => {
  switch (phase) {
    case 'warmup':
      return { label: 'WARMUP', color: 'info' };
    case 'knife':
      return { label: 'KNIFE ROUND', color: 'warning' };
    case 'veto':
      return { label: 'VETO PHASE', color: 'secondary' };
    case 'live':
      return { label: 'LIVE', color: 'error' };
    case 'halftime':
      return { label: 'HALFTIME', color: 'info' };
    case 'overtime':
      return { label: 'OVERTIME', color: 'warning' };
    case 'paused':
      return { label: 'PAUSED', color: 'warning' };
    case 'post_match':
      return { label: 'POST-MATCH', color: 'success' };
    default:
      return { label: phase.toUpperCase(), color: 'default' };
  }
};

