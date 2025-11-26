/**
 * Team-related types
 */

import type { VetoAction, VetoMapResult } from './veto.types';

export interface Player {
  steamId: string;
  name: string;
  avatar?: string;
}

export interface Team {
  id: string;
  name: string;
  tag?: string;
  discordRoleId?: string;
  players?: Player[];
  createdAt?: number;
  updatedAt?: number;
}

export interface TeamStats {
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: number;
}

export interface TeamStanding {
  position: number;
  totalTeams: number;
  wins: number;
}

export interface TeamMatchVetoSummary {
  status: 'pending' | 'in_progress' | 'completed';
  team1Name?: string;
  team2Name?: string;
  pickedMaps: VetoMapResult[];
  actions: VetoAction[];
}

export interface TeamMatchInfo {
  slug: string;
  round: number;
  matchNumber: number;
  status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';
  isTeam1: boolean;
  currentMap?: string | null;
  mapNumber?: number | null;
  team1?: Team; // For veto interface
  team2?: Team; // For veto interface
  opponent: Team | null;
  server: {
    id: string;
    name: string;
    host: string;
    port: number;
    password?: string;
    status?: string | null;
    statusDescription?: {
      label: string;
      description: string;
      color: 'success' | 'warning' | 'error' | 'info' | 'default';
    } | null;
  } | null;
  connectionStatus?: MatchConnectionStatus | null;
  liveStats?: MatchLiveStats | null;
  maps: string[];
  mapResults: MatchMapResult[];
  matchFormat: string;
  loadedAt?: number;
  config?: {
    players_per_team?: number;
    expected_players_total?: number;
    expected_players_team1?: number;
    expected_players_team2?: number;
    num_maps?: number;
    maplist?: string[];
    team1?: {
      id?: string;
      name: string;
      tag?: string;
      players?: Array<{ steamid: string; name: string }>;
    };
    team2?: {
      id?: string;
      name: string;
      tag?: string;
      players?: Array<{ steamid: string; name: string }>;
    };
  };
  veto?: TeamMatchVetoSummary | null;
}

export interface ConnectedPlayerStatus {
  steamId: string;
  name: string;
  team: 'team1' | 'team2';
  connectedAt: number;
  isReady: boolean;
}

export interface MatchConnectionStatus {
  matchSlug: string;
  connectedPlayers: ConnectedPlayerStatus[];
  team1Connected: number;
  team2Connected: number;
  totalConnected: number;
  lastUpdated: number;
}

export interface MatchLiveStats {
  matchSlug: string;
  team1Score: number;
  team2Score: number;
  roundNumber: number;
  mapNumber: number;
  status: 'warmup' | 'knife' | 'live' | 'halftime' | 'postgame';
  lastEventAt: number;
  team1SeriesScore: number;
  team2SeriesScore: number;
  mapName?: string | null;
  totalMaps: number;
  playerStats?: MatchPlayerStatsSnapshot | null;
}

export interface MatchPlayerStatsSnapshot {
  team1: MatchPlayerStatsLine[];
  team2: MatchPlayerStatsLine[];
}

export interface MatchPlayerStatsLine {
  steamId: string;
  name: string;
  kills: number;
  deaths: number;
  assists: number;
  flashAssists: number;
  headshotKills: number;
  damage: number;
  utilityDamage: number;
  kast: number;
  mvps: number;
  score: number;
  roundsPlayed: number;
}

export interface MatchMapResult {
  mapNumber: number;
  mapName?: string | null;
  team1Score: number;
  team2Score: number;
  winner?: 'team1' | 'team2' | 'none' | null;
  winnerTeam?: 'team1' | 'team2' | 'none' | null;
  demoFilePath?: string | null;
  completedAt: number;
}

export interface TeamMatchHistory {
  slug: string;
  round: number;
  matchNumber: number;
  opponent: Team | null;
  won: boolean;
  teamScore: number;
  opponentScore: number;
  completedAt: number;
}

