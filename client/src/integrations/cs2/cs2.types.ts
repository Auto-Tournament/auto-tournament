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

/** The route above, as this module asks it itself. */
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
