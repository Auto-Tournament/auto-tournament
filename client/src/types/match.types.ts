/**
 * Match-related types
 */

import type { Team, MatchMapResult } from './team.types';
import type { MatchPhase } from './matchPhase.types';

export interface Match {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  nextMatchId?: number | null;
  status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed' | 'cancelled';
  team1?: Team;
  team2?: Team;
  winner?: Team;
  serverId?: string;
  serverName?: string;
  createdAt?: number;
  loadedAt?: number;
  completedAt?: number;
  team1Score?: number;
  team2Score?: number;
  team1Players?: PlayerStats[];
  team2Players?: PlayerStats[];
  matchPhase?: MatchPhase; // warmup, knife, veto, live, post_match
  currentMap?: string | null; // Current map being played (e.g., de_mirage)
  mapNumber?: number | null; // Current map number in series (0-indexed)
  demoFilePath?: string;
  config?: MatchConfig;
  vetoCompleted?: boolean;
  mapResults?: MatchMapResult[];
  maps?: string[];
  queuePosition?: number | null; // Position in allocation queue (1 = first in queue, null = already allocated)
}

export interface MatchConfigPlayer {
  steamid: string;
  name: string;
}

export interface MatchConfigTeam {
  id?: string;
  name: string;
  tag?: string;
  flag?: string;
  players?: MatchConfigPlayer[];
}

export interface MatchConfig {
  maplist?: string[] | null; // null until veto completes
  num_maps?: number;
  players_per_team?: number;
  /**
   * Per-map starting sides for MatchZy.
   * Values are plugin-facing tokens:
   * - 'team1_ct'  -> Team 1 starts CT on that map
   * - 'team2_ct'  -> Team 2 starts CT on that map
   * - 'knife'     -> Knife round decides starting sides
   */
  map_sides?: Array<'team1_ct' | 'team2_ct' | 'knife'>;
  expected_players_total?: number;
  expected_players_team1?: number;
  expected_players_team2?: number;
  team1?: MatchConfigTeam;
  team2?: MatchConfigTeam;
  cvars?: {
    [key: string]: string | number;
  };
  /**
   * When true, the Team view should not present a veto UI for this match and
   * should treat it as a fixed-map series (no veto phase).
   */
  vetoDisabled?: boolean;
  /**
   * MatchZy simulation mode flag.
   * When true, the plugin runs the match in simulation mode (bots instead of human players).
   */
  simulation?: boolean;
  /**
   * Optional simulation speed multiplier for MatchZy.
   * When provided alongside simulation: true, controls how fast the simulated match runs.
   */
  simulation_timescale?: number;
}

export interface PlayerStats {
  name: string;
  steamId: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshots: number;
}

export interface MatchEvent {
  matchSlug: string;
  event: {
    event: string;
    matchid: string;
    params?: {
      team1_score?: number;
      team2_score?: number;
      [key: string]: unknown;
    };
  };
}

export interface PlayerConnectionStatus {
  totalConnected: number;
  team1Connected: number;
  team2Connected: number;
  expectedTotal: number;
}
