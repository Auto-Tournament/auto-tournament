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
  // For shuffle tournaments, mapSequence defines the map per round.
  // For non-shuffle, it will usually be undefined and we fall back to maps.
  mapSequence?: string[];
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
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  overtimeSegments?: number;
  eloTemplateId?: string;
  /**
   * Champion once completed. Null for shuffle tournaments, and for round robin
   * / swiss when the top spot is shared.
   */
  winner?: { id: string; name: string; tag?: string } | null;
}

export interface TournamentSettings {
  matchFormat: string;
  thirdPlaceMatch: boolean;
  autoAdvance: boolean;
  checkInRequired: boolean;
  seedingMethod: 'seeded' | 'random';
  grandFinalMode?: 'none' | 'simple' | 'double';
  // Optional global round/OT hints stored with templates
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  overtimeSegments?: number;
}

/** Swiss standings row from the API, in the order the round pairing uses. */
export interface SwissStanding {
  rank: number;
  teamId: string;
  wins: number;
  losses: number;
  buchholz: number;
  roundDiff: number;
  byes: number;
}

/** Round robin standings from the server: wins, head-to-head, round difference, rounds won, seed. */
export interface RoundRobinStanding {
  rank: number;
  teamId: string;
  wins: number;
  losses: number;
  roundDiff: number;
  roundsWon: number;
}

export interface BracketData {
  tournament: Tournament;
  matches: unknown[]; // Avoid circular dependency, use Match type in actual usage
  totalRounds: number;
  swissStandings?: SwissStanding[];
  roundRobinStandings?: RoundRobinStanding[];
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
