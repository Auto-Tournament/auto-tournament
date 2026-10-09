/**
 * Fleet failover (FLEET.md §11): a Ready Up server that dies or hangs during a
 * match is noticed, and the platform gets the match going again from the last
 * round backup, on its own by default. An admin can turn auto-failover off
 * (then each recovery waits for "Move match" on the match page, FLEET.md D7).
 *
 * Recovery order, fastest for the players first:
 *   a. The server comes back within the grace period: nothing to do (it
 *      still has the match), or it resumes the match in place when it lost
 *      it (a `restarted` failover: `match.assign` + `resume` to the same
 *      server, same connect address).
 *   b. Past the grace period, with auto-failover on and the machine's csm
 *      online: csm restarts the server first and the move waits up to 90 s
 *      for it to come back, which then takes (a) (./failoverRecovery.ts).
 *   c. Move to a free fleet server (the failover reserve included). None
 *      free: csm creates one on a machine with room, it joins the pool once
 *      it enrolls, and the next pass moves the match there. Meanwhile the
 *      failover stays open (the match page shows it) and every pass tries
 *      again; the server coming back takes (a).
 *
 * - Detection (`scanForFailovers`, every `FLEET_FAILOVER_CHECK_MS`, 10 s, and
 *   after link and host events): for each match with an acked, open fleet
 *   assignment that is `loaded` / `live`, the server counts as down when csm
 *   reports its process `exited` / `crashed` or `hung` (`host.health`), or its
 *   link has been down for 90 s (live, paused, halftime, overtime) / 30 s
 *   (before live). `failoverPlan.ts` holds the rules.
 * - The record (`cs2_fleet_failovers`, migration `013-fleet-failover`): the
 *   server and epoch that went down, the target, the backup (map, round,
 *   score), who decided; `cs2_fleet_audit` gets a line per move.
 * - A move (`acceptFailover`): the old epoch is fenced (`match.unassign
 *   {superseded}` to its outbox, so a dead server gets it when it returns;
 *   its hello at that epoch then needs nothing more), the match points at the
 *   new server, and `match.assign` goes out with a new epoch, a new password
 *   and `resume` (the backup inline, or `backup_ref` when it is too large for
 *   one frame). Players see the new connect string through the match update
 *   channels; the old server, when it is alive, kicks them with "Match moved".
 *   A refused or unanswered assign puts the failover back to `open` with the
 *   error and the match back on the old server row; auto-failover then tries
 *   another server.
 * - Manual move (`moveMatch`): an admin moves a fleet match to another free
 *   server (a different pick after a failover, or back to the old one).
 *
 * Licensing never enters this path: recovery is never blocked or delayed by
 * it (reserve servers are counted like any other server).
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { emitBracketUpdate, emitMatchUpdate, getIO } from '../../../services/socketService';
import type { DbMatchRow } from '../../../types/database.types';
import { ulid } from './credentials';
import { roundBackupStore, type RoundBackupMeta } from './backups';
import { inlineBackupFor } from './restore';
import { assignMatch, fenceEpoch, getAssignment } from './driver';
import { fleetBus, onFleetServerReady } from './service';
import { liveStateStore } from './state';
import { cs2ServerIdOf } from './link';
import { hostEvents, hostServers } from './hosts/service';
import { getFailoverSettings } from './failoverSettings';
import { createWhenNoneFree, linkCreatedServers, restartBeforeMove } from './failoverRecovery';
import {
  buildResume,
  detectFailure,
  failoverGraceFromEnv,
  pickBackup,
  pickTarget,
  type FailoverCandidate,
  type FailoverGrace,
  type FailoverReason,
  type HostHealthSignal,
} from './failoverPlan';
import type { HostHealthPayload } from './protocol/host/v1';
import type { HelloPayload, MapStats, MatchPhase, MatchState, Score } from './protocol/v1';

const CHECK_MS = Number(process.env.FLEET_FAILOVER_CHECK_MS) || 10_000;

/** Who auto-failover acts as in the records. */
export const FAILOVER_PLATFORM_ACTOR = 'platform:auto-failover';

export type FailoverStatus = 'open' | 'moving' | 'moved' | 'dismissed' | 'withdrawn';

export interface FailoverProposal {
  id: string;
  matchSlug: string;
  status: FailoverStatus;
  reason: FailoverReason;
  detail: string | null;
  phase: MatchPhase | null;
  /** The fleet server that went down, and its linked cs2_servers row. */
  fromServerId: string | null;
  fromCs2ServerId: string | null;
  fromEpoch: number;
  /** Unix s. */
  downSince: number | null;
  /** The server the match goes to (cs2_servers row); null while none is free. */
  targetCs2ServerId: string | null;
  /** Fleet map number (1-based). */
  mapNumber: number;
  /** Backup round; 0 = the map restarts from warmup. */
  round: number;
  backupId: number | null;
  backupSha256: string | null;
  score: Score | null;
  auto: boolean;
  newEpoch: number | null;
  newCs2ServerId: string | null;
  commandId: string | null;
  inline: boolean;
  decidedBy: string | null;
  decidedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ProposalRow {
  id: string;
  match_slug: string;
  status: FailoverStatus;
  reason: FailoverReason;
  detail: string | null;
  phase: string | null;
  from_server_id: string | null;
  from_cs2_server_id: string | null;
  from_epoch: number;
  down_since: number | null;
  target_cs2_server_id: string | null;
  map_number: number;
  round: number;
  backup_id: number | string | null;
  backup_sha256: string | null;
  score: string | null;
  state: string | null;
  auto: number;
  new_epoch: number | null;
  new_cs2_server_id: string | null;
  command_id: string | null;
  inline: number;
  decided_by: string | null;
  decided_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

const nowS = () => Math.floor(Date.now() / 1000);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function fromRow(row: ProposalRow): FailoverProposal {
  return {
    id: row.id,
    matchSlug: row.match_slug,
    status: row.status,
    reason: row.reason,
    detail: row.detail,
    phase: (row.phase as MatchPhase | null) ?? null,
    fromServerId: row.from_server_id,
    fromCs2ServerId: row.from_cs2_server_id,
    fromEpoch: Number(row.from_epoch),
    downSince: num(row.down_since),
    targetCs2ServerId: row.target_cs2_server_id,
    mapNumber: Number(row.map_number),
    round: Number(row.round),
    backupId: num(row.backup_id),
    backupSha256: row.backup_sha256,
    score: parseJson<Score>(row.score),
    auto: Number(row.auto) === 1,
    newEpoch: num(row.new_epoch),
    newCs2ServerId: row.new_cs2_server_id,
    commandId: row.command_id,
    inline: Number(row.inline) === 1,
    decidedBy: row.decided_by,
    decidedAt: num(row.decided_at),
    lastError: row.last_error,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function getProposal(id: string): Promise<FailoverProposal | null> {
  const row = await db.queryOneAsync<ProposalRow>(
    'SELECT * FROM cs2_fleet_failovers WHERE id = ?',
    [id]
  );
  return row ? fromRow(row) : null;
}

/** The match's open (or moving) failover. */
export async function activeProposal(matchSlug: string): Promise<FailoverProposal | null> {
  const row = await db.queryOneAsync<ProposalRow>(
    `SELECT * FROM cs2_fleet_failovers WHERE match_slug = ? AND status IN ('open', 'moving') ORDER BY created_at DESC LIMIT 1`,
    [matchSlug]
  );
  return row ? fromRow(row) : null;
}

export async function listProposals(matchSlug: string, limit = 10): Promise<FailoverProposal[]> {
  const rows = await db.queryAsync<ProposalRow>(
    'SELECT * FROM cs2_fleet_failovers WHERE match_slug = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    [matchSlug, limit]
  );
  return rows.map(fromRow);
}

/** The match's last completed move, when it was recent (the players' "the match moved" note). */
export async function recentMove(
  matchSlug: string,
  withinSeconds = 1800
): Promise<FailoverProposal | null> {
  const row = await db.queryOneAsync<ProposalRow>(
    `SELECT * FROM cs2_fleet_failovers WHERE match_slug = ? AND status = 'moved' AND updated_at >= ?
      ORDER BY updated_at DESC LIMIT 1`,
    [matchSlug, nowS() - withinSeconds]
  );
  return row ? fromRow(row) : null;
}

async function savedState(
  id: string
): Promise<{ state: MatchState | null; mapStats: MapStats | null }> {
  const row = await db.queryOneAsync<{ state: string | null }>(
    'SELECT state FROM cs2_fleet_failovers WHERE id = ?',
    [id]
  );
  const parsed = parseJson<{ state?: MatchState | null; mapStats?: MapStats | null }>(
    row?.state ?? null
  );
  return { state: parsed?.state ?? null, mapStats: parsed?.mapStats ?? null };
}

async function setStatus(
  id: string,
  status: FailoverStatus,
  patch: { detail?: string; lastError?: string | null } = {}
): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_fleet_failovers SET status = ?, detail = COALESCE(?, detail), last_error = COALESCE(?, last_error), updated_at = ? WHERE id = ?`,
    [status, patch.detail ?? null, patch.lastError ?? null, nowS(), id]
  );
}

function announce(matchSlug: string, proposal: FailoverProposal | null): void {
  try {
    // A broadcast: slug and state only, never a server address or password.
    getIO().emit('fleet:failover', {
      matchSlug,
      proposalId: proposal?.id ?? null,
      status: proposal?.status ?? null,
    });
  } catch {
    // No socket server (tests, startup): the admin page polls too.
  }
}

// ---------------------------------------------------------------------------
// Servers to move to
// ---------------------------------------------------------------------------

function parseCaps(text: string | null): string[] {
  const caps = parseJson<unknown>(text);
  return Array.isArray(caps) ? caps.filter((c): c is string => typeof c === 'string') : [];
}

function parseBuild(text: string | null): number | null {
  const versions = parseJson<{ cs2_build?: unknown }>(text);
  return typeof versions?.cs2_build === 'number' ? versions.cs2_build : null;
}

/** The fleet servers that could take a match right now, the failover reserve included. */
export async function freeFleetServers(): Promise<FailoverCandidate[]> {
  const { cs2ServerPool } = await import('../allocation');
  const free = (await cs2ServerPool.getAvailableServers({ includeFleetReserve: true })).filter(
    (s) => s.transport === 'fleet'
  );
  if (free.length === 0) return [];
  const rows = await db.queryAsync<{
    id: string;
    name: string;
    fleet_id: string;
    versions: string | null;
    capabilities: string | null;
  }>(
    `SELECT s.id, s.name, f.id AS fleet_id, f.versions, f.capabilities
       FROM cs2_servers s JOIN cs2_fleet_servers f ON f.id = s.fleet_server_id
      WHERE s.id IN (${free.map(() => '?').join(', ')})`,
    free.map((s) => s.id)
  );
  return rows
    .filter((r) => fleetBus().isConnected(r.fleet_id))
    .map((r) => ({
      cs2ServerId: r.id,
      fleetServerId: r.fleet_id,
      name: r.name,
      cs2Build: parseBuild(r.versions),
      capabilities: parseCaps(r.capabilities),
    }));
}

async function serverTraits(
  fleetServerId: string | null
): Promise<{ cs2Build: number | null; capabilities: string[] }> {
  if (!fleetServerId) return { cs2Build: null, capabilities: [] };
  const row = await db.queryOneAsync<{ versions: string | null; capabilities: string | null }>(
    'SELECT versions, capabilities FROM cs2_fleet_servers WHERE id = ?',
    [fleetServerId]
  );
  return {
    cs2Build: parseBuild(row?.versions ?? null),
    capabilities: parseCaps(row?.capabilities ?? null),
  };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** csm's last `host.health` per fleet server (process gone / hung), cleared by `recovered` / `restarted`. */
const healthByServer = new Map<string, HostHealthSignal>();
/** When this process first saw a server of an open assignment offline. */
const offlineSeen = new Map<string, number>();
/** Links are all down while the platform starts: their clock starts no earlier than this. */
let startedAt = nowS();

interface OpenAssignmentRow {
  match_slug: string;
  epoch: number;
  server_id: string;
  cs2_server_id: string | null;
  last_seen: number | null;
}

export interface ScanResult {
  proposed: FailoverProposal[];
  withdrawn: string[];
}

export interface ScanOptions {
  grace?: FailoverGrace;
  now?: number;
}

let scanning: Promise<ScanResult> | null = null;

/** One detection pass (serialized: a pass already running is joined). */
export function scanForFailovers(options: ScanOptions = {}): Promise<ScanResult> {
  if (scanning) return scanning;
  scanning = runScan(options).finally(() => {
    scanning = null;
  });
  return scanning;
}

async function withdraw(result: ScanResult, p: FailoverProposal, detail: string): Promise<void> {
  await setStatus(p.id, 'withdrawn', { detail });
  log.info(`[FAILOVER] ${p.matchSlug}: failover ${p.id} withdrawn (${detail})`);
  result.withdrawn.push(p.id);
  announce(p.matchSlug, { ...p, status: 'withdrawn' });
}

async function runScan(options: ScanOptions): Promise<ScanResult> {
  const now = options.now ?? nowS();
  const grace = options.grace ?? failoverGraceFromEnv();
  const result: ScanResult = { proposed: [], withdrawn: [] };

  const rows = await db.queryAsync<OpenAssignmentRow>(
    `SELECT a.match_slug, a.epoch, a.server_id, a.cs2_server_id, f.last_seen
       FROM cs2_fleet_assignments a
       JOIN matches m ON m.slug = a.match_slug
       LEFT JOIN cs2_fleet_servers f ON f.id = a.server_id
      WHERE a.ended_at IS NULL AND a.config IS NOT NULL AND a.server_id IS NOT NULL
        AND m.status IN ('loaded', 'live')`
  );
  const covered = new Set<string>();

  for (const row of rows) {
    const slug = row.match_slug;
    const epoch = Number(row.epoch);
    covered.add(slug);
    const online = fleetBus().isConnected(row.server_id);
    let offlineSince: number | null = null;
    if (online) {
      offlineSeen.delete(row.server_id);
    } else {
      if (!offlineSeen.has(row.server_id)) offlineSeen.set(row.server_id, now);
      const lastSeen = num(row.last_seen);
      offlineSince = Math.max(lastSeen ?? (offlineSeen.get(row.server_id) as number), startedAt);
    }
    const record = await liveStateStore.getLiveState(slug);
    const current = record && record.epoch === epoch ? record : null;
    const phase = current?.state?.phase ?? null;
    const failure = detectFailure({
      online,
      offlineSince,
      now,
      phase,
      health: healthByServer.get(row.server_id) ?? null,
      grace,
    });

    const open = await activeProposal(slug);
    if (open) {
      if (open.status !== 'open') continue;
      if (open.fromEpoch !== epoch) {
        await withdraw(result, open, 'The match was assigned to a server again.');
        continue;
      }
      // Waiting for the admin on a server that is up (resume in place, a move).
      if (open.reason === 'restarted' || open.reason === 'manual') continue;
      if (!failure) await withdraw(result, open, 'The server came back.');
      continue;
    }
    if (!failure) continue;

    const dismissed = await db.queryOneAsync<{ id: string }>(
      `SELECT id FROM cs2_fleet_failovers WHERE match_slug = ? AND from_epoch = ? AND status = 'dismissed' LIMIT 1`,
      [slug, epoch]
    );
    if (dismissed) continue;

    const proposal = await createProposal({
      slug,
      epoch,
      fleetServerId: row.server_id,
      cs2ServerId: row.cs2_server_id,
      phase,
      failure,
      state: current?.state ?? record?.state ?? null,
      mapStats: current?.mapStats ?? null,
    });
    if (proposal) result.proposed.push(proposal);
  }

  // Open failovers whose match is no longer on an open assignment: kept while
  // the match is still running (a move that failed), else withdrawn.
  const stale = await db.queryAsync<ProposalRow>(
    `SELECT * FROM cs2_fleet_failovers WHERE status = 'open'`
  );
  for (const row of stale) {
    if (covered.has(row.match_slug)) continue;
    const p = fromRow(row);
    const match = await db.queryOneAsync<{ status: string }>(
      'SELECT status FROM matches WHERE slug = ?',
      [p.matchSlug]
    );
    const assignment = await getAssignment(p.matchSlug);
    const reassigned =
      assignment !== null && assignment.endedAt === null && assignment.epoch > p.fromEpoch;
    if (!match || (match.status !== 'loaded' && match.status !== 'live') || reassigned) {
      await withdraw(
        result,
        p,
        reassigned ? 'The match was assigned to a server again.' : 'The match is no longer running.'
      );
    }
  }

  // Auto-failover moves every open failover that has somewhere to go (the
  // ones just made, and the ones still waiting for a free server). Off: keep
  // the proposed server current for the admin.
  const { auto, csm } = await getFailoverSettings();
  const viaCsm = auto && csm;
  // Servers csm created for a failover join the pool once they enroll.
  if (viaCsm) await linkCreatedServers();
  const waiting = await db.queryAsync<ProposalRow>(
    `SELECT * FROM cs2_fleet_failovers WHERE status = 'open' AND reason <> 'manual' ORDER BY created_at`
  );
  let free: FailoverCandidate[] | null = null;
  for (const row of waiting) {
    const p = fromRow(row);
    if (auto) {
      // Restart the dead server through csm first (./failoverRecovery.ts).
      if (viaCsm && (await restartBeforeMove(p, now)) === 'wait') continue;
      const outcome = await autoAccept(p);
      if (viaCsm && !outcome.ok && outcome.code === 'no_target') await createWhenNoneFree(p, now);
      free = null;
      continue;
    }
    if (p.reason === 'restarted') continue;
    free ??= await freeFleetServers();
    if (!p.targetCs2ServerId || !free.some((c) => c.cs2ServerId === p.targetCs2ServerId)) {
      const target = pickTarget(free, {
        cs2ServerId: p.fromCs2ServerId,
        fleetServerId: p.fromServerId,
        ...(await serverTraits(p.fromServerId)),
      });
      if ((target?.cs2ServerId ?? null) !== p.targetCs2ServerId) {
        await db.runAsync(
          'UPDATE cs2_fleet_failovers SET target_cs2_server_id = ?, updated_at = ? WHERE id = ?',
          [target?.cs2ServerId ?? null, nowS(), p.id]
        );
        announce(p.matchSlug, p);
      }
    }
  }
  return result;
}

/** Servers a failover's auto move already failed on (refused, no answer): not tried again for it. */
const failedTargets = new Map<string, Set<string>>();

async function autoAccept(proposal: FailoverProposal): Promise<AcceptOutcome> {
  const exclude = [...(failedTargets.get(proposal.id) ?? [])];
  const outcome = await acceptFailover(proposal.id, {
    actor: FAILOVER_PLATFORM_ACTOR,
    auto: true,
    exclude,
  });
  if (outcome.ok) {
    failedTargets.delete(proposal.id);
  } else if (outcome.code === 'assign_failed' && outcome.target) {
    const set = failedTargets.get(proposal.id) ?? new Set<string>();
    set.add(outcome.target);
    failedTargets.set(proposal.id, set);
    if (failedTargets.size > 1000) failedTargets.clear();
    log.warn(
      `[FAILOVER] ${proposal.matchSlug}: auto-failover to ${outcome.target} failed: ${outcome.error}`
    );
  } else if (outcome.code !== 'no_target') {
    log.warn(`[FAILOVER] ${proposal.matchSlug}: auto-failover not done: ${outcome.error}`);
  }
  return outcome;
}

async function createProposal(input: {
  slug: string;
  epoch: number;
  fleetServerId: string;
  cs2ServerId: string | null;
  phase: MatchPhase | null;
  failure: { reason: FailoverReason; since: number; detail: string };
  state: MatchState | null;
  mapStats: MapStats | null;
  /** The target when the caller decided it (in place, an admin's pick); else picked from the free servers. */
  targetCs2ServerId?: string | null;
}): Promise<FailoverProposal | null> {
  const mapNumber = input.state?.series?.current_map ?? 1;
  const backup = pickBackup(await roundBackupStore.list(input.slug), mapNumber);
  const target =
    input.targetCs2ServerId !== undefined
      ? input.targetCs2ServerId
      : (pickTarget(await freeFleetServers(), {
          cs2ServerId: input.cs2ServerId,
          fleetServerId: input.fleetServerId,
          ...(await serverTraits(input.fleetServerId)),
        })?.cs2ServerId ?? null);
  const id = ulid();
  const now = nowS();
  const inserted = await db.runAsync(
    `INSERT INTO cs2_fleet_failovers
       (id, match_slug, status, reason, detail, phase, from_server_id, from_cs2_server_id, from_epoch, down_since,
        target_cs2_server_id, map_number, round, backup_id, backup_sha256, score, state, created_at, updated_at)
     VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [
      id,
      input.slug,
      input.failure.reason,
      input.failure.detail.slice(0, 500),
      input.phase,
      input.fleetServerId,
      input.cs2ServerId,
      input.epoch,
      input.failure.since,
      target,
      mapNumber,
      backup?.round ?? 0,
      backup?.id ?? null,
      backup?.sha256 ?? null,
      backup ? JSON.stringify(backup.score) : null,
      JSON.stringify({ state: input.state, mapStats: input.mapStats }),
      now,
      now,
    ]
  );
  if (inserted.changes === 0) return null;
  const proposal = await getProposal(id);
  log.warn(
    `[FAILOVER] ${input.slug}: ${input.fleetServerId} (epoch ${input.epoch}): ${input.failure.reason} (${input.failure.detail}); ` +
      `failover ${id}: ${target ? `to ${target}` : 'no server free yet'}, ` +
      `${backup ? `resume map ${mapNumber} round ${backup.round}` : `restart map ${mapNumber} from warmup`}`
  );
  announce(input.slug, proposal);
  return proposal;
}

// ---------------------------------------------------------------------------
// Move / dismiss
// ---------------------------------------------------------------------------

export interface AcceptRequest {
  /** cs2_servers id of the server to move to; default: the proposed one. */
  targetServerId?: string | null;
  /** The backup round; default: the proposed one (0 = restart the map from warmup). */
  round?: number | null;
  actor: string | null;
  auto?: boolean;
  /** Servers not to pick (auto-failover: the ones that already refused). */
  exclude?: string[];
}

export type AcceptOutcome =
  | { ok: true; proposal: FailoverProposal }
  | {
      ok: false;
      status: number;
      code: string;
      error: string;
      proposal: FailoverProposal | null;
      target?: string;
    };

function refuse(
  status: number,
  code: string,
  error: string,
  proposal: FailoverProposal | null,
  target?: string
): AcceptOutcome {
  return { ok: false, status, code, error, proposal, ...(target ? { target } : {}) };
}

async function writeAudit(input: {
  actor: string | null;
  serverId: string | null;
  matchSlug: string;
  command: string;
}): Promise<string> {
  const id = ulid();
  await db.runAsync(
    `INSERT INTO cs2_fleet_audit (id, actor, server_id, match_slug, command, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [id, input.actor, input.serverId, input.matchSlug, input.command.slice(0, 500), nowS()]
  );
  return id;
}

async function settleAudit(
  id: string,
  status: string,
  messageId: string | null,
  output: string | null
): Promise<void> {
  await db.runAsync(
    'UPDATE cs2_fleet_audit SET status = ?, message_id = ?, output = ?, answered_at = ? WHERE id = ?',
    [status, messageId, output, nowS(), id]
  );
}

/**
 * Carry out a failover (FLEET.md §11.3-§11.5): fence the old epoch, point the
 * match at the target, `match.assign` with a new epoch and `resume`. A
 * `restarted` one resumes on the server that came back; the others go to a
 * free server.
 */
export async function acceptFailover(id: string, req: AcceptRequest): Promise<AcceptOutcome> {
  const proposal = await getProposal(id);
  if (!proposal) return refuse(404, 'not_found', 'No such failover', null);
  if (proposal.status !== 'open')
    return refuse(409, 'not_open', `The failover is ${proposal.status}`, proposal);
  const slug = proposal.matchSlug;
  const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
  // (DbMatchRow's status type predates 'loaded'.)
  const matchStatus = match ? String(match.status) : null;
  if (!match || (matchStatus !== 'loaded' && matchStatus !== 'live')) {
    await setStatus(id, 'withdrawn', { detail: 'The match is no longer running.' });
    return refuse(409, 'not_running', 'The match is no longer running', await getProposal(id));
  }
  const assignment = await getAssignment(slug);
  if (assignment && assignment.endedAt === null && assignment.epoch !== proposal.fromEpoch) {
    await setStatus(id, 'withdrawn', { detail: 'The match was assigned to a server again.' });
    return refuse(
      409,
      'stale',
      'The match has been assigned to a server again since',
      await getProposal(id)
    );
  }

  const inPlace = proposal.reason === 'restarted';
  let target: FailoverCandidate | null;
  if (inPlace) {
    // The server came back without the match: it takes it again.
    const connected = !!proposal.fromServerId && fleetBus().isConnected(proposal.fromServerId);
    target =
      connected &&
      proposal.fromCs2ServerId &&
      (!req.targetServerId || req.targetServerId === proposal.fromCs2ServerId)
        ? {
            cs2ServerId: proposal.fromCs2ServerId,
            fleetServerId: proposal.fromServerId as string,
            name: proposal.fromCs2ServerId,
            ...(await serverTraits(proposal.fromServerId)),
          }
        : null;
    if (!target) return refuse(409, 'target_unavailable', 'The server is not connected', proposal);
  } else {
    target = pickTarget(
      await freeFleetServers(),
      {
        cs2ServerId: proposal.fromCs2ServerId,
        fleetServerId: proposal.fromServerId,
        ...(await serverTraits(proposal.fromServerId)),
      },
      req.targetServerId ?? proposal.targetCs2ServerId,
      req.exclude ?? []
    );
    if (req.targetServerId && target?.cs2ServerId !== req.targetServerId) {
      return refuse(409, 'target_unavailable', 'That server is not free for a match now', proposal);
    }
    if (!target)
      return refuse(409, 'no_target', 'No Ready Up server is free to take the match', proposal);
  }

  const round = req.round === undefined || req.round === null ? proposal.round : Number(req.round);
  if (!Number.isInteger(round) || round < 0 || round > 999)
    return refuse(400, 'bad_args', 'round must be 0-999', proposal);
  let backupMeta: RoundBackupMeta | null = null;
  if (round >= 1) {
    backupMeta =
      (await roundBackupStore.list(slug)).find(
        (b) => b.mapNumber === proposal.mapNumber && b.round === round
      ) ?? null;
    if (!backupMeta)
      return refuse(
        404,
        'no_backup',
        `No stored backup for map ${proposal.mapNumber} round ${round}`,
        proposal
      );
  }
  const inline = round >= 1 ? await inlineBackupFor(slug, proposal.mapNumber, round) : null;

  // Claim it: one move wins.
  const claimed = await db.runAsync(
    `UPDATE cs2_fleet_failovers
        SET status = 'moving', target_cs2_server_id = ?, round = ?, backup_id = ?, backup_sha256 = ?, score = ?,
            inline = ?, auto = ?, decided_by = ?, decided_at = ?, updated_at = ?
      WHERE id = ? AND status = 'open'`,
    [
      target.cs2ServerId,
      round,
      backupMeta?.id ?? null,
      backupMeta?.sha256 ?? null,
      backupMeta ? JSON.stringify(backupMeta.score) : null,
      inline ? 1 : 0,
      req.auto ? 1 : 0,
      req.actor,
      nowS(),
      nowS(),
      id,
    ]
  );
  if (claimed.changes === 0)
    return refuse(409, 'not_open', 'The failover was decided meanwhile', await getProposal(id));
  announce(slug, await getProposal(id));

  const { state, mapStats } = await savedState(id);
  const resume = buildResume({
    fromEpoch: proposal.fromEpoch,
    mapNumber: proposal.mapNumber,
    round,
    backup: inline,
    backupRef: !inline && backupMeta ? { file: backupMeta.file, sha256: backupMeta.sha256 } : null,
    state,
    mapStats,
  });
  const how = round >= 1 ? `round ${round} (${inline ? 'backup inline' : 'backup_ref'})` : 'warmup';
  const auditId = await writeAudit({
    actor: req.actor,
    serverId: target.fleetServerId,
    matchSlug: slug,
    command:
      `failover ${slug} (${proposal.reason}): ${proposal.fromServerId ?? '?'} epoch ${proposal.fromEpoch} -> ` +
      `${target.fleetServerId}, map ${proposal.mapNumber} ${how}${req.auto ? ' (auto)' : ''}`,
  });

  // Fence the old epoch (§11.4) before the new one exists. In place, the
  // server holds nothing: the new assignment replaces the old one.
  if (!inPlace && assignment && assignment.endedAt === null && assignment.serverId) {
    const alive = fleetBus().isConnected(assignment.serverId);
    await fenceEpoch(
      assignment.serverId,
      slug,
      assignment.epoch,
      proposal.reason === 'manual' && alive ? 'moved' : 'superseded'
    ).catch((error) =>
      log.warn(
        `[FAILOVER] ${slug}: fencing epoch ${assignment.epoch} failed: ${(error as Error).message}`
      )
    );
  }

  const { serverAllocationTracker } = await import('../services/serverAllocationTracker');
  const previousServer = match.server_id ?? proposal.fromCs2ServerId;
  if (previousServer && previousServer !== target.cs2ServerId)
    serverAllocationTracker.markIdle(previousServer);
  serverAllocationTracker.markAllocated(target.cs2ServerId, slug);
  await db.updateAsync('matches', { server_id: target.cs2ServerId }, 'slug = ?', [slug]);

  const load = await assignMatch(slug, target.cs2ServerId, { resume });
  if (!load.success) {
    const error = load.error ?? 'The server did not take the match';
    if (previousServer !== target.cs2ServerId) serverAllocationTracker.markIdle(target.cs2ServerId);
    await db.updateAsync('matches', { server_id: previousServer ?? null }, 'slug = ?', [slug]);
    await db.runAsync(
      `UPDATE cs2_fleet_failovers SET status = 'open', last_error = ?, decided_by = NULL, decided_at = NULL, updated_at = ? WHERE id = ?`,
      [error.slice(0, 500), nowS(), id]
    );
    await settleAudit(auditId, 'failed', load.commandId ?? null, error.slice(0, 500));
    log.warn(`[FAILOVER] ${slug}: moving to ${target.cs2ServerId} failed: ${error}`);
    const back = await getProposal(id);
    announce(slug, back);
    return refuse(502, 'assign_failed', error, back, target.cs2ServerId);
  }

  await db.runAsync(
    `UPDATE cs2_fleet_failovers SET status = 'moved', new_epoch = ?, new_cs2_server_id = ?, command_id = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
    [load.epoch ?? null, target.cs2ServerId, load.commandId ?? null, nowS(), id]
  );
  await settleAudit(auditId, 'ok', load.commandId ?? null, `epoch ${load.epoch}`);
  log.warn(
    `[FAILOVER] ${slug} ${inPlace ? 'resumed on' : 'moved to'} ${target.fleetServerId} (epoch ${load.epoch}) from ${proposal.fromServerId} (epoch ${proposal.fromEpoch}), map ${proposal.mapNumber} ${how}, by ${req.actor ?? 'unknown'}`
  );

  // Players: the match page (and anything on the match update channels) shows
  // the new server and password; the connect route reads both.
  const updated = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
    slug,
  ]);
  if (updated) {
    emitMatchUpdate(updated);
    emitBracketUpdate({ action: 'server_assigned', matchSlug: slug, serverId: target.cs2ServerId });
  }
  const done = (await getProposal(id)) as FailoverProposal;
  announce(slug, done);
  return { ok: true, proposal: done };
}

/**
 * An admin moves a fleet match to another free server (FLEET.md §11.3, "the
 * same flow, minus detection"): a different pick after a failover, or back to
 * the old server. An open failover of the match is carried out with this
 * target; else a `manual` one is made for the match's current assignment.
 */
export async function moveMatch(
  matchSlug: string,
  req: { targetServerId?: string | null; round?: number | null; actor: string | null }
): Promise<AcceptOutcome> {
  const open = await activeProposal(matchSlug);
  if (open?.status === 'moving') return refuse(409, 'not_open', 'The match is being moved', open);
  if (open && open.reason !== 'restarted') return acceptFailover(open.id, req);
  if (open) await setStatus(open.id, 'withdrawn', { detail: 'An admin moved the match.' });

  const assignment = await getAssignment(matchSlug);
  const match = await db.queryOneAsync<{ status: string }>(
    'SELECT status FROM matches WHERE slug = ?',
    [matchSlug]
  );
  if (
    !match ||
    (match.status !== 'loaded' && match.status !== 'live') ||
    !assignment?.serverId ||
    assignment.endedAt !== null
  ) {
    return refuse(409, 'not_running', 'The match is not running on a Ready Up server', null);
  }
  const record = await liveStateStore.getLiveState(matchSlug);
  const current = record && record.epoch === assignment.epoch ? record : null;
  const proposal = await createProposal({
    slug: matchSlug,
    epoch: assignment.epoch,
    fleetServerId: assignment.serverId,
    cs2ServerId: assignment.cs2ServerId,
    phase: current?.state?.phase ?? null,
    failure: { reason: 'manual', since: nowS(), detail: `moved by ${req.actor ?? 'an admin'}` },
    state: current?.state ?? record?.state ?? null,
    mapStats: current?.mapStats ?? null,
    targetCs2ServerId: req.targetServerId ?? null,
  });
  if (!proposal)
    return refuse(409, 'not_open', 'The match is being moved', await activeProposal(matchSlug));
  const outcome = await acceptFailover(proposal.id, req);
  if (!outcome.ok && outcome.proposal?.status === 'open') {
    // Nothing moved: an admin's move is not left waiting.
    await setStatus(proposal.id, 'withdrawn', { detail: outcome.error });
  }
  return outcome;
}

export async function dismissFailover(id: string, actor: string | null): Promise<AcceptOutcome> {
  const proposal = await getProposal(id);
  if (!proposal) return refuse(404, 'not_found', 'No such failover', null);
  const changed = await db.runAsync(
    `UPDATE cs2_fleet_failovers SET status = 'dismissed', decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`,
    [actor, nowS(), nowS(), id]
  );
  if (changed.changes === 0)
    return refuse(409, 'not_open', `The failover is ${proposal.status}`, proposal);
  log.info(`[FAILOVER] ${proposal.matchSlug}: failover ${id} dismissed by ${actor ?? 'unknown'}`);
  const done = (await getProposal(id)) as FailoverProposal;
  announce(proposal.matchSlug, done);
  return { ok: true, proposal: done };
}

// ---------------------------------------------------------------------------
// Hooks: a server back on the link, csm health
// ---------------------------------------------------------------------------

/**
 * A server said hello. Holding a match: fine (the scan withdraws a failover
 * of it; an old epoch is the driver's zombie check). Holding nothing while
 * the platform still has a match on it (it crashed and restarted): the match
 * resumes there, a `restarted` failover, same connect address.
 */
async function onServerBack(fleetServerId: string, hello: HelloPayload): Promise<void> {
  const health = healthByServer.get(fleetServerId);
  if (health && health.event !== 'hung') healthByServer.delete(fleetServerId);
  offlineSeen.delete(fleetServerId);

  const held = hello.state as { match_id?: unknown } | null | undefined;
  if (held && typeof held.match_id === 'string') return;
  const rows = await db.queryAsync<{
    match_slug: string;
    epoch: number;
    cs2_server_id: string | null;
  }>(
    `SELECT a.match_slug, a.epoch, a.cs2_server_id
       FROM cs2_fleet_assignments a JOIN matches m ON m.slug = a.match_slug
      WHERE a.server_id = ? AND a.ended_at IS NULL AND a.config IS NOT NULL AND m.status IN ('loaded', 'live')`,
    [fleetServerId]
  );
  for (const row of rows) {
    const slug = row.match_slug;
    const open = await activeProposal(slug);
    if (open?.status === 'moving') continue;
    if (open)
      await setStatus(open.id, 'withdrawn', {
        detail: 'The server came back without the match; it resumes there.',
      });
    const record = await liveStateStore.getLiveState(slug);
    const epoch = Number(row.epoch);
    const saved = open ? await savedState(open.id) : null;
    const state =
      (record?.epoch === epoch ? record.state : null) ?? saved?.state ?? record?.state ?? null;
    const cs2ServerId = row.cs2_server_id ?? (await cs2ServerIdOf(fleetServerId));
    const proposal = await createProposal({
      slug,
      epoch,
      fleetServerId,
      cs2ServerId,
      phase: state?.phase ?? null,
      failure: {
        reason: 'restarted',
        since: nowS(),
        detail: 'the server came back without the match',
      },
      state,
      mapStats: (record?.epoch === epoch ? record.mapStats : null) ?? saved?.mapStats ?? null,
      targetCs2ServerId: cs2ServerId,
    });
    if (proposal && (await getFailoverSettings()).auto) await autoAccept(proposal);
  }
}

async function onHostHealth(hostId: string, payload: HostHealthPayload): Promise<void> {
  const server = (await hostServers(hostId)).find((s) => s.name === payload.server);
  const fleetServerId = server?.fleetServer?.id;
  if (!fleetServerId) return;
  if (payload.event === 'recovered' || payload.event === 'restarted') {
    healthByServer.delete(fleetServerId);
  } else {
    healthByServer.set(fleetServerId, {
      event: payload.event,
      at: nowS(),
      ...(payload.detail ? { detail: payload.detail } : {}),
    });
  }
  scheduleScan();
}

let scanTimer: NodeJS.Timeout | null = null;
let soon: NodeJS.Timeout | null = null;
let started = false;
/** onFleetServerReady has no unsubscribe: installed once, inert while stopped. */
let readyHooked = false;

function scheduleScan(): void {
  if (!started || soon) return;
  soon = setTimeout(() => {
    soon = null;
    void scanForFailovers().catch((error) =>
      log.warn(`[FAILOVER] scan failed: ${(error as Error).message}`)
    );
  }, 500);
  soon.unref?.();
}

const healthListener = (hostId: string, payload: HostHealthPayload) => {
  void onHostHealth(hostId, payload).catch((error) => {
    log.warn(`[FAILOVER] host.health from ${hostId} not applied: ${(error as Error).message}`);
  });
};

/** Start detection (from ../startup.ts). Idempotent. */
export function startFleetFailover(): void {
  if (started) return;
  started = true;
  startedAt = nowS();
  hostEvents.on('health', healthListener);
  if (!readyHooked) {
    readyHooked = true;
    onFleetServerReady((serverId, hello) => {
      if (!started) return;
      // Detached: the gateway runs these before the session's next frame, and
      // a resume in place waits for the server's answer to its match.assign.
      setImmediate(() => {
        void onServerBack(serverId, hello)
          .catch((error) => {
            log.warn(
              `[FAILOVER] ${serverId}: after-hello check failed: ${(error as Error).message}`
            );
          })
          .finally(() => scheduleScan());
      });
    });
  }
  scanTimer = setInterval(() => {
    void scanForFailovers().catch((error) =>
      log.warn(`[FAILOVER] scan failed: ${(error as Error).message}`)
    );
  }, CHECK_MS);
  scanTimer.unref?.();
}

export function stopFleetFailover(): void {
  if (scanTimer) clearInterval(scanTimer);
  if (soon) clearTimeout(soon);
  scanTimer = null;
  soon = null;
  hostEvents.off('health', healthListener);
  started = false;
}
