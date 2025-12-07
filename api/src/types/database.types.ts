/**
 * Database row types for PostgreSQL queries
 */

export interface DbMatchRow {
  id: number;
  slug: string;
  tournament_id: number;
  round: number;
  match_number: number;
  team1_id?: string;
  team2_id?: string;
  winner_id?: string;
  server_id?: string;
  status: 'pending' | 'ready' | 'live' | 'completed';
  config?: string;
  next_match_id?: number;
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
  maps: string;
  created_at: number;
  updated_at?: number;
  started_at?: number;
  completed_at?: number;
  settings?: string;
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
