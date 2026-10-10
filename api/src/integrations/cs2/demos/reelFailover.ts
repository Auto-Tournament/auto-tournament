import { recordingTargetFilter } from './recorderFleet';
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
        AND r.enabled = 1
        AND NOT EXISTS (SELECT 1 FROM cs2_recorder_groups g WHERE g.id = r.group_id AND g.enabled = 0)
        AND (r.paused_until IS NULL OR r.paused_until < EXTRACT(EPOCH FROM NOW()))
        AND (r.last_seen > EXTRACT(EPOCH FROM NOW()) - 900
             OR EXISTS (SELECT 1 FROM cs2_highlights h WHERE h.recorder = r.name AND h.status = 'recording'))`,
    [recorder.slice(0, 120)]
  );
  return Number(row?.n ?? 0) > 0;
}

/**
 * The SQL condition a reel claim adds: skip a reel
 * that failed on this recorder while another eligible recorder is online.
 */
export async function reelFailoverFilter(
  recorder: string,
  match?: string,
  tournament?: string
): Promise<{ sql: string; params: unknown[] }> {
  const eligible = match
    ? recordingTargetFilter(match, 'r.name')
    : tournament
      ? `NOT EXISTS (SELECT 1 FROM matches failover_match WHERE failover_match.tournament_id = ${tournament}
         AND NOT ${recordingTargetFilter('failover_match.slug', 'r.name')})`
      : 'TRUE';
  return {
    sql: `(avoid_recorder IS NULL OR avoid_recorder <> ? OR NOT EXISTS (
      SELECT 1 FROM cs2_recorders r
      LEFT JOIN cs2_recorder_groups g ON g.id = r.group_id
      WHERE r.name <> avoid_recorder AND r.enabled = 1 AND COALESCE(g.enabled, 1) = 1
        AND (r.paused_until IS NULL OR r.paused_until < EXTRACT(EPOCH FROM NOW()))
        AND (r.last_seen > EXTRACT(EPOCH FROM NOW()) - 900 OR EXISTS (
          SELECT 1 FROM cs2_highlights busy WHERE busy.recorder = r.name AND busy.status = 'recording'))
        AND ${eligible}))`,
    params: [recorder.slice(0, 120)],
  };
}
