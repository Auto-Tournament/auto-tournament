/**
 * Counter-Strike 2's own data shapes: servers, the fleet's availability and
 * the map veto.
 *
 * These belong to the module, not to the platform (DESIGN-module-client-api.md
 * §2.2, rule 2): a slot takes ids and the module fetches what it shows, so the
 * shapes of what it fetches are its own. Core still keeps copies of some of
 * them in `client/src/types` while its own pages read CS2 routes (item 10).
 * This module does not import those: a module built on its own would not have
 * them.
 */

import type { ResourceAvailability } from '../types';

interface Cs2ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

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
  // Server tracking fields (from Auto Tournament CS2 server_configured event)
  pluginVersion?: string | null; // Auto Tournament CS2 version (e.g., "1.3.6")
  hostname?: string | null; // CS2 server hostname (from hostname convar)
  lastSeen?: number | null; // Unix timestamp of last event received (heartbeat)
  /** Unix timestamp when we last sent persistent config via RCON. Set before Auto Tournament CS2 sends events. */
  persistentConfigSent?: number | null;
  /** If set, the server has reported a CS2 update is required (Steam required_version). */
  cs2RequiredVersion?: number | null;
  /** Best-effort: phase of the update signal ('available'|'shutdown'). */
  cs2UpdatePhase?: string | null;
  /** Unix timestamp when update was last reported. */
  cs2UpdateRequiredAt?: number | null;
  /** Best-effort: CS2 server build ID parsed from `version` output. */
  cs2BuildId?: number | null;
  /** Unix timestamp when the platform last ran the Steam UpToDateCheck for this server. */
  cs2UpdateCheckedAt?: number | null;
  /** Best-effort: `version` output (display-only; may include multiple lines). */
  cs2VersionString?: string | null;
  /** Unix timestamp when version/build was last fetched via RCON. */
  cs2VersionFetchedAt?: number | null;
  /** Best-effort: Auto Tournament CS2 plugin DB reachable. */
  atDbOk?: boolean | null;
  /** Best-effort: 'sqlite' | 'mysql'. */
  atDbType?: string | null;
  /** Best-effort: last DB error message (if any). */
  atDbError?: string | null;
  /** Unix timestamp when DB was last reported OK. */
  atDbLastOkAt?: number | null;
  /** Unix timestamp when DB health was last reported. */
  atDbLastSeenAt?: number | null;
  /** Unix timestamp when server last successfully sent any event to /api/events. */
  serverCanReachApiAt?: number | null;
  // Optional real-time status values reported by the Auto Tournament CS2 plugin and
  // allocator. These are populated by /api/servers/:id/status and are used
  // purely for UI display on the Servers page.
  pluginStatus?: string | null;
  allocationState?: string | null;
  allocationMatchSlug?: string | null;
  ipBanned?: boolean; // True if server has banned our IP address
  atConfig?: {
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
    /** Auto Tournament CS2: 0=idle, 1=match, 2=practice */
    autostartMode?: 0 | 1 | 2 | null;
    demoPath?: string | null;
    hostnameFormat?: string | null;
    demoNameFormat?: string | null;
    demoUploadUrl?: string | null;
  } | null;
}

export interface ServersResponse extends Cs2ApiResponse {
  servers: Server[];
}

/** `GET /api/servers/:id/status`: one server's live (or cached) status. */
export interface ServerStatusResponse extends Cs2ApiResponse {
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
  /** If set, Steam reports this server is out of date (required_version). */
  cs2RequiredVersion?: number | null;
  /** Best-effort: phase of the update signal ('available'|'shutdown'). */
  cs2UpdatePhase?: string | null;
  /** Unix timestamp when the platform last checked UpToDateCheck for this server. */
  cs2UpdateCheckedAt?: number | null;
}

/**
 * `GET /api/matches?serverId=…`, read by the Servers page only to find the
 * match a server is running: the platform's match list, of which this module
 * needs the slug and status.
 */
export interface ServerMatchesResponse extends Cs2ApiResponse {
  matches: Array<{ slug: string; status: string }>;
}

/**
 * `GET /api/settings`, read only for whether the webhook URL (the address a
 * CS2 server reaches the platform on) is set. The rest is the platform's.
 */
export interface WebhookSettings {
  webhookConfigured?: boolean;
  /** The URL itself, as `GET /api/settings` answers it (null when unset). */
  webhookUrl?: string | null;
}

export interface WebhookSettingsResponse extends Cs2ApiResponse {
  settings?: WebhookSettings;
}

/** One server as `/api/tournament/server-availability` describes it. */
export interface ServerAllocationInfo {
  id: string;
  name: string;
  online: boolean;
  status: string | null;
  matchSlug: string | null;
  matchNumber: number | null;
  matchRound: number | null;
  /** 'WB' | 'LB' | 'GF' | 'GF_RESET' | 'SE' | null */
  matchBracket?: string | null;
  updatedAt: number | null;
  inGraceWindow: boolean;
  secondsUntilReady: number | null;
  allocatable: boolean;
  /** Why this server cannot take a match right now, if it can't. */
  notAllocatableReason?:
    | 'offline'
    | 'busy'
    | 'grace-window'
    | 'demo-upload'
    | 'cs2-out-of-date'
    | 'cs2-unverified'
    | null;
  /** Set when a 'loaded' row was overridden as stale (past the allocator's staleness window). */
  staleMatchSlug?: string | null;
}

/**
 * `/api/tournament/server-availability`: what the fleet can take right now.
 * The module names that route as its `resourceAvailabilityEndpoint`, so this
 * is also what core hands the queue slots as their `availability`.
 */
export interface ServerAvailability extends Cs2ApiResponse {
  availableServerCount: number;
  gracePeriodSeconds: number;
  nextAllocationInSeconds: number | null;
  requiredServerCount: number;
  servers: ServerAllocationInfo[];
  simulationEnabled: boolean;
}

/** The server a player joins, as the connect route describes it. */
export interface MatchServer {
  id: string;
  name: string;
  host: string;
  port: number;
  password?: string | null;
  /** The plugin's own status (idle, warmup, live, …), when the server answered. */
  status?: string | null;
  statusDescription?: {
    label: string;
    description: string;
    color: 'success' | 'warning' | 'error' | 'info' | 'default';
  } | null;
}

/** `GET /api/game/cs2/matches/:slug/connect`: how the viewer joins one match. */
export interface MatchConnectResponse extends Cs2ApiResponse {
  viewerIsTeamMember: boolean;
  matchStatus: string;
  /** The live-stats phase (warmup, knife, live, halftime, postgame), once there are live stats. */
  liveStatus: string | null;
  currentMap: string | null;
  mapNumber: number | null;
  /** Null for a viewer on neither team, and for a match with no server. */
  server: MatchServer | null;
}

/** The availability route, as this module asks it itself. */
export const SERVER_AVAILABILITY_ENDPOINT = '/api/tournament/server-availability';

/**
 * The availability core handed a slot, read as what it is: this module's own
 * answer from its own endpoint. Core types it loosely, because
 * `nextAllocationInSeconds` is the only part core reads.
 */
export function asServerAvailability(
  availability: ResourceAvailability | null | undefined
): ServerAvailability | null {
  return (availability as ServerAvailability | null | undefined) ?? null;
}

/** The admin home card's breakdown of the enabled fleet. */
export interface ServerFleetCounts {
  online: number;
  inMatch: number;
  free: number;
  offline: number;
  /** Added and enabled, but never sent an event: the allocator cannot use them yet. */
  notConfigured: number;
  total: number;
}

/** Which plugin versions the fleet reports. */
export interface PluginVersionSummary {
  /** Distinct plugin versions reported by enabled servers that have reported one. */
  versions: string[];
  /** The single version every reporting server is on, when they agree. */
  commonVersion: string | null;
}

// ---------------------------------------------------------------------------
// Map veto
// ---------------------------------------------------------------------------

export type VetoActionType = 'ban' | 'pick' | 'side_pick';
export type VetoTeam = 'team1' | 'team2';
export type MapSide = 'CT' | 'T';

export interface VetoAction {
  step: number;
  team: VetoTeam;
  action: VetoActionType;
  mapName: string;
  side?: MapSide;
  timestamp: number;
}

export interface VetoMapResult {
  mapNumber: number;
  mapName: string;
  pickedBy: VetoTeam | 'decider';
  sideTeam1?: MapSide;
  sideTeam2?: MapSide;
  knifeRound: boolean;
}

export interface VetoState {
  matchSlug: string;
  format: 'bo1' | 'bo3' | 'bo5';
  status: 'pending' | 'in_progress' | 'completed';
  currentStep: number;
  totalSteps: number;
  availableMaps: string[];
  bannedMaps: string[];
  pickedMaps: VetoMapResult[];
  /** Original order of all maps (for display purposes). */
  allMaps?: string[];
  actions: VetoAction[];
  currentTurn: VetoTeam;
  currentAction: VetoActionType;
  team1Id?: string;
  team2Id?: string;
  team1Name?: string;
  team2Name?: string;
  completedAt?: string;
}

export interface VetoStep {
  step: number;
  team: VetoTeam;
  action: VetoActionType;
  description: string;
}

/** A map's name and pictures, from the built-in list (`maps/mapData.ts`). */
export interface CS2MapData {
  name: string;
  displayName: string;
  /** Full-size image used for large hero/background displays. */
  image: string;
  /** Smaller thumbnail variant used for lists, chips, and small cards. */
  thumbnail: string;
}

/** A veto map's display name and picture, as the admin set them. */
export interface VetoMapInfo {
  id: string;
  displayName: string;
  imageUrl: string | null;
}

/** `GET /api/veto/:matchSlug`. A spectator's copy carries only some fields. */
export interface VetoStateResponse extends Cs2ApiResponse {
  veto?: Partial<VetoState>;
  /**
   * Names and pictures of the veto's maps, sent with the veto so players do
   * not need the admin-only `/api/maps` (and see the same names admins do).
   */
  maps?: VetoMapInfo[];
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

export interface Map {
  id: string;
  displayName: string;
  imageUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MapsResponse extends Cs2ApiResponse {
  maps: Map[];
  count: number;
}

export interface MapResponse extends Cs2ApiResponse {
  map: Map;
}

export interface MapPool {
  id: number;
  name: string;
  mapIds: string[];
  isDefault: boolean;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MapPoolsResponse extends Cs2ApiResponse {
  mapPools: MapPool[];
  count: number;
}

export interface MapPoolResponse extends Cs2ApiResponse {
  mapPool: MapPool;
}

// ---------------------------------------------------------------------------
// Admin tools: RCON and the server events monitor
// ---------------------------------------------------------------------------

/** One server's answer to an RCON command (`POST /api/rcon/command`). */
export interface RconResult {
  serverId: string;
  serverName: string;
  success: boolean;
  error?: string;
  response?: string;
}

export interface RconResultsResponse extends Cs2ApiResponse {
  results?: RconResult[];
}

/** One event a server sent, as the events monitor shows it. */
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

export interface ServerEventsResponse extends Cs2ApiResponse {
  events: ServerEvent[];
}

/** `POST /api/maps/sync`. */
export interface MapSyncResponse extends Cs2ApiResponse {
  stats?: { total: number; added: number; skipped: number; errors: number };
  errors?: string[];
  errorType?: 'rate_limit' | 'github_error' | 'unknown';
}
