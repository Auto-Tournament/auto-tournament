/**
 * Team-related types
 */

export interface Player {
  steamId: string;
  name: string;
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

export interface TeamMatchInfo {
  slug: string;
  round: number;
  matchNumber: number;
  status: 'pending' | 'ready' | 'loaded' | 'live' | 'completed';
  isTeam1: boolean;
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
  maps: string[];
  matchFormat: string;
  loadedAt?: number;
  config?: {
    players_per_team?: number;
    expected_players_total?: number;
    expected_players_team1?: number;
    expected_players_team2?: number;
    num_maps?: number;
    maplist?: string[];
  };
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

