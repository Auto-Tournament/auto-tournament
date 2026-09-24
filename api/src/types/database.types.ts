/**
 * Database row types for PostgreSQL queries
 */

export interface DbMatchRow {
  id: number;
  slug: string;
  tournament_id: number;
  round: number;
  match_number: number;
  bracket?: 'WB' | 'LB' | 'GF' | 'GF_RESET' | string | null;
  team1_id?: string;
  team2_id?: string;
  winner_id?: string;
  server_id?: string;
  status: 'pending' | 'ready' | 'live' | 'completed';
  config?: string;
  /** Game integration that owns the match (integrations/registry); 'cs2' by default. */
  game?: string;
  next_match_id?: number;
  team1_from_match_id?: number | null;
  team1_from_outcome?: 'winner' | 'loser' | null | string;
  team2_from_match_id?: number | null;
  team2_from_outcome?: 'winner' | 'loser' | null | string;
  demo_file_path?: string;
  veto_state?: string;
  created_at?: number;
  loaded_at?: number;
  completed_at?: number;
  current_map?: string | null;
  map_number?: number | null;
  team1_name?: string | null;
  team2_name?: string | null;
}

export interface DbTeamRow {
  id: string;
  name: string;
  tag?: string;
}

export interface DbTournamentRow {
  id: number;
  name: string;
  type: string;
  format: string;
  status: string;
  team_ids: string;
  created_at: number;
  updated_at?: number;
  started_at?: number;
  completed_at?: number;
  settings?: string;
  /** Game integration for the tournament's matches; 'cs2' by default. */
  game?: string;
  team_size?: number | null;
  elo_template_id?: string | null;
}

export interface DbEventRow {
  id: number;
  match_slug: string;
  event_type: string;
  event_data: string;
  received_at: number;
}

export interface DbServerRow {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
  rcon_password: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}
