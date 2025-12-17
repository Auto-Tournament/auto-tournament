/**
 * Tournament Types
 */

export type TournamentType = 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss' | 'shuffle';

export type TournamentStatus = 'setup' | 'ready' | 'in_progress' | 'completed' | 'cancelled';

export type MatchFormat = 'bo1' | 'bo3' | 'bo5';

export interface VetoStep {
  step: number;
  team: 'team1' | 'team2';
  action: 'ban' | 'pick' | 'side_pick';
}

export interface TournamentSettings {
  matchFormat: MatchFormat;
  thirdPlaceMatch: boolean;
  autoAdvance: boolean;
  checkInRequired: boolean;
  seedingMethod: 'random' | 'manual';
  customVetoOrder?: {
    bo1?: VetoStep[];
    bo3?: VetoStep[];
    bo5?: VetoStep[];
  };
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
  // Shuffle tournament specific fields (parsed / normalized)
  mapSequence?: string[]; // Maps in order (number of rounds)
  teamSize?: number; // Number of players per team (default: 5)
  roundLimitType?: 'first_to_13' | 'max_rounds';
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  overtimeSegments?: number;
  eloTemplateId?: string | null;
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
  // Shuffle tournament specific fields (raw DB columns)
  map_sequence?: string | null;
  team_size?: number | null;
  round_limit_type?: string | null;
  max_rounds?: number | null;
  overtime_mode?: string | null;
  overtime_segments?: number | null;
  elo_template_id?: string | null;
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
  team1?: {
    id: string;
    name: string;
    tag?: string;
  } | null;
  team2?: {
    id: string;
    name: string;
    tag?: string;
  } | null;
  winner?: {
    id: string;
    name: string;
    tag?: string;
  } | null;
  serverId?: string | null;
  status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';
  nextMatchId?: number | null;
  createdAt?: number;
  loadedAt?: number;
  completedAt?: number;
  team1Score?: number;
  team2Score?: number;
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
  // Shuffle tournament specific fields
  mapSequence?: string[];
  teamSize?: number; // Number of players per team (default: 5)
  roundLimitType?: 'first_to_13' | 'max_rounds';
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  overtimeSegments?: number;
  eloTemplateId?: string; // ELO calculation template ID (optional, defaults to "Pure Win/Loss")
}

export interface BracketResponse {
  tournament: TournamentResponse;
  matches: BracketMatch[];
  totalRounds: number;
}

export interface TournamentTemplate {
  id: number;
  name: string;
  description?: string;
  type: TournamentType;
  format: MatchFormat;
  mapPoolId?: number | null;
  maps: string[];
  teamIds?: string[];
  settings: TournamentSettings;
  createdAt: number;
  updatedAt: number;
}

export interface TournamentTemplateRow {
  id: number;
  name: string;
  description?: string | null;
  type: TournamentType;
  format: MatchFormat;
  map_pool_id?: number | null;
  maps?: string | null;
  team_ids?: string | null;
  settings: string; // JSON string
  created_at: number;
  updated_at: number;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  type: TournamentType;
  format: MatchFormat;
  mapPoolId?: number | null;
  maps?: string[];
  teamIds?: string[];
  settings?: Partial<TournamentSettings>;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  type?: TournamentType;
  format?: MatchFormat;
  mapPoolId?: number | null;
  maps?: string[];
  teamIds?: string[];
  settings?: Partial<TournamentSettings>;
}
