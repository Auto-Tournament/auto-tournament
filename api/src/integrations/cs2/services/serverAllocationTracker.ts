import { db } from '../../../config/database';
import { log } from '../../../utils/logger';

export type ServerAllocationState = 'idle' | 'allocated' | 'preparing';

export interface ServerAllocationEntry {
  state: ServerAllocationState;
  matchSlug: string | null;
  lastUpdated: number;
}

/**
 * Lightweight in-memory tracker for server allocation state.
 *
 * This augments (but does not replace) MatchZy Enhanced convars
 * used by `serverStatusService`. It helps the allocator avoid
 * repeatedly probing servers that we *know* are currently running
 * a match or are in the immediate "postgame" window after a match
 * completes.
 */
/** Match statuses that still hold their server. */
const ACTIVE_STATUSES = new Set(['pending', 'ready', 'loaded', 'live']);
/** A postgame entry with no match is held this long. */
const POSTGAME_HOLD_S = 300;

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

  /**
   * Free the servers whose match is over. Nothing marks a server idle when
   * its series ends, and the allocator skips a busy server before it ever
   * looks at it again, so without this a server stayed busy until the API
   * restarted (2026-10-12 bracket test: the final found no server). A server
   * is free again when its match is finished, cancelled, gone or moved to
   * another server; a postgame entry without a match after 5 minutes.
   */
  async releaseFinished(now = Math.floor(Date.now() / 1000)): Promise<void> {
    const busy = [...this.states.entries()].filter(
      ([, entry]) => entry.state === 'allocated' || entry.state === 'preparing'
    );
    if (busy.length === 0) return;
    const slugs = [...new Set(busy.map(([, e]) => e.matchSlug).filter((s): s is string => !!s))];
    const rows = slugs.length
      ? await db.queryAsync<{ slug: string; status: string; server_id: string | null }>(
          `SELECT slug, status, server_id FROM matches WHERE slug IN (${slugs.map(() => '?').join(', ')})`,
          slugs
        )
      : [];
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    for (const [serverId, entry] of busy) {
      if (!entry.matchSlug) {
        if (now - entry.lastUpdated > POSTGAME_HOLD_S) this.markIdle(serverId);
        continue;
      }
      const match = bySlug.get(entry.matchSlug);
      const running =
        !!match &&
        ACTIVE_STATUSES.has(match.status) &&
        (!match.server_id || match.server_id === serverId);
      if (!running) {
        log.info(
          `[ALLOC-TRACKER] Server ${serverId} is free again: ${entry.matchSlug} is ${match ? match.status : 'gone'}`
        );
        this.markIdle(serverId);
      }
    }
  }

  isBusy(serverId: string): boolean {
    const state = this.states.get(serverId);
    if (!state) return false;
    return state.state === 'allocated' || state.state === 'preparing';
  }
}

export const serverAllocationTracker = new ServerAllocationTracker();
