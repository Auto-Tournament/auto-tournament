/**
 * Allocation queue order.
 *
 * The matches page numbers waiting matches (queue position 1, 2, ...) by round,
 * then match number, then row id. Allocation has to hand out servers in that
 * same order, or the numbers are a lie.
 *
 * It did not: every ready match ran its own 10-second poller, and whichever
 * poller ticked first when a server freed up took it. Seen on real servers
 * (MAT 2.4.7, 3 servers, 8-team Bo1): r1m3 and r1m4 loaded while r1m2, queue
 * position 2, waited for the next free server.
 */
export interface QueueEntry {
  id: number;
  slug: string;
  round: number;
  matchNumber: number;
}

/** Round, then match number, then row id (manual matches share round 0 / match 0). */
export function compareQueueOrder(
  a: Pick<QueueEntry, 'id' | 'round' | 'matchNumber'>,
  b: Pick<QueueEntry, 'id' | 'round' | 'matchNumber'>
): number {
  if (a.round !== b.round) return a.round - b.round;
  if (a.matchNumber !== b.matchNumber) return a.matchNumber - b.matchNumber;
  return a.id - b.id;
}

/** SQL ORDER BY equivalent of compareQueueOrder. */
export const QUEUE_ORDER_SQL = 'round, match_number, id';

/**
 * May this match take a server now, given the ready matches still waiting and
 * how many servers are free?
 *
 * With N free servers, only the first N waiting matches in queue order may
 * take one. A match further back waits, and the ones ahead of it are returned
 * so the caller can make sure they are being retried.
 *
 * A match that is not in the queue (a manual match, or one that is no longer
 * waiting) is not held back by it.
 */
export function checkQueueTurn(
  queue: QueueEntry[],
  matchSlug: string,
  freeServerCount: number
): { allowed: boolean; position: number | null; ahead: QueueEntry[] } {
  const ordered = [...queue].sort(compareQueueOrder);
  const index = ordered.findIndex((entry) => entry.slug === matchSlug);
  if (index === -1) {
    return { allowed: true, position: null, ahead: [] };
  }
  const ahead = ordered.slice(0, index);
  return {
    allowed: index < Math.max(0, freeServerCount),
    position: index + 1,
    ahead,
  };
}
