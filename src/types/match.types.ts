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
  match_title?: string;
  side_type?: string; // "standard", "always_knife", etc.
  veto_first?: string; // "team1" or "team2"
  skip_veto?: boolean;
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
  wingman?: boolean;
  clinch_series?: boolean;
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
}
