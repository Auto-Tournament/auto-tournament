import { db } from '../../../config/database';

/**
 * Reel failover. A reel (match, team or tournament) that fails on a recorder
 * remembers it (`avoid_recorder`) and goes to another recorder next, so a
 * recorder that runs out of memory on a reel does not retry it while another
 * could make it. A lone recorder still gets it again.
 */

/**
 * Whether another recorder than `recorder` can take work now or soon: asked
 * in the last 15 minutes or at a job, and not paused.
 */
export async function otherRecorderOnline(recorder: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM cs2_recorders r
      WHERE r.name <> ?
        AND (r.paused_until IS NULL OR r.paused_until < EXTRACT(EPOCH FROM NOW()))
        AND (r.last_seen > EXTRACT(EPOCH FROM NOW()) - 900
             OR EXISTS (SELECT 1 FROM cs2_highlights h WHERE h.recorder = r.name AND h.status = 'recording'))`,
    [recorder.slice(0, 120)]
  );
  return Number(row?.n ?? 0) > 0;
}

/**
 * The SQL condition a reel claim adds (with its two parameters): skip a reel
 * that failed on this recorder while another recorder is online.
 */
export async function reelFailoverFilter(
  recorder: string
): Promise<{ sql: string; params: unknown[] }> {
  return {
    sql: '(avoid_recorder IS NULL OR avoid_recorder <> ? OR ?)',
    params: [recorder.slice(0, 120), !(await otherRecorderOnline(recorder))],
  };
}
