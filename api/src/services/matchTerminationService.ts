import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitMatchUpdate } from './socketService';
import { serverAllocationTracker } from './serverAllocationTracker';
import { matchAllocationService } from './matchAllocationService';
import type { DbMatchRow } from '../types/database.types';

/**
 * Settle MAT's own record after a match has been ended on the game server.
 *
 * Ending a match is two separate things: telling the CS2 server to stop, and
 * recording that it stopped. MatchZy's end command emits no event, so nothing
 * tells MAT about it — the row has to be settled here or it stays 'live'
 * forever. That is exactly what "End Match" did: it sent the RCON command and
 * left the Matches tab showing LIVE indefinitely.
 *
 * Shared by the admin End Match control and by force-cancel so the two cannot
 * drift apart.
 */
export async function settleEndedMatch(
  match: DbMatchRow,
  reason: string
): Promise<void> {
  await db.updateAsync(
    'matches',
    { status: 'cancelled', completed_at: Math.floor(Date.now() / 1000) },
    'slug = ?',
    [match.slug]
  );

  log.info(`Match ${match.slug} marked cancelled (${reason})`);

  // A match that is over must not keep its server out of the pool.
  if (match.server_id) {
    serverAllocationTracker.markIdle(match.server_id);
    log.info(`Server ${match.server_id} freed by ${reason}, triggering immediate allocation`);
    setImmediate(() => {
      void matchAllocationService.tryImmediateAllocation();
    });
  }

  emitMatchUpdate({ slug: match.slug, status: 'cancelled' });
}

/**
 * Find the match a server is currently running, if any.
 *
 * The admin controls act on a server, not a match, so the row has to be looked
 * up from the server id.
 */
export async function findActiveMatchForServer(serverId: string): Promise<DbMatchRow | null> {
  const row = await db.queryOneAsync<DbMatchRow>(
    `SELECT * FROM matches
      WHERE server_id = ?
        AND status IN ('loaded', 'live')
      ORDER BY id DESC
      LIMIT 1`,
    [serverId]
  );
  return row ?? null;
}
