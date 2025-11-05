/**
 * Tournament-related types
 */

export interface Tournament {
  id: number;
  name: string;
  type: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';
  format: 'bo1' | 'bo3' | 'bo5';
  status: 'setup' | 'ready' | 'in_progress' | 'completed';
  maps: string[];
  teamIds: string[];
  teams?: Array<{
    id: string;
    name: string;
    tag?: string;
  }>;
  settings?: TournamentSettings;
  created_at?: number;
  updated_at?: number;
  started_at?: number | null;
  completed_at?: number | null;
}

export interface TournamentSettings {
  matchFormat: string;
  thirdPlaceMatch: boolean;
  autoAdvance: boolean;
  checkInRequired: boolean;
  seedingMethod: 'seeded' | 'random';
}

export interface BracketData {
  tournament: Tournament;
  matches: unknown[]; // Avoid circular dependency, use Match type in actual usage
  totalRounds: number;
}

