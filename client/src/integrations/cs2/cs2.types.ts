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
  /** Auto Tournament CS2 plugin version (e.g. "1.3.6"), from its server_configured event. */
  pluginVersion?: string | null;
  /** CS2 server hostname (from the hostname convar). */
  hostname?: string | null;
  /** Unix timestamp of the last event received (heartbeat). */
  lastSeen?: number | null;
}

export interface ServersResponse extends Cs2ApiResponse {
  servers: Server[];
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

/** `GET /api/veto/:matchSlug`. A spectator's copy carries only some fields. */
export interface VetoStateResponse extends Cs2ApiResponse {
  veto?: Partial<VetoState>;
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
