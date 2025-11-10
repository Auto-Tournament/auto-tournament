/**
 * Match-related types
 */

import type { Team } from './team.types';
import type { MatchPhase } from './matchPhase.types';

export interface Match {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  nextMatchId?: number | null;
  status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';
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
  currentMap?: string; // Current map being played (e.g., de_mirage)
  mapNumber?: number; // Current map number in series (0-indexed)
  demoFilePath?: string;
  config?: MatchConfig;
  vetoCompleted?: boolean;
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
  expected_players_total?: number;
  expected_players_team1?: number;
  expected_players_team2?: number;
  team1?: MatchConfigTeam;
  team2?: MatchConfigTeam;
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
