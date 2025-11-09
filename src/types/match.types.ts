export interface MatchPlayer {
  [steamId: string]: string; // steamId -> player name
}

export interface MatchTeam {
  id?: string;
  name: string;
  tag?: string;
  flag?: string; // Country code (e.g., "US", "EU")
  logo?: string | null; // URL to team logo
  players: MatchPlayer;
  coaches?: MatchPlayer | null;
  series_score?: number;
  matchtext?: string | null; // Override team name for single maps
}

export interface MatchConfig {
  matchid: number | string;
  skip_veto: true;
  min_players_to_ready?: number;
  players_per_team: number;
  team1: MatchTeam;
  team2: MatchTeam;
  num_maps: number;
  maplist: string[] | null;
  map_sides?: string[]; // e.g., ["team1_ct", "team2_ct", "knife"]
  spectators?: {
    players?: MatchPlayer;
  };
  min_spectators_to_ready?: number;
  expected_players_total?: number;
  expected_players_team1?: number;
  expected_players_team2?: number;
  wingman?: boolean;
  cvars?: {
    [key: string]: string | number;
  };
}

export interface CreateMatchInput {
  slug: string; // Unique identifier for the match (e.g., "astralis_vs_navi_27")
  serverId: string; // Server this match is assigned to
  config: MatchConfig;
}

export interface Match {
  id: number;
  slug: string;
  server_id: string;
  config: string; // JSON string of MatchConfig
  created_at: number;
  loaded_at?: number; // When the match was loaded on the server
  status: 'pending' | 'loaded' | 'live' | 'completed';
}

export interface MatchResponse {
  id: number;
  slug: string;
  serverId: string;
  config: MatchConfig;
  createdAt: number;
  loadedAt?: number;
  status: string;
  configUrl: string; // The URL to access this match config
  [key: string]: unknown;
}

/**
 * Match list item response - used for GET /api/matches
 */
/**
 * Player stats from match events
 */
export interface PlayerStats {
  name: string;
  steamId: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshots: number;
}

/**
 * Match list item response - used for GET /api/matches
 */
export interface MatchListItem {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  [key: string]: unknown;
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
  status: string;
  serverId?: string;
  config?: Record<string, unknown>;
  demoFilePath?: string;
  createdAt: number;
  loadedAt?: number;
  completedAt?: number;
  vetoCompleted?: boolean;
  team1Players?: PlayerStats[];
  team2Players?: PlayerStats[];
  team1Score?: number;
  team2Score?: number;
}

/**
 * Enrichable match object - BracketMatch or similar structures with optional fields
 */
export type EnrichableMatch = Record<string, unknown> & {
  team1Players?: PlayerStats[];
  team2Players?: PlayerStats[];
  team1Score?: number;
  team2Score?: number;
};
