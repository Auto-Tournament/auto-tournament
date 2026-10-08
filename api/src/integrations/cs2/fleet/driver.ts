/**
 * The fleet driver: the platform plays a match on a Ready Up server over the
 * fleet link (FLEET.md §7, §10, §11; Ready Up's
 * docs/fleet-step3-platform-notes.md §4, §6). It is the `fleet` half of the
 * CS2 `ServerDriver` (../driver.ts); the `rcon` half is the Auto Tournament
 * CS2 path that was there before.
 *
 * Servers are `cs2_servers` rows with `transport = 'fleet'` (./link.ts);
 * everything here takes that row's id (`matches.server_id`) and talks to the
 * fleet server behind it.
 *
 * - Assign: `match.assign` built from the same config the plugin downloads
 *   (./assignConfig.ts), with a new epoch (`beginAssignment`) and a new
 *   connect password, sent reliably; the answer decides: `ok` = loaded,
 *   `busy` / `draining` = try another server, no answer = unassigned again
 *   so it cannot start later on its own.
 * - Unassign: series over (`ended`), cancelled, restarted (`admin`), moved
 *   (`moved`, players kicked at once with a pointer to the match page), and
 *   zombies (`superseded`).
 * - `match.update` for roster / team name changes, with the config_rev CAS
 *   (one retry on `conflict`).
 * - `cmd` for the admin buttons (`runFleetCommand`), `exec` with an audit row.
 * - Hooks on the link (`startFleetDriver`): `welcome.assignment` for a server
 *   that reconnects mid-match; `match.unassign {superseded}` for a server that
 *   says hello with, or sends events for, an epoch the match has moved past
 *   (§11.4); turnover from `event.series_end` / `event.demo`; `event.admin_called`
 *   into the core's admin calls.
 */

import { db } from '../../../config/database';
import { holdOf } from '../../../services/matchHolds';
import { log } from '../../../utils/logger';
import { emitBracketUpdate, emitMatchUpdate, postMatchChatLine } from '../../../services/socketService';
import { firstMapOf } from '../utils/firstMap';
import { matchLiveStatsService } from '../../../services/matchLiveStatsService';
import { recordAdminCall } from '../../../services/adminCallService';
import { currentMatchConfig } from '../../../utils/matchIntegration';
import type { DbMatchRow } from '../../../types/database.types';
import type { MatchConfig } from '../../../types/match.types';
import { ServerStatus } from '../services/serverStatusService';
import { tvDelayFromCvars, serverTurnoverTracker } from '../utils/serverTurnover';
import { adminCallFromEvent } from '../events/adminCalled';
import type { AdminCalledEvent } from '../events/plugin-events.types';
import { ulid } from './credentials';
import { AssignConfigError, buildAssignConfig, diffAssignConfig, generateMatchPassword } from './assignConfig';
import { cs2ServerIdOf, fleetServerIdOf } from './link';
import { fleetInbound, type FleetEventNotice } from './inbound';
import { toPlatformMapNumber } from './normalize';
import {
  awaitCommandResult,
  FleetSendError,
  sendReliable,
  type FleetCommandRecord,
} from './reliable';
import { liveStateStore } from './state';
import { roundBackupStore } from './backups';
import { DEMO_STREAM_CAPABILITY } from './limits';
import { matchPluginDisabled } from './push/pluginSets';
import { fleetBus, onFleetServerReady, setFleetAssignmentResolver } from './service';
import type {
  AssignConfig,
  CmdName,
  FleetEventData,
  FleetEventPayload,
  HelloPayload,
  MatchPhase,
  MatchUpdateOp,
  ResumeBlock,
  UnassignReason,
  WelcomePayload,
} from './protocol/v1';

/** How long the allocator waits for Ready Up to accept a `match.assign`. */
const ASSIGN_TIMEOUT_MS = Number(process.env.FLEET_ASSIGN_TIMEOUT_MS) || 15_000;
/** How long an admin button waits for its `cmd.result`. */
const CMD_TIMEOUT_MS = Number(process.env.FLEET_CMD_TIMEOUT_MS) || 10_000;
/** A command not delivered within this long is answered `expired`, not run late. */
const CMD_EXPIRES_MS = 60_000;

export const MOVED_KICK_MESSAGE = 'Match moved to another server. Check the match page.';
export const CANCELLED_KICK_MESSAGE = 'The match was cancelled by an admin.';

/** Match commands: they need the assignment's match_id + epoch (FLEET.md §7.4). */
const MATCH_COMMANDS: ReadonlySet<CmdName> = new Set<CmdName>([
  'pause',
  'unpause',
  'force_ready',
  'start',
  'restore_round',
  'restart_map',
  'end_match',
  'change_map',
  'swap_teams',
  'restart_round',
  'end',
]);

// ---------------------------------------------------------------------------
// Assignments (cs2_fleet_assignments, migration 007)
// ---------------------------------------------------------------------------

export interface FleetAssignment {
  matchSlug: string;
  epoch: number;
  /** Fleet server. */
  serverId: string | null;
  /** The linked cs2_servers row. */
  cs2ServerId: string | null;
  password: string;
  /** The config the server acked (without the password); null until then. */
  config: Omit<AssignConfig, 'password'> | null;
  endedAt: number | null;
}

interface AssignmentRow {
  match_slug: string;
  epoch: number;
  server_id: string | null;
  cs2_server_id: string | null;
  password: string;
  config: string | null;
  ended_at: number | null;
}

const nowS = () => Math.floor(Date.now() / 1000);

function fromRow(row: AssignmentRow): FleetAssignment {
  let config: FleetAssignment['config'] = null;
  try {
    config = row.config ? (JSON.parse(row.config) as FleetAssignment['config']) : null;
  } catch {
    config = null;
  }
  return {
    matchSlug: row.match_slug,
    epoch: Number(row.epoch),
    serverId: row.server_id,
    cs2ServerId: row.cs2_server_id,
    password: row.password,
    config,
    endedAt: row.ended_at === null ? null : Number(row.ended_at),
  };
}

export async function getAssignment(matchSlug: string): Promise<FleetAssignment | null> {
  const row = await db.queryOneAsync<AssignmentRow>(
    'SELECT * FROM cs2_fleet_assignments WHERE match_slug = ?',
    [matchSlug]
  );
  return row ? fromRow(row) : null;
}

/** The assignment a fleet server holds now (not unassigned), newest first. */
async function openAssignmentsOf(fleetServerId: string): Promise<FleetAssignment[]> {
  const rows = await db.queryAsync<AssignmentRow>(
    `SELECT * FROM cs2_fleet_assignments WHERE server_id = ? AND ended_at IS NULL ORDER BY updated_at DESC`,
    [fleetServerId]
  );
  return rows.map(fromRow);
}

async function saveAssignment(input: {
  matchSlug: string;
  epoch: number;
  serverId: string;
  cs2ServerId: string;
  password: string;
}): Promise<void> {
  await db.runAsync(
    `INSERT INTO cs2_fleet_assignments (match_slug, epoch, server_id, cs2_server_id, password, config, created_at, updated_at, ended_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)
     ON CONFLICT (match_slug) DO UPDATE SET epoch = EXCLUDED.epoch, server_id = EXCLUDED.server_id,
       cs2_server_id = EXCLUDED.cs2_server_id, password = EXCLUDED.password, config = NULL,
       updated_at = EXCLUDED.updated_at, ended_at = NULL`,
    [input.matchSlug, input.epoch, input.serverId, input.cs2ServerId, input.password, nowS(), nowS()]
  );
  // The server takes one match at a time: an older assignment it still had
  // open (finished, not unassigned) is over.
  await db.runAsync(
    'UPDATE cs2_fleet_assignments SET ended_at = ? WHERE server_id = ? AND match_slug != ? AND ended_at IS NULL',
    [nowS(), input.serverId, input.matchSlug]
  );
}

async function storeAckedConfig(matchSlug: string, epoch: number, config: AssignConfig): Promise<void> {
  // The password lives in its own column; the stored config never has it.
  const rest: Partial<AssignConfig> = { ...config };
  delete rest.password;
  await db.runAsync(
    'UPDATE cs2_fleet_assignments SET config = ?, updated_at = ? WHERE match_slug = ? AND epoch = ?',
    [JSON.stringify(rest), nowS(), matchSlug, epoch]
  );
}

async function markEnded(matchSlug: string, epoch: number): Promise<void> {
  await db.runAsync(
    'UPDATE cs2_fleet_assignments SET ended_at = ?, updated_at = ? WHERE match_slug = ? AND epoch = ? AND ended_at IS NULL',
    [nowS(), nowS(), matchSlug, epoch]
  );
}

/**
 * The connect password of a match on a fleet server, while it is assigned
 * (FLEET.md D9: the caller shows it to the roster and admins only).
 */
export async function connectPasswordFor(matchSlug: string): Promise<string | null> {
  const assignment = await getAssignment(matchSlug);
  return assignment && assignment.endedAt === null ? assignment.password : null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface FleetServerStatus {
  fleetServerId: string | null;
  online: boolean;
  /** server.availability (hello, snapshots, availability messages). */
  availability: string | null;
  /** The match it holds for the platform. */
  matchSlug: string | null;
  phase: MatchPhase | null;
  /** The phase in the plugin's status words, for the views that show those. */
  status: ServerStatus | null;
}

const PHASE_STATUS: Record<MatchPhase, ServerStatus> = {
  loading: ServerStatus.LOADING,
  warmup: ServerStatus.WARMUP,
  knife: ServerStatus.KNIFE,
  side_pick: ServerStatus.KNIFE,
  live: ServerStatus.LIVE,
  paused: ServerStatus.PAUSED,
  halftime: ServerStatus.HALFTIME,
  overtime: ServerStatus.LIVE,
  map_end: ServerStatus.POSTGAME,
  series_end: ServerStatus.POSTGAME,
  restoring: ServerStatus.LOADING,
  error: ServerStatus.ERROR,
};

export async function fleetServerStatus(cs2ServerId: string): Promise<FleetServerStatus> {
  const fleetServerId = await fleetServerIdOf(cs2ServerId);
  if (!fleetServerId) {
    return { fleetServerId: null, online: false, availability: null, matchSlug: null, phase: null, status: null };
  }
  const online = fleetBus().isConnected(fleetServerId);
  const row = await db.queryOneAsync<{ availability: string | null }>(
    'SELECT availability FROM cs2_fleet_servers WHERE id = ?',
    [fleetServerId]
  );
  const availability = row?.availability ?? null;
  const [assignment] = await openAssignmentsOf(fleetServerId);
  let phase: MatchPhase | null = null;
  if (assignment) {
    const record = await liveStateStore.getLiveState(assignment.matchSlug);
    if (record && record.epoch === assignment.epoch) phase = record.state?.phase ?? null;
  }
  let status: ServerStatus | null = null;
  if (online) {
    if (phase) status = PHASE_STATUS[phase];
    else if (assignment) status = ServerStatus.LOADING;
    else if (availability === 'available') status = ServerStatus.IDLE;
    else if (availability === 'error') status = ServerStatus.ERROR;
    else status = null;
  }
  return {
    fleetServerId,
    online,
    availability,
    matchSlug: assignment?.matchSlug ?? null,
    phase,
    status,
  };
}

/** When each fleet server last became `available` (unix s), for turnover. */
const availableSince = new Map<string, number>();

/**
 * A linked fleet server the allocator may hand a match: online and
 * `available`, and its plugin set does not turn match off (a practice server).
 */
export async function fleetServerIsIdle(cs2ServerId: string): Promise<{
  idle: boolean;
  online: boolean;
  status: ServerStatus | null;
  idleSince: number | null;
}> {
  const s = await fleetServerStatus(cs2ServerId);
  // Ready Up's availability is the truth: a finished match it has unloaded
  // does not block it even before the platform's unassign (the notes §4).
  const idle =
    s.online &&
    s.availability === 'available' &&
    !(s.fleetServerId && (await matchPluginDisabled(s.fleetServerId)));
  return {
    idle,
    online: s.online,
    status: s.status,
    idleSince: s.fleetServerId ? (availableSince.get(s.fleetServerId) ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Assign
// ---------------------------------------------------------------------------

export interface FleetLoadResult {
  success: boolean;
  error?: string;
  /** The server cannot take it (busy, draining, offline, no answer): try another one. */
  retryElsewhere?: boolean;
  epoch?: number;
  /** The `match.assign` envelope id. */
  commandId?: string;
}

/** The config the plugin would download for this match (routes/matches.ts `/:slug.json`). */
async function servedMatchConfig(match: DbMatchRow): Promise<MatchConfig> {
  if (match.round === 0) {
    const { serveStandaloneMatchConfig } = await import('../matchConfig');
    const served = await serveStandaloneMatchConfig(match.slug);
    if (!served) throw new AssignConfigError(`Match ${match.slug} not found`);
    return served;
  }
  return (await currentMatchConfig(match)) as unknown as MatchConfig;
}

/** The server announced `demo.stream.v1` in its hello (./limits.ts). */
async function streamsDemos(fleetServerId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ capabilities: string | null }>(
    'SELECT capabilities FROM cs2_fleet_servers WHERE id = ?',
    [fleetServerId]
  );
  try {
    const caps = row?.capabilities ? (JSON.parse(row.capabilities) as unknown) : [];
    return Array.isArray(caps) && caps.includes(DEMO_STREAM_CAPABILITY);
  } catch {
    return false;
  }
}

async function joinPasswordEnabled(): Promise<boolean> {
  try {
    const { cs2Settings } = await import('../settingsReaders');
    return await cs2Settings.isAtJoinPasswordEnabled();
  } catch {
    return false;
  }
}

async function assignDefaults(): Promise<{ allowForceReady?: boolean; pauseAfterRestore?: boolean }> {
  try {
    const { cs2Settings } = await import('../settingsReaders');
    const core = await cs2Settings.getAtCoreDefaults();
    return { allowForceReady: core.allowForceReady, pauseAfterRestore: core.pauseAfterRestore };
  } catch {
    return {};
  }
}

function refusal(command: FleetCommandRecord): string {
  const code = command.errorCode ?? command.status;
  const message = command.result?.error?.message;
  return `Ready Up refused the match (${code}${message ? `: ${message}` : ''})`;
}

export interface AssignOptions {
  /**
   * Failover (FLEET.md §11.3, ./failover.ts): continue the match from a round
   * backup. A match that was live stays live, and its live stats are kept.
   */
  resume?: ResumeBlock;
}

/**
 * Put a match on the fleet server behind `cs2ServerId`. On success the match
 * is `loaded`, the same as an RCON load (a resumed live match stays `live`).
 */
export async function assignMatch(
  matchSlug: string,
  cs2ServerId: string,
  options: AssignOptions = {}
): Promise<FleetLoadResult> {
  const fleetServerId = await fleetServerIdOf(cs2ServerId);
  if (!fleetServerId) return { success: false, error: `Server ${cs2ServerId} is not a Ready Up fleet server` };
  if (!fleetBus().isConnected(fleetServerId)) {
    return { success: false, error: 'The Ready Up server is not connected', retryElsewhere: true };
  }
  const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);
  if (!match) return { success: false, error: 'Match not found' };

  let config: AssignConfig;
  let served: MatchConfig;
  // No join password unless the admin turned it on: the roster whitelist keeps others out.
  const password = (await joinPasswordEnabled()) ? generateMatchPassword() : '';
  try {
    served = await servedMatchConfig(match);
    config = await withHold(
      matchSlug,
      buildAssignConfig(served, password, {
        ...(await assignDefaults()),
        demoUpload: await streamsDemos(fleetServerId),
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[FLEET] ${matchSlug}: cannot build match.assign: ${message}`);
    return { success: false, error: message };
  }

  const record = await liveStateStore.beginAssignment(matchSlug, fleetServerId, 1);
  const epoch = record.epoch;
  if (!options.resume) {
    // A fresh start: round backups under this slug are an earlier match's (a
    // recreated tournament reuses the slugs). Left, a failover would resume
    // from them (NTLAN trial run 2: r1m1 resumed at round 11 of the previous
    // tournament's r1m1).
    const stale = await roundBackupStore.forget(matchSlug);
    if (stale > 0) log.info(`[FLEET] ${matchSlug}: ${stale} round backup(s) from an earlier match with this slug removed`);
  }
  await saveAssignment({ matchSlug, epoch, serverId: fleetServerId, cs2ServerId, password });

  let sent;
  try {
    sent = await sendReliable(fleetServerId, {
      type: 'match.assign',
      payload: {
        match_id: matchSlug,
        epoch,
        config_rev: 1,
        config,
        ...(options.resume ? { resume: options.resume } : {}),
      },
    });
  } catch (error) {
    await markEnded(matchSlug, epoch);
    const message = error instanceof FleetSendError ? error.message : (error as Error).message;
    log.error(`[FLEET] ${matchSlug}: match.assign not sent: ${message}`);
    return { success: false, error: message };
  }
  log.info(
    `[FLEET] ${matchSlug}: match.assign epoch ${epoch} sent to ${fleetServerId} (${cs2ServerId})${options.resume ? ` resuming map ${options.resume.map_number} round ${options.resume.round ?? 0}` : ''}`
  );

  const answer = await awaitCommandResult(sent.id, ASSIGN_TIMEOUT_MS);
  if (!answer || answer.status === 'pending') {
    // It stays in the outbox until acked: take it back, so the server does
    // not start the match on its own later while it plays somewhere else.
    await unassignEpoch(fleetServerId, matchSlug, epoch, 'cancelled').catch(() => undefined);
    log.warn(`[FLEET] ${matchSlug}: ${fleetServerId} did not answer match.assign in ${ASSIGN_TIMEOUT_MS} ms`);
    return {
      success: false,
      error: 'The Ready Up server did not answer the assignment in time',
      retryElsewhere: true,
      epoch,
      commandId: sent.id,
    };
  }
  if (answer.status !== 'ok') {
    await markEnded(matchSlug, epoch);
    const code = answer.errorCode ?? '';
    return {
      success: false,
      error: refusal(answer),
      retryElsewhere: code === 'busy' || code === 'draining' || answer.status === 'expired',
      epoch,
      commandId: sent.id,
    };
  }

  await storeAckedConfig(matchSlug, epoch, config);
  if (!options.resume) matchLiveStatsService.reset(matchSlug);
  const status = options.resume && match.status === 'live' ? 'live' : 'loaded';
  await db.updateAsync('matches', { status, loaded_at: nowS() }, 'slug = ?', [matchSlug]);
  log.matchLoaded(matchSlug, cs2ServerId, true);
  const updated = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);
  if (updated) {
    emitMatchUpdate(updated);
    emitBracketUpdate({ action: 'match_loaded', matchSlug });
    if (!options.resume) void postMatchChatLine(matchSlug, 'serverReady', { map: firstMapOf(updated) });
  }
  // With rules.demo.upload the server streams each map's demo; turnover
  // holds the server until the receiver (./demoStream.ts) has it.
  serverTurnoverTracker.matchLoaded(
    cs2ServerId,
    match.id,
    config.rules?.demo?.upload === true,
    tvDelayFromCvars(served.cvars)
  );
  return { success: true, epoch, commandId: sent.id };
}

// ---------------------------------------------------------------------------
// Unassign
// ---------------------------------------------------------------------------

async function unassignEpoch(
  fleetServerId: string,
  matchSlug: string,
  epoch: number,
  reason: UnassignReason,
  kickMessage?: string
): Promise<string> {
  const sent = await sendReliable(fleetServerId, {
    type: 'match.unassign',
    payload: {
      match_id: matchSlug,
      epoch,
      reason,
      ...(kickMessage ? { kick_message: kickMessage.slice(0, 190) } : {}),
    },
  });
  await markEnded(matchSlug, epoch);
  log.info(`[FLEET] ${matchSlug}: match.unassign epoch ${epoch} (${reason}) sent to ${fleetServerId}`);
  return sent.id;
}

/**
 * End the platform's assignment of `matchSlug` on the fleet server behind
 * `cs2ServerId`. Nothing to do when the match is not assigned there.
 * `wait` = resolve with the server's answer (null on timeout).
 */
export async function unassignMatch(
  cs2ServerId: string,
  matchSlug: string,
  reason: UnassignReason,
  options: { kickMessage?: string; wait?: boolean } = {}
): Promise<{ sent: boolean; answer: FleetCommandRecord | null }> {
  const fleetServerId = await fleetServerIdOf(cs2ServerId);
  if (!fleetServerId) return { sent: false, answer: null };
  const assignment = await getAssignment(matchSlug);
  const record = await liveStateStore.getLiveState(matchSlug);
  const epoch = assignment?.serverId === fleetServerId ? assignment.epoch : record?.serverId === fleetServerId ? record.epoch : 0;
  if (epoch < 1 || (assignment && assignment.epoch === epoch && assignment.endedAt !== null)) {
    return { sent: false, answer: null };
  }
  const id = await unassignEpoch(fleetServerId, matchSlug, epoch, reason, options.kickMessage);
  const answer = options.wait ? await awaitCommandResult(id, CMD_TIMEOUT_MS) : null;
  return { sent: true, answer };
}

/** End every match the platform has on this server (tournament reset / delete). */
export async function unassignAll(
  cs2ServerId: string,
  reason: UnassignReason,
  kickMessage?: string
): Promise<number> {
  const fleetServerId = await fleetServerIdOf(cs2ServerId);
  if (!fleetServerId) return 0;
  const open = await openAssignmentsOf(fleetServerId);
  for (const a of open) await unassignEpoch(fleetServerId, a.matchSlug, a.epoch, reason, kickMessage);
  return open.length;
}

// ---------------------------------------------------------------------------
// match.update
// ---------------------------------------------------------------------------

/**
 * A held match, or one in a paused tournament (services/matchHolds.ts): no
 * walkover clock on the server (Ready Up's absent-team forfeit off). When the
 * hold ends the config goes back to the rules as set and the server's clock
 * starts afresh (syncMatch sends the difference).
 */
async function withHold(matchSlug: string, config: AssignConfig): Promise<AssignConfig> {
  const hold = await holdOf(matchSlug);
  if (!hold?.heldUntil) return config;
  return {
    ...config,
    rules: { ...config.rules, forfeit: { ...config.rules?.forfeit, team_absent_seconds: 0 } },
  };
}

export type FleetUpdateOutcome =
  | { ok: true; ops: number; configRev: number | null }
  | { ok: false; status: 404 | 409 | 502 | 504; error: string };

/**
 * Send `ops` as a `match.update` with the config_rev CAS (§7.3): base = the
 * config_rev the server last acked. A `conflict` moves the base to the
 * server's (inbound.ts stores it) and the update is sent once more on it.
 */
export async function updateMatch(matchSlug: string, ops: MatchUpdateOp[]): Promise<FleetUpdateOutcome> {
  if (ops.length === 0) return { ok: true, ops: 0, configRev: null };
  const assignment = await getAssignment(matchSlug);
  if (!assignment || assignment.endedAt !== null || !assignment.serverId) {
    return { ok: false, status: 404, error: 'The match is not assigned to a Ready Up server' };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const record = await liveStateStore.getLiveState(matchSlug);
    const base = Math.max(1, record?.configRev ?? 1);
    const sent = await sendReliable(assignment.serverId, {
      type: 'match.update',
      payload: {
        match_id: matchSlug,
        epoch: assignment.epoch,
        base_config_rev: base,
        config_rev: base + 1,
        ops,
      },
    });
    const answer = await awaitCommandResult(sent.id, CMD_TIMEOUT_MS);
    if (!answer || answer.status === 'pending') {
      return { ok: false, status: 504, error: 'The Ready Up server did not answer the update in time' };
    }
    if (answer.status === 'ok') return { ok: true, ops: ops.length, configRev: answer.result?.rev ?? base + 1 };
    if (answer.errorCode !== 'conflict') {
      return { ok: false, status: 502, error: refusal(answer).replace('the match', 'the update') };
    }
    log.info(`[FLEET] ${matchSlug}: match.update conflict at base ${base}; retrying on the server's config_rev`);
  }
  return { ok: false, status: 409, error: 'The match config changed on the server; try again' };
}

/**
 * Bring the server's roster and team names in line with the match as it is
 * now (a team was edited, a player added): rebuild the config, diff it
 * against the acked one, send the difference.
 */
export async function syncMatch(matchSlug: string): Promise<FleetUpdateOutcome> {
  const assignment = await getAssignment(matchSlug);
  if (!assignment || assignment.endedAt !== null) {
    return { ok: false, status: 404, error: 'The match is not assigned to a Ready Up server' };
  }
  if (!assignment.config) {
    return { ok: false, status: 409, error: 'The server has not accepted the match yet' };
  }
  const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [matchSlug]);
  if (!match) return { ok: false, status: 404, error: 'Match not found' };
  let next: AssignConfig;
  try {
    next = await withHold(
      matchSlug,
      buildAssignConfig(await servedMatchConfig(match), assignment.password, await assignDefaults())
    );
  } catch (error) {
    return { ok: false, status: 409, error: (error as Error).message };
  }
  const ops = diffAssignConfig(assignment.config, next);
  const outcome = await updateMatch(matchSlug, ops);
  if (outcome.ok && ops.length > 0) await storeAckedConfig(matchSlug, assignment.epoch, next);
  return outcome;
}

/** Add one player (the admin's "add player" on a running match). */
export async function addPlayer(
  cs2ServerId: string,
  player: { steamid64: string; name: string; team: 'team1' | 'team2' | 'spectator' }
): Promise<FleetUpdateOutcome> {
  const fleetServerId = await fleetServerIdOf(cs2ServerId);
  const [assignment] = fleetServerId ? await openAssignmentsOf(fleetServerId) : [];
  if (!assignment) return { ok: false, status: 404, error: 'No match is assigned to this server' };
  const outcome = await updateMatch(assignment.matchSlug, [
    { op: 'add_player', team: player.team, steamid64: player.steamid64, name: player.name.slice(0, 128) },
  ]);
  if (outcome.ok && assignment.config) {
    const config = JSON.parse(JSON.stringify(assignment.config)) as Omit<AssignConfig, 'password'>;
    if (player.team === 'spectator') {
      config.spectators = [...new Set([...(config.spectators ?? []), player.steamid64])];
    } else {
      config[player.team].players.push({ steamid64: player.steamid64, name: player.name, role: 'player' });
    }
    await storeAckedConfig(assignment.matchSlug, assignment.epoch, { ...config, password: assignment.password });
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Admin commands (cmd)
// ---------------------------------------------------------------------------

export interface IssuedBy {
  userId: string;
  name: string;
  root: boolean;
}

export interface FleetCommandOutcome {
  /** The server ran it (`cmd.result ok`). */
  ok: boolean;
  /** HTTP status for the route. */
  httpStatus: number;
  status: FleetCommandRecord['status'] | 'timeout' | 'not_sent';
  errorCode: string | null;
  error?: string;
  /** `cmd.result.output` (exec, settings.set). */
  output?: string;
  commandId?: string;
  matchSlug?: string | null;
}

/**
 * Send an admin command to the fleet server behind `cs2ServerId` and wait
 * for its answer. Match commands go with the assignment's match_id + epoch.
 */
export async function runFleetCommand(
  cs2ServerId: string,
  name: CmdName,
  args: Record<string, unknown>,
  issuedBy: IssuedBy,
  options: { auditId?: string } = {}
): Promise<FleetCommandOutcome> {
  const fleetServerId = await fleetServerIdOf(cs2ServerId);
  if (!fleetServerId) {
    return { ok: false, httpStatus: 404, status: 'not_sent', errorCode: null, error: 'Not a Ready Up fleet server' };
  }
  let scope: { match_id: string; epoch: number } | null = null;
  if (MATCH_COMMANDS.has(name)) {
    const [assignment] = await openAssignmentsOf(fleetServerId);
    if (!assignment) {
      return {
        ok: false,
        httpStatus: 409,
        status: 'not_sent',
        errorCode: 'not_assigned',
        error: 'No match is assigned to this server',
      };
    }
    scope = { match_id: assignment.matchSlug, epoch: assignment.epoch };
  }
  let sent;
  try {
    sent = await sendReliable(fleetServerId, {
      type: 'cmd',
      payload: {
        ...(scope ?? {}),
        name,
        args,
        issued_by: {
          user_id: issuedBy.userId.slice(0, 64),
          name: issuedBy.name.slice(0, 128),
          root: issuedBy.root,
        },
        expires_at: Date.now() + CMD_EXPIRES_MS,
        ...(options.auditId ? { audit_id: options.auditId } : {}),
      },
    });
  } catch (error) {
    return {
      ok: false,
      httpStatus: 400,
      status: 'not_sent',
      errorCode: 'bad_request',
      error: (error as Error).message,
    };
  }
  const answer = await awaitCommandResult(sent.id, CMD_TIMEOUT_MS);
  if (!answer || answer.status === 'pending') {
    return {
      ok: false,
      httpStatus: 504,
      status: 'timeout',
      errorCode: null,
      error: sent.delivered
        ? 'The Ready Up server has not answered yet'
        : 'The Ready Up server is offline; the command runs if it reconnects within a minute',
      commandId: sent.id,
      matchSlug: scope?.match_id ?? null,
    };
  }
  const ok = answer.status === 'ok';
  const message = answer.result?.error?.message;
  return {
    ok,
    httpStatus: ok ? 200 : answer.status === 'rejected' ? 409 : 502,
    status: answer.status,
    errorCode: answer.errorCode,
    ...(ok ? {} : { error: `${answer.errorCode ?? answer.status}${message ? `: ${message}` : ''}` }),
    ...(answer.result?.output !== undefined ? { output: answer.result.output } : {}),
    commandId: sent.id,
    matchSlug: scope?.match_id ?? null,
  };
}

/** The current map (1-based) and round of the match on a fleet server, from its live state. */
export async function currentPosition(
  cs2ServerId: string
): Promise<{ matchSlug: string; mapNumber: number; round: number | null } | null> {
  const fleetServerId = await fleetServerIdOf(cs2ServerId);
  const [assignment] = fleetServerId ? await openAssignmentsOf(fleetServerId) : [];
  if (!assignment) return null;
  const record = await liveStateStore.getLiveState(assignment.matchSlug);
  const state = record?.epoch === assignment.epoch ? record.state : null;
  return {
    matchSlug: assignment.matchSlug,
    mapNumber: state?.series?.current_map ?? 1,
    round: state?.round?.number ?? null,
  };
}

/**
 * Root-only `exec` (FLEET.md §7.4, D10): the audit row is written first, its
 * id goes out as `audit_id`, and the answer is stored on it.
 */
export async function execOnFleetServer(
  cs2ServerId: string,
  command: string,
  issuedBy: IssuedBy & { actor: string | null }
): Promise<FleetCommandOutcome & { auditId: string }> {
  const auditId = ulid();
  const fleetServerId = await fleetServerIdOf(cs2ServerId);
  const [assignment] = fleetServerId ? await openAssignmentsOf(fleetServerId) : [];
  await db.runAsync(
    `INSERT INTO cs2_fleet_audit (id, actor, server_id, match_slug, command, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [auditId, issuedBy.actor, fleetServerId, assignment?.matchSlug ?? null, command, nowS()]
  );
  log.warn(`[FLEET] exec on ${cs2ServerId} by ${issuedBy.actor ?? 'unknown'} (audit ${auditId}): ${command}`);
  const outcome = await runFleetCommand(cs2ServerId, 'exec', { command }, issuedBy, { auditId });
  await db.runAsync(
    `UPDATE cs2_fleet_audit SET message_id = ?, status = ?, error_code = ?, output = ?, answered_at = ? WHERE id = ?`,
    [
      outcome.commandId ?? null,
      outcome.status,
      outcome.errorCode,
      outcome.output ?? null,
      outcome.status === 'timeout' || outcome.status === 'not_sent' ? null : nowS(),
      auditId,
    ]
  );
  return { ...outcome, auditId };
}

// ---------------------------------------------------------------------------
// Hooks on the link
// ---------------------------------------------------------------------------

/** Zombie unassigns already sent: `${server}:${slug}:${epoch}`. */
const supersededSent = new Set<string>();

async function supersede(fleetServerId: string, matchSlug: string, epoch: number, why: string): Promise<void> {
  const key = `${fleetServerId}:${matchSlug}:${epoch}`;
  if (supersededSent.has(key)) return;
  supersededSent.add(key);
  if (supersededSent.size > 10_000) supersededSent.clear();
  log.warn(`[FLEET] ${fleetServerId} still holds ${matchSlug} epoch ${epoch} (${why}); unassigning it (superseded)`);
  await sendReliable(fleetServerId, {
    type: 'match.unassign',
    payload: { match_id: matchSlug, epoch, reason: 'superseded', kick_message: MOVED_KICK_MESSAGE },
  });
}

/**
 * Failover (FLEET.md §11.4): retire `epoch` on the server that held it before
 * the match moves on. `match.unassign {superseded}` (`moved` for an admin's
 * move off a live server) goes to its outbox, so a dead server gets it when it
 * comes back, with the "match moved" kick; the assignment is ended, and its
 * later hello at that epoch does not send a second one.
 */
export async function fenceEpoch(
  fleetServerId: string,
  matchSlug: string,
  epoch: number,
  reason: 'superseded' | 'moved' = 'superseded'
): Promise<string> {
  supersededSent.add(`${fleetServerId}:${matchSlug}:${epoch}`);
  return unassignEpoch(fleetServerId, matchSlug, epoch, reason, MOVED_KICK_MESSAGE);
}

/** `welcome.assignment`: the match this server holds on the platform's side, still being played. */
export async function resolveWelcomeAssignment(
  fleetServerId: string,
  _hello: HelloPayload
): Promise<WelcomePayload['assignment']> {
  for (const assignment of await openAssignmentsOf(fleetServerId)) {
    const record = await liveStateStore.getLiveState(assignment.matchSlug);
    if (!record || record.epoch !== assignment.epoch || record.serverId !== fleetServerId) continue;
    const match = await db.queryOneAsync<{ status: string }>('SELECT status FROM matches WHERE slug = ?', [
      assignment.matchSlug,
    ]);
    if (match && (match.status === 'loaded' || match.status === 'live')) {
      return { match_id: assignment.matchSlug, epoch: assignment.epoch };
    }
  }
  return null;
}

/** After a welcome: a server holding a match the platform has moved on from gets `superseded` (§6.1, §11.4). */
async function checkHello(fleetServerId: string, hello: HelloPayload): Promise<void> {
  const state = hello.state as { match_id?: unknown; epoch?: unknown } | null | undefined;
  if (state && typeof state.match_id === 'string' && typeof state.epoch === 'number') {
    // A match the platform never assigned (a local `ru match load`) has no
    // record: not ours to end.
    const record = await liveStateStore.getLiveState(state.match_id);
    if (record && state.epoch < record.epoch) {
      await supersede(fleetServerId, state.match_id, state.epoch, `hello at epoch ${state.epoch}, current ${record.epoch}`);
    }
  } else {
    const assignment = await resolveWelcomeAssignment(fleetServerId, hello);
    if (assignment) {
      log.warn(
        `[FLEET] ${fleetServerId} came back without ${assignment.match_id} (epoch ${assignment.epoch}) loaded; ` +
          'failover resumes it there (failover.ts)'
      );
    }
  }
  if (hello.availability === 'available' && (await cs2ServerIdOf(fleetServerId))) {
    availableSince.set(fleetServerId, nowS());
    triggerAllocation();
  }
}

function triggerAllocation(): void {
  setImmediate(() => {
    void import('../../../core/scheduler')
      .then(({ scheduler }) => scheduler.tryImmediateAllocation())
      .catch((error) => log.debug('[FLEET] allocation after availability failed', { error: (error as Error).message }));
  });
}

async function onFleetEvent(notice: FleetEventNotice): Promise<void> {
  const env = notice.envelope;
  const payload = env.payload as unknown as FleetEventPayload;
  const slug = payload.match_id;

  if (env.type === 'event.admin_called') {
    // Recorded whatever the epoch: a player asking for help is never dropped.
    const data = payload.data as FleetEventData['admin_called'];
    const match = (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug])) ?? null;
    const cs2ServerId = await cs2ServerIdOf(notice.serverId);
    const event: AdminCalledEvent = {
      event: 'admin_called',
      matchid: slug,
      map_number: typeof payload.map_number === 'number' ? toPlatformMapNumber(payload.map_number) : null,
      call_id: data.call_id,
      player: data.player,
      message: data.message,
      called_at: data.called_at,
    };
    const input = await adminCallFromEvent(event, {
      match,
      serverCandidates: [cs2ServerId, match?.server_id],
    });
    await recordAdminCall(input);
  }

  if (notice.patch === 'stale_epoch') {
    if (typeof env.epoch === 'number') {
      await supersede(notice.serverId, slug, env.epoch, `${env.type} from an old epoch`);
    }
    return;
  }

  if (env.type === 'event.match_restored') {
    // The live score goes back to the restored backup's (the round's start).
    // Without this it keeps the abandoned timeline's score until a later
    // round ends (NTLAN trial run: restored to 1-0, still shown 2-1).
    const data = payload.data as FleetEventData['match_restored'];
    const backups = await roundBackupStore.list(slug);
    const backup =
      backups.find((b) => b.sha256 === data.backup_sha256) ??
      backups.find((b) => b.mapNumber === data.map_number && b.round === data.round);
    if (backup) {
      const stats = matchLiveStatsService.update(slug, {
        mapNumber: toPlatformMapNumber(backup.mapNumber),
        team1Score: backup.score.team1,
        team2Score: backup.score.team2,
      });
      emitMatchUpdate({ slug, liveStats: stats });
    }
    return;
  }

  const cs2ServerId = await cs2ServerIdOf(notice.serverId);
  if (!cs2ServerId) return;
  const now = nowS();
  const matchId = (await db.queryOneAsync<{ id: number }>('SELECT id FROM matches WHERE slug = ?', [slug]))?.id;
  if (matchId === undefined) return;
  switch (env.type) {
    case 'event.map_result':
      serverTurnoverTracker.recordEvent(cs2ServerId, { event: 'map_result', matchid: matchId, map_number: toPlatformMapNumber(payload.map_number) }, now);
      break;
    case 'event.series_end':
      serverTurnoverTracker.recordEvent(cs2ServerId, { event: 'series_end', matchid: matchId }, now);
      break;
    case 'event.demo': {
      const data = payload.data as FleetEventData['demo'];
      const map = toPlatformMapNumber(data.map_number ?? payload.map_number);
      // A recorded map holds the server until its upload reports back (or
      // the tracker gives up on it), but only when the match was assigned
      // with rules.demo.upload: until the demo receiver exists it is false
      // and nothing is uploaded, so recording holds nothing.
      if (data.type === 'recording_started') {
        const assignment = await getAssignment(slug);
        if (assignment?.config?.rules?.demo?.upload === true) {
          serverTurnoverTracker.recordEvent(cs2ServerId, { event: 'demo_recording_start', matchid: matchId, map_number: map }, now);
        }
      } else if (data.type === 'upload_succeeded' || data.type === 'upload_failed') {
        serverTurnoverTracker.recordEvent(cs2ServerId, { event: 'demo_upload_ended', matchid: matchId, map_number: map }, now);
      }
      break;
    }
    default:
      break;
  }
}

let started = false;

/** Install the driver's hooks on the fleet link. Idempotent; called before the gateway starts. */
export function startFleetDriver(): void {
  if (started) return;
  started = true;
  setFleetAssignmentResolver(resolveWelcomeAssignment);
  onFleetServerReady((serverId, hello) => checkHello(serverId, hello));
  fleetInbound.onEvent((notice) => {
    void onFleetEvent(notice).catch((error) => {
      log.warn(`[FLEET] ${notice.serverId}: driver hook for ${notice.envelope.type} failed: ${(error as Error).message}`);
    });
  });
  fleetInbound.onAvailability(({ serverId, availability }) => {
    if (availability === 'available') {
      availableSince.set(serverId, nowS());
      void cs2ServerIdOf(serverId)
        .then((linked) => {
          if (linked) triggerAllocation();
        })
        .catch(() => undefined);
    } else {
      availableSince.delete(serverId);
    }
  });
}
