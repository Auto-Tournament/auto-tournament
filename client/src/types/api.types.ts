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
  reachableFromApi?: boolean;
  serverCanReachApi?: boolean;
  // Server tracking fields (from MatchZy Enhanced server_configured event)
  pluginVersion?: string | null; // MatchZy Enhanced version (e.g., "1.3.6")
  hostname?: string | null; // CS2 server hostname (from hostname convar)
  lastSeen?: number | null; // Unix timestamp of last event received (heartbeat)
  /** Unix timestamp when we last sent persistent config via RCON. Set before MatchZy sends events. */
  persistentConfigSent?: number | null;
  /** If set, the server has reported a CS2 update is required (Steam required_version). */
  cs2RequiredVersion?: number | null;
  /** Best-effort: phase of the update signal ('available'|'shutdown'). */
  cs2UpdatePhase?: string | null;
  /** Unix timestamp when update was last reported. */
  cs2UpdateRequiredAt?: number | null;
  /** Best-effort: CS2 server build ID parsed from `version` output. */
  cs2BuildId?: number | null;
  /** Best-effort: `version` output (display-only; may include multiple lines). */
  cs2VersionString?: string | null;
  /** Unix timestamp when version/build was last fetched via RCON. */
  cs2VersionFetchedAt?: number | null;
  // Optional real-time status values reported by the MatchZy plugin and
  // allocator. These are populated by /api/servers/:id/status and are used
  // purely for UI display on the Servers page.
  pluginStatus?: string | null;
  allocationState?: string | null;
  allocationMatchSlug?: string | null;
  ipBanned?: boolean; // True if server has banned our IP address
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
    /** MatchZy Enhanced: 0=idle, 1=match, 2=practice */
    autostartMode?: 0 | 1 | 2 | null;
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
  queuedMatch?: string | null;
  playerCount?: number;
  reachableFromApi?: boolean;
  serverCanReachApi?: boolean;
  pluginStatus?: string | null;
  allocationState?: string | null;
  allocationMatchSlug?: string | null;
  ipBanned?: boolean; // True if server has banned our IP address
  cs2BuildId?: number | null;
  cs2VersionString?: string | null;
  cs2VersionFetchedAt?: number | null;
}

export interface ServerAllocationInfo {
  id: string;
  name: string;
  online: boolean;
  status: string | null;
  matchSlug: string | null;
  matchNumber: number | null;
  matchRound: number | null;
  updatedAt: number | null;
  inGraceWindow: boolean;
  secondsUntilReady: number | null;
  allocatable: boolean;
}

export interface ServerAvailabilityResponse extends ApiResponse {
  availableServerCount: number;
  gracePeriodSeconds: number;
  nextAllocationInSeconds: number | null;
  requiredServerCount: number;
  servers: ServerAllocationInfo[];
  simulationEnabled: boolean;
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
  isAdmin?: boolean;
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
    simulationTimescale?: number;
    matchzyChatPrefix?: string | null;
    matchzyAdminChatPrefix?: string | null;
    matchzyKnifeEnabledDefault?: boolean;
    matchzyDebugChatEnabled?: boolean;
    ratingsEnabled?: boolean;
    allowSelfRegister?: boolean;
    // MatchZy core defaults
    matchzyAutostartMode?: 0 | 1 | 2;
    matchzyMinimumReadyRequired?: number;
    matchzyAllowForceReady?: boolean;
    matchzyKickWhenNoMatchLoaded?: boolean;
    matchzyWhitelistEnabledDefault?: boolean;
    matchzyPauseAfterRestore?: boolean;
    matchzyStopCommandAvailable?: boolean;
    matchzyStopCommandNoDamage?: boolean;
    matchzyUsePauseCommandForTacticalPause?: boolean;
    matchzyDemoPath?: string;
    matchzyDemoNameFormat?: string;
    matchzySeriesEndKickDelayNoDemo?: number;
    matchzySeriesEndKickDelayDemoNoUpload?: number;
    matchzySeriesEndKickDelayDemoUpload?: number;
    // MatchZy Enhanced v1.3.0 settings (null = use tournament defaults)
    matchzyAutoreadyEnabled?: 0 | 1 | null;
    matchzyBothTeamsUnpauseRequired?: 0 | 1 | null;
    matchzyMaxPausesPerTeam?: number | null;
    matchzyPauseDuration?: number | null;
    matchzySideSelectionEnabled?: 0 | 1 | null;
    matchzySideSelectionTime?: number | null;
    matchzyGgEnabled?: 0 | 1 | null;
    matchzyGgThreshold?: number | null;
    matchzyGgMinScoreDiff?: number | null;
    matchzyFfwEnabled?: 0 | 1 | null;
    matchzyFfwTime?: number | null;
    matchzyDemoRecordingEnabled?: 0 | 1 | null;
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
