import { randomUUID } from 'node:crypto';
import { refreshRecorderRelease, newerRecorderAgent } from './recorderUpdates';
import { db } from '../../../config/database';
export class FleetError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
export async function listRecorderGroups() {
  const rows = await db.queryAsync<{ id: number; name: string; enabled: number }>(
    'SELECT id,name,enabled FROM cs2_recorder_groups ORDER BY name'
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, enabled: Number(r.enabled) === 1 }));
}
export async function requireGroup(id: unknown): Promise<number | null> {
  if (id === null) return null;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
    throw new FleetError(400, 'Choose a valid recorder group');
  if (!(await db.queryOneAsync('SELECT id FROM cs2_recorder_groups WHERE id = ?', [id])))
    throw new FleetError(404, 'No such recorder group');
  return id;
}
export async function createRecorderGroup(name: unknown) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
    throw new FleetError(400, 'Group name must contain 1–80 characters');
  const row = await db.queryOneAsync<{ id: number }>(
    'INSERT INTO cs2_recorder_groups (name) VALUES (?) ON CONFLICT (name) DO NOTHING RETURNING id',
    [name.trim()]
  );
  if (!row) throw new FleetError(409, 'A recorder group with that name already exists');
  return Number(row.id);
}
export async function setGroupEnabled(id: number, enabled: unknown) {
  await requireGroup(id);
  if (typeof enabled !== 'boolean') throw new FleetError(400, 'Enabled must be a boolean');
  await db.runAsync('UPDATE cs2_recorder_groups SET enabled = ? WHERE id = ?', [
    enabled ? 1 : 0,
    id,
  ]);
}
export async function setRecorderControls(
  name: string,
  body: { enabled?: unknown; groupId?: unknown }
) {
  if (body.enabled === undefined && body.groupId === undefined)
    throw new FleetError(400, 'Supply enabled or groupId');
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean')
    throw new FleetError(400, 'Enabled must be a boolean');
  const group = body.groupId === undefined ? undefined : await requireGroup(body.groupId);
  if (!(await db.queryOneAsync('SELECT name FROM cs2_recorders WHERE name = ?', [name])))
    throw new FleetError(404, 'No such recorder');
  await db.runAsync(
    `UPDATE cs2_recorders SET
       enabled = CASE WHEN ? THEN ? ELSE enabled END,
       group_id = CASE WHEN ? THEN ? ELSE group_id END
     WHERE name = ?`,
    [body.enabled !== undefined, body.enabled ? 1 : 0, group !== undefined, group ?? null, name]
  );
}
export async function recorderAcceptsWork(name: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ eligible: boolean }>(
    `SELECT (r.enabled = 1 AND COALESCE(g.enabled,1) = 1 AND r.update_status NOT IN ('queued', 'updating')) AS eligible FROM cs2_recorders r LEFT JOIN cs2_recorder_groups g ON g.id=r.group_id WHERE r.name = ?`,
    [name]
  );
  return row?.eligible === true;
}
/** Trusted column expressions only; recorder names remain bound parameters. */
export function recordingTargetFilter(match: string, recorder = '?') {
  return `(NOT EXISTS (SELECT 1 FROM cs2_recording_targets target WHERE target.match_slug = ${match}) OR EXISTS (SELECT 1 FROM cs2_recording_targets target JOIN cs2_recorders eligible ON eligible.group_id = target.group_id WHERE target.match_slug = ${match} AND eligible.name = ${recorder}))`;
}
export async function matchRecordingGroup(slug: string) {
  if (
    !(await db.queryOneAsync('SELECT slug FROM matches WHERE slug = ? AND game = ?', [slug, 'cs2']))
  )
    throw new FleetError(404, 'No such CS2 match');
  const row = await db.queryOneAsync<{ group_id: number }>(
    'SELECT group_id FROM cs2_recording_targets WHERE match_slug = ?',
    [slug]
  );
  return row ? Number(row.group_id) : null;
}
export async function setMatchRecordingGroup(slug: string, id: unknown) {
  await matchRecordingGroup(slug);
  const group = await requireGroup(id);
  if (group === null)
    await db.runAsync('DELETE FROM cs2_recording_targets WHERE match_slug = ?', [slug]);
  else
    await db.runAsync(
      `INSERT INTO cs2_recording_targets (match_slug,group_id) VALUES (?,?) ON CONFLICT (match_slug) DO UPDATE SET group_id=EXCLUDED.group_id`,
      [slug, group]
    );
}

/** Atomic queueing prevents repeat clicks from creating additional updates. */
export async function requestRecorderUpdate(name?: string): Promise<number> {
  await refreshRecorderRelease();
  if (name && !(await db.queryOneAsync('SELECT name FROM cs2_recorders WHERE name = ?', [name])))
    throw new FleetError(404, 'No such recorder');
  const rows = await db.queryAsync<{
    name: string;
    agent_version: string | null;
    latest_agent_version: string | null;
  }>(
    `SELECT name, agent_version, latest_agent_version FROM cs2_recorders ${name ? 'WHERE name = ?' : ''}`,
    name ? [name] : []
  );
  let changes = 0;
  for (const row of rows) {
    const native = newerRecorderAgent(row.latest_agent_version, row.agent_version);
    const result = await db.runAsync(
      `UPDATE cs2_recorders SET update_status = 'queued', update_target = COALESCE(latest_image,recorder_image), update_agent_version = CASE WHEN ? THEN latest_agent_version ELSE NULL END, update_agent_url = CASE WHEN ? THEN latest_agent_url ELSE NULL END, update_agent_sha = CASE WHEN ? THEN latest_agent_sha ELSE NULL END, update_error = NULL, update_id = ?, update_requested_at = EXTRACT(EPOCH FROM NOW())::INTEGER, update_seen = NULL
      WHERE name = ? AND agent_version IS NOT DISTINCT FROM ? AND update_status NOT IN ('queued','updating') AND update_protocol = 1 AND update_agent_seen > EXTRACT(EPOCH FROM NOW()) - 300 AND recorder_image IS NOT NULL
      AND ((latest_image IS NOT NULL AND latest_image <> recorder_image) OR ?)`,
      [native, native, native, randomUUID(), row.name, row.agent_version, native]
    );
    changes += result.changes;
  }
  return changes;
}
