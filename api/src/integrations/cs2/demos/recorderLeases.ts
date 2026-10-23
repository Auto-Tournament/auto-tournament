import { randomUUID } from 'node:crypto';
import { db } from '../../../config/database';

// Older recorders heartbeat every five minutes. Allow two missed heartbeats.
export const RECORDER_LEASE_SECONDS = 12 * 60;
// One attempt's limit, heartbeats or not: only a backstop. A job may take hours (one map job is
// every player's moments, rendered as slowly as the GPU needs); the recorder stops one that
// stops moving itself (stallWatch), and the lease catches one that went away.
export const RECORDER_JOB_SECONDS = 24 * 60 * 60;
export const SAME_RECORDER_RETRY_SECONDS = 90;
export const RECORDING_ATTEMPTS = 3;
export const RECORDING_TABLES = [
  'cs2_highlights',
  'cs2_match_reels',
  'cs2_team_reels',
  'cs2_tournament_reels',
] as const;

/** A first failure gives its owner one retry, with a bounded reservation. */
export function recordingWaiting(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `(${p}status = 'pending' AND ${p}attempts < ${RECORDING_ATTEMPTS}
    AND (${p}retry_until IS NULL OR ${p}retry_until <= EXTRACT(EPOCH FROM NOW()) OR ${p}recorder = ?))`;
}

/** Run before claims, including claims by paused workers. No healthy peer, no work. */
export async function recoverRecordingLeases(): Promise<number[]> {
  await db.runAsync(
    `DELETE FROM cs2_recorder_claims WHERE heartbeat_at < EXTRACT(EPOCH FROM NOW()) - ${RECORDER_LEASE_SECONDS} OR started_at < EXTRACT(EPOCH FROM NOW()) - ${RECORDER_JOB_SECONDS}`
  );
  const failed: number[] = [];
  for (const table of RECORDING_TABLES) {
    const rows = await db.queryAsync<{ id?: number; status: string }>(
      `UPDATE ${table} SET
        status = CASE WHEN attempts >= ${RECORDING_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
        error = 'Recorder lease expired or job exceeded 24 hours',
        retry_until = CASE WHEN attempts = 1 THEN EXTRACT(EPOCH FROM NOW())::INTEGER + ${SAME_RECORDER_RETRY_SECONDS} ELSE NULL END,
        avoid_recorder = CASE WHEN attempts >= 2 THEN recorder ELSE NULL END
       WHERE (status = 'pending' AND attempts >= ${RECORDING_ATTEMPTS}) OR (status = 'recording' AND (
         claimed_at IS NULL OR claimed_at < EXTRACT(EPOCH FROM NOW()) - ${RECORDER_LEASE_SECONDS}
         OR claim_started_at < EXTRACT(EPOCH FROM NOW()) - ${RECORDER_JOB_SECONDS}))
       RETURNING ${table === 'cs2_highlights' ? 'id, ' : ''}status`,
      []
    );
    if (table === 'cs2_highlights') {
      failed.push(...rows.filter((r) => r.status === 'failed').map((r) => Number(r.id)));
    }
  }
  return failed;
}

export async function recorderHasActiveClaim(recorder: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ active: boolean }>(
    `SELECT (EXISTS (SELECT 1 FROM cs2_recorder_claims WHERE recorder = ?) OR ${RECORDING_TABLES.map((table) => `EXISTS (SELECT 1 FROM ${table} WHERE recorder = ? AND status = 'recording')`).join(' OR ')}) AS active`,
    [recorder.slice(0, 120), ...RECORDING_TABLES.map(() => recorder.slice(0, 120))]
  );
  return row?.active === true;
}

/** Failure reports and lease expiry follow the same retry policy. */
export const recordingFailureSql = `status = CASE WHEN attempts >= ${RECORDING_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
  error = ?,
  retry_until = CASE WHEN attempts = 1 THEN EXTRACT(EPOCH FROM NOW())::INTEGER + ${SAME_RECORDER_RETRY_SECONDS} ELSE NULL END,
  avoid_recorder = CASE WHEN attempts >= 2 THEN recorder ELSE NULL END`;

/**
 * A recorder that has just started can't be recording anything: what is still
 * claimed in its name was left by its previous run (a restart or crash). That
 * goes back now instead of when its lease runs out.
 */
export async function releaseRecorderWork(recorder: string): Promise<number[]> {
  const name = recorder.slice(0, 120);
  await db.runAsync('DELETE FROM cs2_recorder_claims WHERE recorder = ?', [name]);
  const failed: number[] = [];
  for (const table of RECORDING_TABLES) {
    const rows = await db.queryAsync<{ id?: number; status: string }>(
      `UPDATE ${table} SET ${recordingFailureSql} WHERE recorder = ? AND status = 'recording'
       RETURNING ${table === 'cs2_highlights' ? 'id, ' : ''}status`,
      ['The recorder restarted during the job', name]
    );
    if (table === 'cs2_highlights') {
      failed.push(...rows.filter((r) => r.status === 'failed').map((r) => Number(r.id)));
    }
  }
  return failed;
}

export async function renewRecordingLeases(recorder: string): Promise<number> {
  let renewed = 0;
  for (const table of RECORDING_TABLES) {
    const result = await db.runAsync(
      `UPDATE ${table} SET claimed_at = EXTRACT(EPOCH FROM NOW())::INTEGER
       WHERE recorder = ? AND status = 'recording'
         AND claimed_at >= EXTRACT(EPOCH FROM NOW()) - ${RECORDER_LEASE_SECONDS}
         AND claim_started_at >= EXTRACT(EPOCH FROM NOW()) - ${RECORDER_JOB_SECONDS}`,
      [recorder.slice(0, 120)]
    );
    renewed += result.changes;
  }
  return renewed;
}

export async function registerRecorderClaim(recorder: string): Promise<string> {
  const token = randomUUID();
  await db.runAsync(
    'INSERT INTO cs2_recorder_claims (recorder, token, started_at, heartbeat_at) VALUES (?, ?, EXTRACT(EPOCH FROM NOW())::INTEGER, EXTRACT(EPOCH FROM NOW())::INTEGER)',
    [recorder.slice(0, 120), token]
  );
  return token;
}
export async function validRecorderClaim(recorder: string, token: string): Promise<boolean> {
  return !!(await db.queryOneAsync(
    `SELECT 1 FROM cs2_recorder_claims WHERE recorder = ? AND token = ? AND heartbeat_at >= EXTRACT(EPOCH FROM NOW()) - ${RECORDER_LEASE_SECONDS} AND started_at >= EXTRACT(EPOCH FROM NOW()) - ${RECORDER_JOB_SECONDS}`,
    [recorder.slice(0, 120), token]
  ));
}
export async function heartbeatRecorderClaim(recorder: string, token: string): Promise<void> {
  await db.runAsync(
    'UPDATE cs2_recorder_claims SET heartbeat_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE recorder = ? AND token = ?',
    [recorder.slice(0, 120), token]
  );
}
