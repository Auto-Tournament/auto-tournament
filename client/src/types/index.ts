/**
 * Shared type definitions for the frontend application
 */

export interface Team {
  id: string;
  name: string;
  tag?: string;
}

export interface Player {
  steamId: string;
  name: string;
}

export interface PlayerStats extends Player {
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshots: number;
}

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
}

export interface MatchConfig {
  maplist?: string[];
  num_maps?: number;
  team1?: { name: string };
  team2?: { name: string };
}

export interface Match {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
  team1?: Team;
  team2?: Team;
  winner?: Team;
  status: 'pending' | 'loaded' | 'live' | 'completed';
  createdAt?: number;
  loadedAt?: number;
  completedAt?: number;
  team1Score?: number;
  team2Score?: number;
  team1Players?: PlayerStats[];
  team2Players?: PlayerStats[];
  config?: MatchConfig;
}

export interface Tournament {
  id: number;
  name: string;
  type: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';
  format: 'bo1' | 'bo3' | 'bo5';
  status: 'setup' | 'ready' | 'in_progress' | 'completed';
  teamIds: string[];
  maps: string[];
  createdAt: number;
  settings?: {
    seedingMethod?: 'seeded' | 'random';
    thirdPlaceMatch?: boolean;
  };
}

export interface MatchEvent {
  matchSlug: string;
  event: Record<string, unknown>;
}

export interface ApiError {
  message: string;
  status?: number;
}
