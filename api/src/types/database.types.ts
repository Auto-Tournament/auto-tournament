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
  /** 'matchmaking' for a matchmaking match; null for tournament and manual matches. */
  source?: string | null;
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
  /** An admin's hold (services/matchHolds.ts). */
  held_until?: number | null;
  hold_reason?: string | null;
  countdown_from?: number | null;
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
  /** When the banner in `tournament_banner` was last set; null without one. */
  banner_updated_at?: number | null;
  /** When a new tournament replaced it (it keeps its matches and results); null for the current one. */
  archived_at?: number | null;
  /** An admin paused the bracket (services/matchHolds.ts). */
  paused_at?: number | null;
  pause_reason?: string | null;
  resume_at?: number | null;
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
