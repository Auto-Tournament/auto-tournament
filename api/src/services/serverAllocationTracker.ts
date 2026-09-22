import { log } from '../utils/logger';

export type ServerAllocationState = 'idle' | 'allocated' | 'preparing';

export interface ServerAllocationEntry {
  state: ServerAllocationState;
  matchSlug: string | null;
  lastUpdated: number;
}

/**
 * Lightweight in-memory tracker for server allocation state.
 *
 * This augments (but does not replace) the MatchZy plugin convars
 * used by `serverStatusService`. It helps the allocator avoid
 * repeatedly probing servers that we *know* are currently running
 * a match or are in the immediate "postgame" window after a match
 * completes.
 */
class ServerAllocationTracker {
  private readonly states = new Map<string, ServerAllocationEntry>();

  markAllocated(serverId: string, matchSlug: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.states.set(serverId, {
      state: 'allocated',
      matchSlug,
      lastUpdated: now,
    });
    log.debug(`[ALLOC-TRACKER] Server ${serverId} marked as allocated for ${matchSlug}`);
  }

  markPreparing(serverId: string, matchSlug: string | null): void {
    const now = Math.floor(Date.now() / 1000);
    this.states.set(serverId, {
      state: 'preparing',
      matchSlug,
      lastUpdated: now,
    });
    log.debug(
      `[ALLOC-TRACKER] Server ${serverId} marked as preparing (postgame) for ${matchSlug ?? 'n/a'}`
    );
  }

  markIdle(serverId: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.states.set(serverId, {
      state: 'idle',
      matchSlug: null,
      lastUpdated: now,
    });
    log.debug(`[ALLOC-TRACKER] Server ${serverId} marked as idle`);
  }

  getState(serverId: string): ServerAllocationEntry | null {
    return this.states.get(serverId) ?? null;
  }

  isBusy(serverId: string): boolean {
    const state = this.states.get(serverId);
    if (!state) return false;
    return state.state === 'allocated' || state.state === 'preparing';
  }
}

export const serverAllocationTracker = new ServerAllocationTracker();
