/**
 * Tournament Types
 */

export type TournamentType = 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';

export type TournamentStatus = 'setup' | 'ready' | 'in_progress' | 'completed' | 'cancelled';

export type MatchFormat = 'bo1' | 'bo3' | 'bo5';

export interface TournamentSettings {
  matchFormat: MatchFormat;
  thirdPlaceMatch: boolean;
  autoAdvance: boolean;
  checkInRequired: boolean;
  seedingMethod: 'random' | 'manual';
}

export interface Tournament {
  id: number;
  name: string;
  type: TournamentType;
  format: MatchFormat;
  status: TournamentStatus;
  maps: string[]; // JSON array
  team_ids: string[]; // JSON array
  settings: TournamentSettings; // JSON object
  created_at: number;
  updated_at: number;
  started_at?: number;
  completed_at?: number;
}

export interface TournamentRow {
  id: number;
  name: string;
  type: TournamentType;
  format: MatchFormat;
  status: TournamentStatus;
  maps: string; // JSON string
  team_ids: string; // JSON string
  settings: string; // JSON string
  created_at: number;
  updated_at: number;
  started_at?: number;
  completed_at?: number;
}

export interface CreateTournamentInput {
  name: string;
  type: TournamentType;
  format: MatchFormat;
  maps: string[];
  teamIds: string[];
  settings?: Partial<TournamentSettings>;
}

export interface UpdateTournamentInput {
  name?: string;
  type?: TournamentType;
  format?: MatchFormat;
  maps?: string[];
  teamIds?: string[];
  settings?: Partial<TournamentSettings>;
}

export interface BracketMatch {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  team1Id?: string;
  team2Id?: string;
  winnerId?: string;
  serverId?: string;
  status: 'pending' | 'ready' | 'live' | 'completed';
  nextMatchId?: number;
  createdAt?: number;
  loadedAt?: number;
  completedAt?: number;
  team1Score?: number;
  team2Score?: number;
  team1?: {
    id: string;
    name: string;
    tag?: string;
  };
  team2?: {
    id: string;
    name: string;
    tag?: string;
  };
  winner?: {
    id: string;
    name: string;
    tag?: string;
  };
  team1Players?: Array<{
    name: string;
    steamId: string;
    kills: number;
    deaths: number;
    assists: number;
    damage: number;
    headshots: number;
  }>;
  team2Players?: Array<{
    name: string;
    steamId: string;
    kills: number;
    deaths: number;
    assists: number;
    damage: number;
    headshots: number;
  }>;
  config?: {
    maplist?: string[];
    num_maps?: number;
    team1?: { name: string };
    team2?: { name: string };
  };
}

export interface TournamentResponse extends Omit<Tournament, 'settings' | 'maps' | 'team_ids'> {
  maps: string[];
  teamIds: string[];
  settings: TournamentSettings;
  teams: Array<{
    id: string;
    name: string;
    tag?: string;
  }>;
}

export interface BracketResponse {
  tournament: TournamentResponse;
  matches: BracketMatch[];
  totalRounds: number;
}
