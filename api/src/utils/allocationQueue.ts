/**
 * Allocation queue order.
 *
 * The matches page numbers waiting matches (queue position 1, 2, ...) in the
 * order compareQueueOrder defines. Allocation has to hand out servers in that
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
  /** 'WB' | 'LB' | 'GF' | 'GF_RESET' | 'SE' | null. Inferred from the slug when missing. */
  bracket?: string | null;
}

type QueueKey = Pick<QueueEntry, 'id' | 'round' | 'matchNumber'> & {
  slug?: string;
  bracket?: string | null;
};

/** Which bracket a match belongs to, falling back to the slug for rows without one. */
export function matchBracketOf(match: { slug?: string; bracket?: string | null }): string | null {
  if (match.bracket) return match.bracket;
  const slug = match.slug ?? '';
  if (slug === 'gf') return 'GF';
  if (slug.startsWith('lb-')) return 'LB';
  return null;
}

/** Grand finals sort after every bracket round. */
const GRAND_FINAL_STAGE = 100000;

/**
 * Chronological "stage" of a match, so double-elimination brackets interleave.
 *
 * A double-elimination bracket numbers upper and lower rounds separately, and
 * the grand final is round 1 match 1, so sorting on round alone put the grand
 * final third in the queue of an 8-team bracket (QA, MAT 2.4.8). Upper round r
 * is stage 2r-1 and lower round L is stage L+1: UB R1, LB R1, UB R2 + LB R2,
 * LB R3, UB R3 + LB R4, then the grand final. Every other bracket (single
 * elimination, swiss, round robin) keeps plain round order; manual matches
 * (round 0) come first.
 */
export function queueStage(match: QueueKey): number {
  if (match.round <= 0) return -1;
  const bracket = matchBracketOf(match);
  if (bracket === 'GF') return GRAND_FINAL_STAGE;
  if (bracket === 'GF_RESET') return GRAND_FINAL_STAGE + 1;
  if (bracket === 'LB') return match.round + 1;
  return 2 * match.round - 1;
}

function bracketRank(match: QueueKey): number {
  const bracket = matchBracketOf(match);
  if (bracket === 'LB') return 1;
  if (bracket === 'GF') return 2;
  if (bracket === 'GF_RESET') return 3;
  return 0;
}

/** Stage, then upper before lower bracket, then round, match number, row id. */
export function compareQueueOrder(a: QueueKey, b: QueueKey): number {
  const stage = queueStage(a) - queueStage(b);
  if (stage !== 0) return stage;
  const rank = bracketRank(a) - bracketRank(b);
  if (rank !== 0) return rank;
  if (a.round !== b.round) return a.round - b.round;
  if (a.matchNumber !== b.matchNumber) return a.matchNumber - b.matchNumber;
  return a.id - b.id;
}

/** SQL ORDER BY equivalent of compareQueueOrder (for rows with a bracket column). */
export const QUEUE_ORDER_SQL = `
  CASE
    WHEN round <= 0 THEN -1
    WHEN COALESCE(bracket, CASE WHEN slug = 'gf' THEN 'GF' WHEN slug LIKE 'lb-%' THEN 'LB' END) = 'GF' THEN ${GRAND_FINAL_STAGE}
    WHEN bracket = 'GF_RESET' THEN ${GRAND_FINAL_STAGE + 1}
    WHEN COALESCE(bracket, CASE WHEN slug LIKE 'lb-%' THEN 'LB' END) = 'LB' THEN round + 1
    ELSE 2 * round - 1
  END,
  CASE COALESCE(bracket, CASE WHEN slug = 'gf' THEN 'GF' WHEN slug LIKE 'lb-%' THEN 'LB' END)
    WHEN 'LB' THEN 1 WHEN 'GF' THEN 2 WHEN 'GF_RESET' THEN 3 ELSE 0
  END,
  round, match_number, id`;

/**
 * Only a match with both teams known can be waiting for a server. A grand
 * final with empty slots has no queue position (it showed as #3 in the QA run).
 */
export function isQueueable(match: {
  status: string;
  serverId?: string | null;
  team1?: { id?: string } | null;
  team2?: { id?: string } | null;
}): boolean {
  if (match.serverId) return false;
  if (match.status !== 'pending' && match.status !== 'ready') return false;
  const t1 = match.team1?.id;
  const t2 = match.team2?.id;
  return Boolean(t1 && t2 && t1 !== t2);
}

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
