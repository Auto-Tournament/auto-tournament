/**
 * Socket.io Event Types
 * Types for real-time WebSocket events
 */

import type { BracketMatch } from './tournament.types';
import type { MatchZyEvent } from './matchzy-events.types';
import type { DbMatchRow } from './database.types';

/**
 * Tournament update event
 */
export interface TournamentUpdateEvent {
  id?: number;
  status?: string;
  [key: string]: unknown;
}

/**
 * Bracket update event
 */
export interface BracketUpdateEvent {
  action: 'server_assigned' | 'match_loaded' | 'match_restarted' | 'tournament_started' | string;
  matchSlug?: string;
  serverId?: string;
  [key: string]: unknown;
}

/**
 * Match update event - can be BracketMatch, DbMatchRow, or partial match data
 */
export type MatchUpdateEvent = Partial<BracketMatch> | Partial<DbMatchRow> | {
  id?: number;
  slug?: string;
  status?: string;
  [key: string]: unknown;
};

/**
 * Match event (live stats)
 */
export interface MatchEventData {
  matchSlug: string;
  /**
   * The webhook event as received. This used to be a loose index-signature
   * shape, which no declared event interface could satisfy — TypeScript does
   * not give interfaces implicit index signatures — so the one caller failed
   * to typecheck.
   */
  event: MatchZyEvent;
}

/**
 * Player connection status update
 */
export interface PlayerConnectionEvent {
  slug: string;
  connectionStatus: 'waiting' | 'partial' | 'ready' | 'complete';
  [key: string]: unknown;
}

/**
 * Server event for debugging/monitoring
 */
export interface ServerEvent {
  serverId: string;
  event?: string;
  [key: string]: unknown;
}

/**
 * Veto update event
 */
export interface VetoUpdateEvent {
  matchSlug: string;
  veto: {
    status?: 'in_progress' | 'completed';
    pickedMaps?: Array<{
      mapName: string;
      mapNumber: number;
      sideTeam1?: 'CT' | 'T';
    }>;
    [key: string]: unknown;
  } | null;
}

