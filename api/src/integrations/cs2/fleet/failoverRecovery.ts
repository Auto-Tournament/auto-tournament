/**
 * Auto-failover through csm (FLEET.md §11, §18): the steps that act on the
 * machines themselves, used by ./failover.ts while auto-failover is on.
 *
 *   1. Restart first. When the dead server's machine has a csm host agent
 *      online, the platform asks csm to restart that server (forced, reason
 *      "auto-failover") and waits up to `FLEET_FAILOVER_RESTART_WAIT_S` (90 s)
 *      before moving the match. A server that comes back without the match
 *      resumes it in place (./failover.ts `onServerBack`), same address.
 *   2. Create when none is free. When no fleet server is free for a move, the
 *      platform asks an online machine with room to create one server
 *      (`server.create {count: 1, enroll: true}`). csm installs Ready Up
 *      (./hosts/service.ts `followUpCreate`), the server enrolls with that
 *      command's key, and it is linked into the pool here; the next scan
 *      moves the match to it.
 *
 * Guards: one restart per server per `FLEET_FAILOVER_RESTART_COOLDOWN_S`
 * (600 s), at most `FLEET_FAILOVER_CREATES_PER_HOUR` (2) creates per machine,
 * a machine needs `FLEET_FAILOVER_CREATE_MIN_FREE_MB` (2048) free RAM, and one
 * create per failover. Only the dead server is restarted; no other server is
 * touched. `FLEET_FAILOVER_CSM=0` turns both steps off. Every command is in
 * `cs2_fleet_host_commands` (issued_by, forced_by, force_reason) and gets a
 * `cs2_fleet_audit` line with the failover.
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { ulid } from './credentials';
import { linkFleetServer } from './link';
import { getHostCommand, listHosts } from './hosts/registry';
import { hostServers, sendHostCommand, HostCommandError } from './hosts/service';

const envNum = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export const RECOVERY_ACTOR = 'platform:auto-failover';

export function csmRecoveryEnabled(): boolean {
  return process.env.FLEET_FAILOVER_CSM !== '0';
}

const restartWaitS = () => envNum('FLEET_FAILOVER_RESTART_WAIT_S', 90);
const restartCooldownS = () => envNum('FLEET_FAILOVER_RESTART_COOLDOWN_S', 600);
const createsPerHour = () => envNum('FLEET_FAILOVER_CREATES_PER_HOUR', 2);
const createMinFreeMb = () => envNum('FLEET_FAILOVER_CREATE_MIN_FREE_MB', 2048);

const nowS = () => Math.floor(Date.now() / 1000);

/** The parts of a failover this module needs. */
export interface RecoveryFailover {
  id: string;
  matchSlug: string;
  reason: string;
  fromServerId: string | null;
}

/** Restart requested per failover: when, and for which csm server. */
const restarts = new Map<string, { at: number; hostId: string; server: string; commandId: string; failed?: boolean }>();
/** Create requested per failover. */
const creates = new Map<string, { at: number; hostId: string; commandId: string }>();

export function resetRecoveryState(): void {
  restarts.clear();
  creates.clear();
}

async function audit(serverId: string | null, matchSlug: string, command: string, messageId: string | null): Promise<void> {
  await db.runAsync(
    `INSERT INTO cs2_fleet_audit (id, actor, server_id, match_slug, command, status, message_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'sent', ?, ?)`,
    [ulid(), RECOVERY_ACTOR, serverId, matchSlug, command.slice(0, 500), messageId, nowS()]
  );
}

async function note(failoverId: string, detail: string): Promise<void> {
  await db.runAsync('UPDATE cs2_fleet_failovers SET detail = ?, updated_at = ? WHERE id = ?', [detail.slice(0, 500), nowS(), failoverId]);
}

/** The online machine and csm server name a fleet server runs as, if any. */
async function locate(fleetServerId: string): Promise<{ hostId: string; server: string } | null> {
  for (const host of await listHosts()) {
    if (!host.online || host.status !== 'enrolled') continue;
    const server = (await hostServers(host.id)).find((s) => s.fleetServer?.id === fleetServerId);
    if (server) return { hostId: host.id, server: server.name };
  }
  return null;
}

async function lastRestartAt(hostId: string, server: string): Promise<number | null> {
  const row = await db.queryOneAsync<{ created_at: number | string }>(
    `SELECT created_at FROM cs2_fleet_host_commands
      WHERE host_id = ? AND type = 'server.restart' AND server = ? AND issued_by = ?
      ORDER BY created_at DESC LIMIT 1`,
    [hostId, server, RECOVERY_ACTOR]
  );
  return row ? Number(row.created_at) : null;
}

/**
 * Before auto-failover moves a match: restart the dead server through csm
 * first. 'wait' holds the move (a restart is in flight); 'go' lets it happen.
 * csm answering the restart with failed / rejected (the server cannot start:
 * port taken, files gone, …) ends the wait at once: it is not coming back.
 */
export async function restartBeforeMove(f: RecoveryFailover, now = nowS()): Promise<'wait' | 'go'> {
  if (!csmRecoveryEnabled() || !f.fromServerId) return 'go';
  if (f.reason === 'restarted' || f.reason === 'manual') return 'go';

  const sent = restarts.get(f.id);
  if (sent) {
    if (now - sent.at >= restartWaitS()) return 'go';
    const answer = await getHostCommand(sent.commandId);
    if (answer && (answer.status === 'failed' || answer.status === 'rejected')) {
      if (!sent.failed) {
        sent.failed = true;
        const why = answer.errorMessage ?? answer.errorCode ?? answer.status;
        await note(f.id, `csm could not restart ${sent.server} (${why.slice(0, 300)}); moving the match.`);
        log.warn(`[FAILOVER] ${f.matchSlug}: csm restart of ${sent.server} ${answer.status} (${why}); moving instead`);
      }
      return 'go';
    }
    return 'wait';
  }

  const where = await locate(f.fromServerId);
  if (!where) return 'go';
  const last = await lastRestartAt(where.hostId, where.server);
  if (last !== null && now - last < restartCooldownS()) return 'go';

  try {
    const { command } = await sendHostCommand(
      where.hostId,
      'server.restart',
      { server: where.server, reason: 'auto-failover' },
      { issuedBy: RECOVERY_ACTOR, force: { reason: `auto-failover for ${f.matchSlug}` }, meta: { failover: f.id } }
    );
    restarts.set(f.id, { at: now, hostId: where.hostId, server: where.server, commandId: command.id });
    await audit(f.fromServerId, f.matchSlug, `csm server.restart ${where.server} (auto-failover ${f.id})`, command.id);
    await note(f.id, `Restarting ${where.server} through csm; the match moves if it is not back in ${restartWaitS()} s.`);
    log.warn(`[FAILOVER] ${f.matchSlug}: asked csm (${where.hostId}) to restart ${where.server} before moving the match`);
    return 'wait';
  } catch (error) {
    const reason = error instanceof HostCommandError ? `${error.code}: ${error.message}` : (error as Error).message;
    log.warn(`[FAILOVER] ${f.matchSlug}: csm restart of ${where.server} not sent (${reason}); moving instead`);
    return 'go';
  }
}

/** Machines with room for one more server, most free RAM first. */
async function hostsWithRoom(now: number): Promise<string[]> {
  const candidates: Array<{ id: string; free: number }> = [];
  for (const host of await listHosts()) {
    if (!host.online || host.status !== 'enrolled' || !host.inventory) continue;
    const free = host.inventory.resources.ram_free_mb;
    if (free < createMinFreeMb()) continue;
    const recent = await db.queryOneAsync<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM cs2_fleet_host_commands
        WHERE host_id = ? AND type = 'server.create' AND issued_by = ? AND created_at > ?`,
      [host.id, RECOVERY_ACTOR, now - 3600]
    );
    if (Number(recent?.n ?? 0) >= createsPerHour()) continue;
    candidates.push({ id: host.id, free });
  }
  return candidates.sort((a, b) => b.free - a.free).map((c) => c.id);
}

/** No free server for a move: ask a machine with room to create one (once per failover). */
export async function createWhenNoneFree(f: RecoveryFailover, now = nowS()): Promise<boolean> {
  if (!csmRecoveryEnabled() || creates.has(f.id)) return false;
  for (const hostId of await hostsWithRoom(now)) {
    try {
      const { command } = await sendHostCommand(
        hostId,
        'server.create',
        { count: 1, enroll: true },
        { issuedBy: RECOVERY_ACTOR, meta: { failover: f.id } }
      );
      creates.set(f.id, { at: now, hostId, commandId: command.id });
      await audit(f.fromServerId, f.matchSlug, `csm server.create on ${hostId} (auto-failover ${f.id})`, command.id);
      await note(f.id, 'No server was free; creating one through csm. The match moves there once it is online.');
      log.warn(`[FAILOVER] ${f.matchSlug}: no free server; asked csm (${hostId}) to create one`);
      return true;
    } catch (error) {
      log.warn(`[FAILOVER] ${f.matchSlug}: csm server.create on ${hostId} not sent: ${(error as Error).message}`);
    }
  }
  return false;
}

/**
 * Link servers created for failovers into the match pool once they enroll
 * (their enrollment key carries the create command's id).
 */
export async function linkCreatedServers(): Promise<string[]> {
  if (!csmRecoveryEnabled()) return [];
  const rows = await db.queryAsync<{ id: string }>(
    `SELECT s.id FROM cs2_fleet_servers s
       JOIN cs2_fleet_enrollment_keys k ON k.id = s.enrollment_key_id
       JOIN cs2_fleet_host_commands c ON c.message_id = k.command_id
      WHERE s.status = 'enrolled' AND c.type = 'server.create' AND c.issued_by = ?
        AND NOT EXISTS (SELECT 1 FROM cs2_servers v WHERE v.fleet_server_id = s.id)`,
    [RECOVERY_ACTOR]
  );
  const linked: string[] = [];
  for (const row of rows) {
    const outcome = await linkFleetServer(row.id);
    if (outcome.ok) {
      linked.push(row.id);
      log.info(`[FAILOVER] linked ${row.id} (created by csm for a failover) into the match pool`);
    } else {
      log.warn(`[FAILOVER] could not link ${row.id}: ${outcome.error}`);
    }
  }
  return linked;
}
