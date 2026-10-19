/**
 * Socket.io Event Types
 * Types for real-time WebSocket events
 */

import type { BracketMatch } from './tournament.types';
import type { DbMatchRow } from './database.types';
import type { Untrusted } from '../utils/untrusted';

/**
 * Tournament update event
 */
export interface TournamentUpdateEvent {
  id?: number;
  status?: string;
  [key: string]: Untrusted;
}

/**
 * Bracket update event
 */
export interface BracketUpdateEvent {
  action: 'server_assigned' | 'match_loaded' | 'match_restarted' | 'tournament_started' | string;
  matchSlug?: string;
  serverId?: string;
  [key: string]: Untrusted;
}

/**
 * Match update event - can be BracketMatch, DbMatchRow, or partial match data
 */
export type MatchUpdateEvent =
  | Partial<BracketMatch>
  | Partial<DbMatchRow>
  | {
      id?: number;
      slug?: string;
      status?: string;
      [key: string]: Untrusted;
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
  event: GameWebhookEvent;
}

/**
 * A game server's webhook event as the integration received it (CS2: a
 * MatchZy Enhanced event, typed in integrations/cs2/events/plugin-events.types.ts).
 * The core only relays and logs these, so it needs no more than the name.
 */
export interface GameWebhookEvent {
  event: string;
}

/**
 * Player connection status update
 */
export interface PlayerConnectionEvent {
  slug: string;
  connectionStatus: 'waiting' | 'partial' | 'ready' | 'complete';
  [key: string]: Untrusted;
}

/**
 * Server event for debugging/monitoring
 */
export interface ServerEvent {
  serverId: string;
  event?: string;
  [key: string]: Untrusted;
}

/**
 * Veto update event
 */
export interface VetoUpdateEvent {
  matchSlug: string;
  /** The whole veto state; the fields listed are the ones the client reads. */
  veto: {
    status?: 'pending' | 'in_progress' | 'completed';
    pickedMaps?: Array<{
      mapName: string;
      mapNumber: number;
      sideTeam1?: 'CT' | 'T';
    }>;
  } | null;
}

export type { CompatUpdateEvent } from './compat.types';
