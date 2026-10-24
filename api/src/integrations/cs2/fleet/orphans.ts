import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { ulid } from './credentials';
import { cs2ServerIdOf } from './link';
import { awaitCommandResult } from './reliable';
import { activeProposal } from './failover';
import { getAssignment, unassignEpoch } from './driver';

/**
 * A Ready Up server that reports a platform assignment (busy reason `assigned`, or
 * `awaiting_reset` for a finished series) naming a match the platform no longer runs
 * there is told to drop it: `match.unassign`, audited. The report comes with the hello
 * (`reason` / `detail` / `state`) and with every snapshot (`availability_reason` /
 * `availability_detail`).
 */
export type OrphanReason = 'cancelled' | 'ended' | 'superseded';

export interface OrphanReport {
  reason: string | null;
  detail: string | null;
  state: { match_id: string; epoch: number } | null;
}

const ANSWER_TIMEOUT_MS = 10_000;
const nowS = () => Math.floor(Date.now() / 1000);

/** Dropped assignments already sent: `${server}:${slug}:${epoch}`, cleared per server on hello. */
const dropped = new Set<string>();

/** The platform's own assignment of `slug` to this fleet server is still open (unlink and relink keep it). */
async function holdsOpenAssignment(slug: string, fleetServerId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ match_slug: string }>(
    'SELECT match_slug FROM cs2_fleet_assignments WHERE match_slug = ? AND server_id = ? AND ended_at IS NULL',
    [slug, fleetServerId]
  );
  return !!row;
}

/** Why the platform no longer runs `slug` on this fleet server; null when it still does. */
export async function orphanReason(
  slug: string,
  fleetServerId: string
): Promise<OrphanReason | null> {
  const match = await db.queryOneAsync<{ status: string; server_id: string | null }>(
    'SELECT status, server_id FROM matches WHERE slug = ?',
    [slug]
  );
  if (!match) return 'cancelled';
  if (match.status === 'completed') return 'ended';
  if (match.server_id && match.server_id !== (await cs2ServerIdOf(fleetServerId))) {
    if (await holdsOpenAssignment(slug, fleetServerId)) return null;
    return 'superseded';
  }
  return null;
}

export function forgetDroppedOrphans(fleetServerId: string): void {
  for (const key of dropped) if (key.startsWith(`${fleetServerId}:`)) dropped.delete(key);
}

/** A server reporting a platform assignment the platform no longer runs gets `match.unassign`. */
export async function dropOrphanAssignment(
  fleetServerId: string,
  report: OrphanReport
): Promise<boolean> {
  if (report.reason !== 'assigned' && report.reason !== 'awaiting_reset') return false;
  const slug = report.state?.match_id ?? report.detail;
  if (!slug) return false;
  const epoch = report.state?.epoch ?? (await getAssignment(slug))?.epoch;
  if (!epoch) return false;
  const key = `${fleetServerId}:${slug}:${epoch}`;
  if (dropped.has(key)) return false;
  if ((await activeProposal(slug))?.status === 'moving') return false;
  const reason = await orphanReason(slug, fleetServerId);
  if (!reason) return false;
  dropped.add(key);
  if (dropped.size > 10_000) dropped.clear();

  const command = `match.unassign ${slug} (${reason})`;
  const auditId = ulid();
  await db.runAsync(
    `INSERT INTO cs2_fleet_audit (id, actor, server_id, match_slug, command, status, created_at)
     VALUES (?, 'system', ?, ?, ?, 'pending', ?)`,
    [auditId, fleetServerId, slug, command, nowS()]
  );
  log.info(
    `[FLEET] ${fleetServerId} holds ${slug} epoch ${epoch}, which the platform no longer runs (${reason})`
  );
  const messageId = await unassignEpoch(fleetServerId, slug, epoch, reason);
  const answer = await awaitCommandResult(messageId, ANSWER_TIMEOUT_MS);
  await db.runAsync(
    `UPDATE cs2_fleet_audit SET message_id = ?, status = ?, error_code = ?, answered_at = ? WHERE id = ?`,
    [
      messageId,
      answer?.status ?? 'timeout',
      answer?.errorCode ?? null,
      answer ? nowS() : null,
      auditId,
    ]
  );
  return true;
}
