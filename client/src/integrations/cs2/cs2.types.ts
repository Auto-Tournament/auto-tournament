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
  /** False: a practice/community server that tournament matches never go to. */
  tournamentUse?: boolean;
  /** The platform's virtual skins go to this server. */
  skins?: boolean;
  /** Fleet servers: it runs with a Valve game server token (skins stay off). */
  steamToken?: boolean | null;
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
  /** Unix timestamp when we last sent persistent config via RCON. Set before MatchZy Enhanced sends events. */
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
  /** Best-effort: MatchZy Enhanced DB reachable. */
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
  // Optional real-time status values reported by MatchZy Enhanced and
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
    /** MatchZy Enhanced: 0=idle, 1=match, 2=practice */
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
  /** IPv4 of `host` for the steam://connect link (CS2 ignores a hostname there). */
  ip?: string | null;
  port: number;
  password?: string | null;
  /** The plugin's own status (idle, warmup, live, …), when the server answered. */
  status?: string | null;
  statusDescription?: {
    label: string;
    description: string;
    color: 'success' | 'warning' | 'error' | 'info' | 'default';
  } | null;
  /** Ready Up: a failover moved the match here in the last half hour (players reconnect). */
  moved?: { at: number; reason: string; inPlace: boolean } | null;
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
  /** Taken by the platform because the team ran out of time. */
  timedOut?: boolean;
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
  /** When the current turn runs out (ISO); absent without a time limit. */
  turnDeadline?: string;
  /** Seconds per turn (Match rules), with `turnDeadline`. */
  turnSeconds?: number;
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

/** A map's type (maps/mapModes.ts). */
export type MapGameMode = 'defusal' | 'hostage' | 'wingman' | 'armsrace' | 'deathmatch' | 'other';

export interface Map {
  id: string;
  displayName: string;
  imageUrl: string | null;
  /** Null when not known. */
  gameMode?: MapGameMode | null;
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
  /** `bundled`: GitHub could not be reached, so the map list shipped with the module was used. */
  source?: 'remote' | 'bundled';
  /** What the sync did to the Active Duty pool (`kept`: an admin edited it, so it was left alone). */
  activeDutyPool?: 'created' | 'updated' | 'kept' | 'unchanged' | 'stale';
  stats?: { total: number; added: number; updated?: number; skipped: number; errors: number };
}

/** A Ready Up server on the fleet link (`GET /api/fleet/servers`). */
export interface FleetServer {
  id: string;
  tenantId: string;
  name: string;
  status: 'pending' | 'enrolled' | 'revoked';
  installId: string | null;
  enrolledVia: 'code' | 'key' | null;
  enrollmentKeyId: string | null;
  online: boolean;
  availability: string | null;
  versions: {
    core: string;
    plugin_api: string;
    plugins: Record<string, string>;
    cs2_build?: number;
    cs2_patch?: string;
  } | null;
  /**
   * Ready Up update status (from `GET /api/fleet/servers`). `unknown` while
   * Ready Up has no release to compare against; only `outdated` is a warning.
   */
  readyUpUpdate?: {
    state: 'unknown' | 'current' | 'outdated';
    running: string | null;
    latest: string | null;
    releaseUrl: string | null;
  };
  capabilities: string[];
  host: { hostname: string; game_port: number; tv_port?: number; public_addr?: string } | null;
  health: Record<string, unknown> | null;
  protocol: number | null;
  connectedAt: number | null;
  lastSeen: number | null;
  createdAt: number;
  token: {
    id: string;
    createdAt: number;
    lastUsedAt: number | null;
    rotationDueAt: number;
    rotationPending: boolean;
  } | null;
  rotateRequested: boolean;
  codeExpiresAt: number | null;
  /** The server row it plays matches as (`POST /api/fleet/servers/:id/link`); null = not in the match pool. */
  linkedServerId?: string | null;
  /** Client address of its last hello / enrollment. */
  peerAddr?: string | null;
  /**
   * Where players connect: the linked row's address, or for an unlinked
   * server the one linking would store now. null = nothing known yet.
   */
  connect?: FleetConnect | null;
}

export interface FleetConnect {
  host: string;
  port: number;
  /** `host:port` as typed after `connect`. */
  address: string;
  /** override: set by an admin; public_addr: the server's own report; peer: the link's client address. */
  source: 'override' | 'public_addr' | 'machine' | 'peer' | null;
}

export interface FleetServersResponse extends Cs2ApiResponse {
  servers: FleetServer[];
  count: number;
}

/** A fleet enrollment key (`GET /api/fleet/keys`); the secret is never listed. */
export interface FleetKey {
  id: string;
  name: string;
  namePrefix: string | null;
  maxServers: number | null;
  expiresAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
  useCount: number;
  enrolledServers: number;
  locked: boolean;
  revoked: boolean;
  /** Servers it enrolls are linked for matches on their first hello. */
  autoLink: boolean;
}

export interface FleetKeysResponse extends Cs2ApiResponse {
  keys: FleetKey[];
  count: number;
}

/** One `server-N` on a machine, from csm's `host.inventory` joined to its Ready Up server (FLEET.md §18.3). */
export interface FleetHostServer {
  name: string;
  dir: string;
  game_port: number;
  tv_port?: number;
  status_port: number;
  process: { running: boolean; pid?: number; started_at?: number; restarts_24h: number; cpu_pct?: number; rss_mb?: number };
  readyup: {
    installed: string | null;
    install_id?: string;
    server_id?: string;
    health: 'ok' | 'failing' | 'no_response' | 'not_running';
    phase?: string;
    update_safe?: boolean;
  };
  cs2_build: number;
  launch_args: string[];
  fleetServer: FleetHostServerRef | null;
  matchInProgress: boolean;
}

export interface FleetHostServerRef {
  id: string;
  name: string;
  status: string;
  online: boolean;
  availability: string | null;
  readyUpVersion: string | null;
}

export type FleetHostCommandType =
  | 'host.servers.list'
  | 'server.start'
  | 'server.stop'
  | 'server.restart'
  | 'server.create'
  | 'server.remove'
  | 'server.set_launch_args'
  | 'host.update_game'
  | 'host.update_plugins'
  | 'host.updates_hold'
  | 'logs.tail'
  | 'logs.stop';

/** A command sent to a machine, its progress and its `host.result`. */
export interface FleetHostCommand {
  id: string;
  hostId: string;
  seq: number | null;
  type: FleetHostCommandType;
  server: string | null;
  payload: Record<string, unknown>;
  status: 'pending' | 'ok' | 'rejected' | 'failed';
  errorCode: string | null;
  errorMessage: string | null;
  output: string | null;
  progress: { step: string | null; pct: number | null; at: number | null };
  issuedBy: string | null;
  forcedBy: string | null;
  forceReason: string | null;
  createdAt: number;
  answeredAt: number | null;
}

/** A machine running csm as host agent (`GET /api/fleet/hosts`). */
export interface FleetHost {
  id: string;
  name: string;
  status: 'pending' | 'enrolled' | 'revoked';
  machineId: string | null;
  enrolledVia: 'code' | 'key' | null;
  hostname: string | null;
  os: string | null;
  csmVersion: string | null;
  online: boolean;
  connectedAt: number | null;
  lastSeen: number | null;
  createdAt: number;
  inventory: {
    resources: {
      cpus: number;
      load1: number;
      ram_mb: number;
      ram_free_mb: number;
      disk: Array<{ mount: string; total_gb: number; free_gb: number }>;
    };
    cs2: { master_build: number; master_patch?: string; update_available: boolean; updates_hold: 'on' | 'off' | 'auto' };
  } | null;
  inventoryAt: number | null;
  token: { id: string; createdAt: number; lastUsedAt: number | null; rotationDueAt: number; rotationPending: boolean } | null;
  rotateRequested: boolean;
  codeExpiresAt: number | null;
  servers: FleetHostServer[];
  enrolledServers: FleetHostServerRef[];
  /** What the platform's automatic updates are doing here, once it has looked. */
  autoUpdate: { at: number; game: string; readyUp: string } | null;
  commands: FleetHostCommand[];
  health: Array<{ id: number; server: string; event: string; exitCode: number | null; detail: string | null; receivedAt: number }>;
}

export interface FleetHostsResponse extends Cs2ApiResponse {
  hosts: FleetHost[];
  count: number;
}
