/**
 * Tournament-related types
 */

export interface Tournament {
  id: number;
  name: string;
  type: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss' | 'shuffle';
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
  // Shuffle tournament specific fields
  teamSize?: number;
  roundLimitType?: 'first_to_13' | 'max_rounds';
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  eloTemplateId?: string;
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

export interface TournamentTemplate {
  id: number;
  name: string;
  description?: string;
  type: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss' | 'shuffle';
  format: 'bo1' | 'bo3' | 'bo5';
  mapPoolId?: number | null;
  maps: string[];
  teamIds?: string[];
  settings: TournamentSettings;
  createdAt: number;
  updatedAt: number;
}

