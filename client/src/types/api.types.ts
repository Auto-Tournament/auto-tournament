/**
 * API Response Types
 *
 * Defines the shape of all API responses from the backend
 */

import type { Team, Match, Tournament, TeamStats, TeamStanding } from './index';

// Base response types
export interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// Server types
export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  password: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  rconPassword?: string;
  status?: 'online' | 'offline' | 'checking' | 'disabled' | string;
  isAvailable?: boolean;
  currentMatch?: string | null;
  matchzyConfig?: {
    chatPrefix?: string | null;
    adminChatPrefix?: string | null;
    knifeEnabledDefault?: boolean | null;
    minimumReadyRequired?: number | null;
    pauseAfterRestore?: boolean | null;
    stopCommandAvailable?: boolean | null;
    stopCommandNoDamage?: boolean | null;
    whitelistEnabledDefault?: boolean | null;
    kickWhenNoMatchLoaded?: boolean | null;
    playoutEnabledDefault?: boolean | null;
    resetCvarsOnSeriesEnd?: boolean | null;
    usePauseCommandForTacticalPause?: boolean | null;
    autostartMode?: 'enabled' | 'disabled' | 'ready_check' | null;
    demoPath?: string | null;
    demoNameFormat?: string | null;
    demoUploadUrl?: string | null;
  } | null;
}

export interface ServersResponse extends ApiResponse {
  servers: Server[];
}

export interface ServerResponse extends ApiResponse {
  server: Server;
}

export interface ServerStatusResponse extends ApiResponse {
  serverId: string;
  status: string;
  isAvailable: boolean;
  currentMatch: string | null;
  playerCount?: number;
}

// Team types
export interface TeamsResponse extends ApiResponse {
  teams: Team[];
  count: number;
}

export interface TeamResponse extends ApiResponse {
  team: Team;
}

export interface TeamStatsResponse extends ApiResponse {
  stats: TeamStats;
}

export interface TeamLeaderboardResponse extends ApiResponse {
  leaderboard: TeamStanding[];
}

// Match types
export interface MatchesResponse extends ApiResponse {
  matches: Match[];
  count?: number;
}

export interface MatchResponse extends ApiResponse {
  match: Match;
}

export interface MatchHistoryResponse extends ApiResponse {
  matches: Match[];
}

// Tournament types
export interface TournamentResponse extends ApiResponse {
  tournament: Tournament;
}

export interface TournamentBracketResponse extends ApiResponse {
  bracket: {
    matches: Match[];
    teams: Team[];
  };
}

// Player types
export interface PlayerDetail {
  id: string; // Steam ID
  name: string;
  avatar?: string;
  currentElo: number;
  startingElo: number;
  matchCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlayersResponse extends ApiResponse {
  players: PlayerDetail[];
  count?: number;
}

export interface PlayerResponse extends ApiResponse {
  player: PlayerDetail;
}

// Veto types
export interface VetoState {
  matchSlug: string;
  team1: { id: string; name: string; tag?: string };
  team2: { id: string; name: string; tag?: string };
  currentTurn: string;
  vetoSequence: Array<{ team: string; action: string; map?: string; side?: string }>;
  availableMaps: string[];
  pickedMaps: Array<{ mapName: string; team1Side?: string; team2Side?: string }>;
  isComplete: boolean;
}

export interface VetoStateResponse extends ApiResponse {
  vetoState: VetoState;
}

// Log types
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface LogsResponse extends ApiResponse {
  logs: LogEntry[];
}

// Event types
export interface ServerEvent {
  timestamp: number;
  serverId: string;
  matchSlug: string;
  event: {
    event: string;
    matchid: string;
    [key: string]: unknown;
  };
}

export interface ServerEventsResponse extends ApiResponse {
  events: ServerEvent[];
}

export interface ServerListResponse extends ApiResponse {
  servers: Array<{ id: string; name: string; events?: number }>;
}

// RCON types
export interface RconResponse extends ApiResponse {
  output?: string;
  result?: string;
}

// Demo types
export interface Demo {
  matchSlug: string;
  mapNumber: number;
  filename: string;
  size: number;
  created: string;
  url: string;
}

export interface DemosResponse extends ApiResponse {
  demos: Demo[];
}

// Import/Export types
export interface ImportTeamData {
  name: string;
  tag?: string;
  players: Array<{ name: string; steamId: string }>;
}

export interface ImportTeamsResponse extends ApiResponse {
  imported: number;
  teams: Team[];
}

// Player connection types
export interface PlayerConnectionStatus {
  serverId: string;
  matchSlug: string;
  team1Players: Array<{
    name: string;
    steamId: string;
    connected: boolean;
  }>;
  team2Players: Array<{
    name: string;
    steamId: string;
    connected: boolean;
  }>;
}

export interface PlayerConnectionResponse extends ApiResponse {
  status: PlayerConnectionStatus;
}

// Settings types
export interface SettingsResponse extends ApiResponse {
  settings: {
    webhookUrl: string | null;
    steamApiKey: string | null;
    steamApiKeySet: boolean;
    webhookConfigured: boolean;
    defaultPlayerElo: number;
    simulateMatches: boolean;
    matchzyChatPrefix?: string | null;
    matchzyAdminChatPrefix?: string | null;
    matchzyKnifeEnabledDefault?: boolean;
  };
}

// Map types
export interface Map {
  id: string;
  displayName: string;
  imageUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MapsResponse extends ApiResponse {
  maps: Map[];
  count: number;
}

export interface MapResponse extends ApiResponse {
  map: Map;
}

// Map pool types
export interface MapPool {
  id: number;
  name: string;
  mapIds: string[];
  isDefault: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MapPoolsResponse extends ApiResponse {
  mapPools: MapPool[];
  count: number;
}

export interface MapPoolResponse extends ApiResponse {
  mapPool: MapPool;
}
