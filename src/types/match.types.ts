export interface MatchPlayer {
  [steamId: string]: string; // steamId -> player name
}

export interface MatchTeam {
  name: string;
  players: MatchPlayer;
}

export interface MatchConfig {
  matchid: number | string;
  team1: MatchTeam;
  team2: MatchTeam;
  num_maps: number;
  maplist: string[];
  map_sides: string[]; // e.g., ["team1_ct", "team2_ct", "knife"]
  spectators?: {
    players?: MatchPlayer;
  };
  clinch_series?: boolean;
  players_per_team: number;
  cvars?: {
    [key: string]: string;
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
