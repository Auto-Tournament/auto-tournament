/**
 * What the gateway does with Ready Up's step-3 messages (docs/fleet-step3-
 * platform-notes.md §2-§5):
 *
 * - `persistInbound`: a reliable server message (cmd.result, state.patch,
 *   event.*, server.availability, skins.stattrak) is written to
 *   `cs2_fleet_events` together with the stream position, in one
 *   transaction, before the gateway acks it (persist-before-ack). The row is
 *   unique per (server, stream id, seq): a replay after a lost ack is not
 *   stored or applied twice.
 * - `processInbound`: then applied: the patch through the state store
 *   (./state), round summaries, the normalizer + ingest (./ingest), command
 *   answers (./commands), availability. The row gets `processed_at`, or
 *   `error` when applying failed. A row a crash left unprocessed is applied
 *   at the server's next hello (`replayUnprocessed`).
 * - `handleSnapshot`: an ephemeral `state.snapshot`.
 *
 * A rev gap makes the store hold the patch; this module then sends
 * `state.request` on the session (ctx.sendEphemeral).
 *
 * Everything that is not the core's (backups, demos, restores, forfeits,
 * admin calls, …) is announced on `fleetInbound` for the driver and later
 * features: `onEvent`, `onCommandResult`, `onAvailability`, `onSnapshot`,
 * `onStattrak`.
 */

import { noteMatchReport } from './matchReports';
import { EventEmitter } from 'events';
import type { PoolClient } from 'pg';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { redactFleetSecrets } from './credentials';
import { recordCommandResult, type FleetCommandRecord } from './commands';
import { saveMapStats } from './mapStats';
import { toPlatformMapNumber } from './normalize';
import { ingestFleetEvent } from './ingest';
import { recordServerLog } from './serverLog';
import {
  isFleetEventMessage,
  isFleetEventType,
  isKnownMessageType,
  type Availability,
  type CmdResultPayload,
  type Envelope,
  type FleetEventMessage,
  type FleetMessage,
  type FleetMessages,
  type FleetMessageType,
  type ServerAvailabilityPayload,
  type SkinsStattrakPayload,
  type StatePatchPayload,
  type StateSnapshotPayload,
} from './protocol/v1';
import type { Untrusted } from '../../../utils/untrusted';
import { flushRoundLoadouts, pushSkinsOnConnect, skinsTurnedOn } from './push/skins';
import { parseBusyDetail, parseBusyReason } from './busyReason';
import type { BusyReason } from './protocol/v1/types';
import {
  liveStateStore,
  type LiveMatchRecord,
  type PatchOutcome,
  type SnapshotOutcome,
} from './state';

/** The session a message arrived on. */
export interface InboundContext {
  serverId: string;
  /** The server's outbound stream id (hello.stream.id). */
  streamId: string;
  /**
   * Send an ephemeral message on this session (`state.request`, `demo.ack`).
   * `ref`: the id of the message it answers. False when the socket is gone.
   */
  sendEphemeral<K extends FleetMessageType>(
    type: K,
    payload: FleetMessages[K],
    extra?: { epoch?: number; ref?: string }
  ): boolean;
}

/** Reliable server message types this module stores and applies (besides `event.*`). */
const STORED_TYPES: ReadonlySet<string> = new Set([
  'cmd.result',
  'state.patch',
  'server.availability',
  'skins.stattrak',
]);

export function isStoredInboundType(type: string): boolean {
  return STORED_TYPES.has(type) || isFleetEventType(type);
}

// ---------------------------------------------------------------------------
// Extension point: handlers for further server -> platform types
// ---------------------------------------------------------------------------

/**
 * A handler for a server message type this module does not own (e.g. the
 * demo stream: `demo.begin` / `demo.chunk`, FLEET.md §12.2). Registered at
 * startup with `registerInboundHandler`; the gateway routes the type to it.
 *
 * - Reliable (with `seq`): run in stream order on the session's main queue,
 *   then acked. `persist: true` also stores it in `cs2_fleet_events` first
 *   (persist-before-ack); leave it off for large payloads.
 * - Ephemeral (no `seq`): `priority: 'low'` runs it on a separate
 *   per-session chain, so a burst of large frames (demo chunks) never delays
 *   events and state patches; application-level acks (`demo.ack`) are the
 *   handler's own business (`ctx.sendEphemeral`). `'normal'` runs it in order
 *   on the main queue.
 * - Validation: a type with a schema in protocol/v1 is validated by the
 *   gateway first; for a type without one, `validate` must do it (return an
 *   error message to reject with `error {invalid_payload}`).
 *
 * Frames are JSON text only (max 1 MiB, `MAX_FRAME_BYTES`); binary payloads
 * go base64 in the JSON. The per-server byte budget in gateway.ts (`RATE`)
 * applies to every frame.
 */
export interface InboundHandler<P = Untrusted> {
  /** A protocol/v1 type's payload is checked against its schema first, so it arrives typed. */
  handle(ctx: InboundContext, env: Envelope<string, P>): Promise<void>;
  persist?: boolean;
  priority?: 'normal' | 'low';
  validate?(payload: Untrusted): string | null;
}

const handlers = new Map<string, InboundHandler>();

export function registerInboundHandler<K extends FleetMessageType>(
  type: K,
  handler: InboundHandler<FleetMessages[K]>
): () => void {
  if (isStoredInboundType(type)) throw new Error(`fleet: ${type} is handled by fleet/inbound.ts`);
  handlers.set(type, handler);
  return () => {
    if (handlers.get(type) === handler) handlers.delete(type);
  };
}

export function inboundHandlerFor(type: string): InboundHandler | undefined {
  return handlers.get(type);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface FleetEventNotice {
  serverId: string;
  envelope: FleetEventMessage;
  /** What the state store did with the patch. */
  patch: PatchOutcome['kind'];
  /** The patch changed nothing but `live_rev` (an in-game chat line): no state was stored. */
  revOnly?: boolean;
  /** The match's record after the patch (null when it has none yet). */
  record: LiveMatchRecord | null;
}

export interface FleetCommandResultNotice {
  serverId: string;
  envelope: Envelope<'cmd.result', CmdResultPayload>;
  result: CmdResultPayload;
  /** The command it answers; null when `ref` is not one of ours. */
  command: FleetCommandRecord | null;
}

export interface FleetSnapshotNotice {
  serverId: string;
  payload: StateSnapshotPayload;
  outcome: SnapshotOutcome;
}

/** What each hook hands its listeners. */
interface FleetInboundNotices {
  event: FleetEventNotice;
  command: FleetCommandResultNotice;
  availability: {
    serverId: string;
    availability: Availability;
    reason: string;
    busyReason: BusyReason | null;
    busyDetail: string | null;
  };
  snapshot: FleetSnapshotNotice;
  stattrak: { serverId: string; payload: SkinsStattrakPayload };
}

class FleetInboundHooks {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  /** Every `event.*` after it was applied (stale-epoch ones too: `patch: 'stale_epoch'`). */
  onEvent(listener: (notice: FleetEventNotice) => void): () => void {
    return this.on('event', listener);
  }

  onCommandResult(listener: (notice: FleetCommandResultNotice) => void): () => void {
    return this.on('command', listener);
  }

  onAvailability(listener: (notice: FleetInboundNotices['availability']) => void): () => void {
    return this.on('availability', listener);
  }

  onSnapshot(listener: (notice: FleetSnapshotNotice) => void): () => void {
    return this.on('snapshot', listener);
  }

  onStattrak(listener: (notice: FleetInboundNotices['stattrak']) => void): () => void {
    return this.on('stattrak', listener);
  }

  /** @internal */
  emit<K extends keyof FleetInboundNotices>(name: K, value: FleetInboundNotices[K]): void {
    for (const listener of this.emitter.listeners(name) as Array<
      (v: FleetInboundNotices[K]) => void
    >) {
      try {
        listener(value);
      } catch (error) {
        log.warn(`[FLEET] ${name} listener failed: ${(error as Error).message}`);
      }
    }
  }

  private on<K extends keyof FleetInboundNotices>(
    name: K,
    listener: (value: FleetInboundNotices[K]) => void
  ): () => void {
    this.emitter.on(name, listener);
    return () => this.emitter.off(name, listener);
  }
}

export const fleetInbound = new FleetInboundHooks();

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return db.withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  });
}

function matchSlugOf(env: FleetMessage): string | null {
  return 'match_id' in env.payload && typeof env.payload.match_id === 'string'
    ? env.payload.match_id
    : null;
}

function revOf(env: FleetMessage): number | null {
  return 'rev' in env.payload && typeof env.payload.rev === 'number' ? env.payload.rev : null;
}

/**
 * Store a reliable message and move the server's stream position to its seq,
 * atomically. `rowId` is null when (server, stream, seq) was stored already.
 */
export async function persistInbound(
  ctx: InboundContext,
  env: FleetMessage | Envelope
): Promise<{ rowId: number | null }> {
  const seq = env.seq as number;
  return tx(async (c) => {
    const inserted = await c.query<{ id: string }>(
      `INSERT INTO cs2_fleet_events (server_id, stream_id, seq, message_id, type, match_slug, epoch, rev, ref, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (server_id, stream_id, seq) DO NOTHING
       RETURNING id`,
      [
        ctx.serverId,
        ctx.streamId,
        seq,
        env.id,
        env.type,
        isKnownMessageType(env.type) ? matchSlugOf(env as FleetMessage) : null,
        env.epoch ?? null,
        isKnownMessageType(env.type) ? revOf(env as FleetMessage) : null,
        env.ref ?? null,
        JSON.stringify(env),
      ]
    );
    await c.query('UPDATE cs2_fleet_servers SET rx_stream_id = $1, rx_seq = $2 WHERE id = $3', [
      ctx.streamId,
      seq,
      ctx.serverId,
    ]);
    const id = inserted.rows[0]?.id;
    return { rowId: id === undefined ? null : Number(id) };
  });
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function requestSnapshot(ctx: InboundContext, epoch: number | undefined): void {
  const sent = ctx.sendEphemeral('state.request', {}, epoch !== undefined ? { epoch } : {});
  if (sent) log.info(`[FLEET] ${ctx.serverId}: state.request sent (rev gap)`);
}

async function applyPatchOf(
  ctx: InboundContext,
  env: FleetMessage,
  payload: { match_id: string; rev: number; patch: StatePatchPayload['patch'] }
): Promise<PatchOutcome> {
  noteMatchReport(ctx.serverId, payload.match_id);
  const outcome = await liveStateStore.applyPatch(ctx.serverId, {
    matchSlug: payload.match_id,
    ...(env.epoch !== undefined ? { epoch: env.epoch } : {}),
    rev: payload.rev,
    patch: payload.patch,
    type: env.type,
  });
  if ((outcome.kind === 'gap' || outcome.kind === 'no_baseline') && outcome.requestSnapshot) {
    requestSnapshot(ctx, env.epoch);
  }
  if (outcome.kind === 'stale_epoch') {
    log.warn(
      `[FLEET] ${ctx.serverId}: ${env.type} for ${payload.match_id} has epoch ${env.epoch}, current is ${outcome.currentEpoch}; ignored`
    );
  }
  return outcome;
}

async function applyEvent(ctx: InboundContext, env: FleetEventMessage): Promise<void> {
  const payload = env.payload;
  const outcome = await applyPatchOf(ctx, env, payload);
  if (outcome.kind === 'stale_epoch') {
    fleetInbound.emit('event', {
      serverId: ctx.serverId,
      envelope: env,
      patch: outcome.kind,
      record: null,
    });
    return;
  }

  let mapRounds;
  if (env.type === 'event.round_end') {
    const round = env.payload.data.round;
    mapRounds =
      (await liveStateStore.recordRound(payload.match_id, env.epoch, payload.map_number, round)) ??
      undefined;
  } else if (env.type === 'event.rounds_voided') {
    const data = env.payload.data;
    const dropped = await liveStateStore.voidRounds(
      payload.match_id,
      env.epoch,
      payload.map_number,
      data.from_round
    );
    log.info(
      `[FLEET] ${ctx.serverId}: ${payload.match_id} map ${payload.map_number}: rounds >= ${data.from_round} voided (${data.reason}, ${dropped} dropped)`
    );
  }

  const record =
    outcome.kind === 'applied' || outcome.kind === 'duplicate'
      ? outcome.record
      : await liveStateStore.getLiveState(payload.match_id);
  await ingestFleetEvent(env, {
    state: record?.state ?? null,
    ...(mapRounds ? { mapRounds } : {}),
  });
  // The admin match page's server log (a repeat delivery is not a new line).
  if (outcome.kind !== 'duplicate') {
    await recordServerLog(
      payload.match_id,
      env,
      record?.state ?? null,
      payload.map_number,
      payload.round
    );
  }
  if (env.type === 'event.map_result') {
    const data = env.payload.data;
    await saveMapStats(
      payload.match_id,
      toPlatformMapNumber(data.map_number ?? payload.map_number),
      data.map_name ?? null,
      data.stats,
      { includeBots: record?.state?.rules?.simulation !== undefined }
    );
  }
  fleetInbound.emit('event', {
    serverId: ctx.serverId,
    envelope: env,
    patch: outcome.kind,
    ...(outcome.kind === 'applied' && outcome.revOnly ? { revOnly: true } : {}),
    record,
  });
}

async function applyCommandResult(
  ctx: InboundContext,
  env: Envelope<'cmd.result', CmdResultPayload>
): Promise<void> {
  const result = env.payload;
  const command = env.ref ? await recordCommandResult(ctx.serverId, env.ref, result) : null;
  if (!command) {
    log.warn(
      `[FLEET] ${ctx.serverId}: cmd.result for unknown message ${env.ref ?? '(no ref)'} (${result.status})`
    );
  } else {
    const detail = result.error
      ? ` ${result.error.code}${result.error.message ? `: ${redactFleetSecrets(result.error.message)}` : ''}`
      : '';
    log.info(
      `[FLEET] ${ctx.serverId}: ${command.type}${command.name ? ` ${command.name}` : ''} -> ${result.status}${detail}`
    );
    // The skins plugin answered a plugins.set: with skins on, it runs them now.
    if (command.type === 'cmd' && command.name === 'plugins.set' && result.status === 'ok') {
      // The server applied it: its plugins are what the command said until its
      // next hello reports them (the tryout list read the old state, 2026-10-14).
      await applyPluginsSetToState(ctx.serverId, env.ref as string);
      void skinsTurnedOn(ctx.serverId);
    }
    // match.update answers carry the server's config_rev (the new one, or its own on a conflict).
    if (command.type === 'match.update' && command.matchSlug && typeof result.rev === 'number') {
      await liveStateStore.setConfigRev(command.matchSlug, result.rev);
    }
  }
  fleetInbound.emit('command', { serverId: ctx.serverId, envelope: env, result, command });
}

/** A plugins.set the server answered ok: its enable / disable lists onto the stored plugins_state. */
async function applyPluginsSetToState(serverId: string, messageId: string): Promise<void> {
  const rows = await db.queryAsync<{ message: string }>(
    "SELECT message FROM cs2_fleet_outbox WHERE server_id = ? AND type = 'cmd'",
    [serverId]
  );
  type Lists = { enable?: string[]; disable?: string[] };
  let args = null as Lists | null;
  // The lists the platform stored with that push (./push/store.ts), else the outbox copy.
  const { readPrefs } = await import('./push/store');
  const prefs = await readPrefs(serverId);
  if (prefs.pushed.plugins?.id === messageId && prefs.plugins) args = prefs.plugins;
  for (const r of args ? [] : rows) {
    try {
      const env = JSON.parse(r.message) as { id?: string; payload?: { args?: Lists } };
      if (env.id === messageId) args = env.payload?.args ?? null;
    } catch {
      // not ours
    }
  }
  if (!args) return;
  const row = await db.queryOneAsync<{ plugins_state: string | null }>(
    'SELECT plugins_state FROM cs2_fleet_servers WHERE id = ?',
    [serverId]
  );
  let state: { installed: string[]; disabled: string[] } = { installed: [], disabled: [] };
  try {
    if (row?.plugins_state) state = JSON.parse(row.plugins_state);
  } catch {
    // start from nothing
  }
  const installed = new Set(state.installed ?? []);
  const disabled = new Set(state.disabled ?? []);
  for (const name of args.enable ?? []) {
    installed.add(name);
    disabled.delete(name);
  }
  for (const name of args.disable ?? []) {
    if (installed.has(name)) disabled.add(name);
  }
  await db.runAsync('UPDATE cs2_fleet_servers SET plugins_state = ? WHERE id = ?', [
    JSON.stringify({ installed: [...installed].sort(), disabled: [...disabled].sort() }),
    serverId,
  ]);
}

async function applyAvailability(
  ctx: InboundContext,
  payload: ServerAvailabilityPayload
): Promise<void> {
  const busyReason = parseBusyReason(payload.reason);
  const busyDetail = parseBusyDetail(payload.detail);
  await setAvailability(ctx.serverId, payload.availability, busyReason, busyDetail);
  log.info(`[FLEET] ${ctx.serverId}: ${payload.availability} (${payload.reason})`);
  fleetInbound.emit('availability', {
    serverId: ctx.serverId,
    availability: payload.availability,
    reason: payload.reason,
    busyReason,
    busyDetail,
  });
}

/** An available server has no busy reason, whatever came with it. */
async function setAvailability(
  serverId: string,
  availability: Availability,
  reason: BusyReason | null,
  detail: string | null
): Promise<void> {
  const busy = availability !== 'available';
  await db.runAsync(
    `UPDATE cs2_fleet_servers
        SET availability = ?, availability_reason = ?, availability_detail = ?, updated_at = ?
      WHERE id = ?`,
    [
      availability,
      busy ? reason : null,
      busy ? detail : null,
      Math.floor(Date.now() / 1000),
      serverId,
    ]
  );
}

/** Rows being applied right now (this process). */
const inFlight = new Set<number>();

/** Apply one stored message. Failures are logged and recorded on the row, never thrown. */
export async function processInbound(
  ctx: InboundContext,
  env: FleetMessage,
  rowId: number | null
): Promise<void> {
  if (rowId !== null) {
    // Another session of the same server may already be applying it.
    if (inFlight.has(rowId)) return;
    inFlight.add(rowId);
  }
  try {
    if (isFleetEventMessage(env)) {
      await applyEvent(ctx, env);
      // Loadout changes made during the round go out now (push/skins.ts).
      if (env.type === 'event.round_end') void flushRoundLoadouts(ctx.serverId);
      // A team gave up (.ff) or did not show: the admins hear of it.
      if (env.type === 'event.forfeit' || env.type === 'event.gg') {
        const p = env.payload;
        void import('../../../services/adminNoticeService').then(({ adminNoticeService }) =>
          adminNoticeService.raise(
            'match_forfeit',
            {
              matchSlug: p.match_id,
              team: p.data?.team ?? null,
              reason: p.data?.reason ?? null,
              kind: env.type,
            },
            `match_forfeit:${p.match_id}`
          )
        );
      }
      if (env.type === 'event.player_connect') {
        const p = env.payload;
        // Not awaited: a loadout never holds up the event stream.
        void pushSkinsOnConnect(ctx.serverId, p.match_id, p.data.steamid64);
      }
    } else {
      switch (env.type) {
        case 'state.patch':
          await applyPatchOf(ctx, env, env.payload);
          break;
        case 'cmd.result':
          await applyCommandResult(ctx, env);
          break;
        case 'server.availability':
          await applyAvailability(ctx, env.payload);
          break;
        case 'skins.stattrak':
          fleetInbound.emit('stattrak', {
            serverId: ctx.serverId,
            payload: env.payload,
          });
          break;
        default:
          break;
      }
    }
    if (rowId !== null) {
      await db.runAsync('UPDATE cs2_fleet_events SET processed_at = ? WHERE id = ?', [
        Math.floor(Date.now() / 1000),
        rowId,
      ]);
    }
  } catch (error) {
    const message = redactFleetSecrets((error as Error).message ?? String(error));
    log.error(`[FLEET] ${ctx.serverId}: applying ${env.type} seq ${env.seq} failed: ${message}`);
    if (rowId !== null) {
      await db
        .runAsync('UPDATE cs2_fleet_events SET error = ? WHERE id = ?', [
          message.slice(0, 2000),
          rowId,
        ])
        .catch(() => undefined);
    }
  } finally {
    if (rowId !== null) inFlight.delete(rowId);
  }
}

/**
 * Apply what a crash left stored but unapplied (no `processed_at`, no
 * `error`), oldest first. Run after a server's hello, before its new
 * messages. Returns how many rows were applied.
 */
export async function replayUnprocessed(ctx: Omit<InboundContext, 'streamId'>): Promise<number> {
  const rows = await db.queryAsync<{ id: string; stream_id: string; message: string }>(
    `SELECT id, stream_id, message FROM cs2_fleet_events
      WHERE server_id = ? AND processed_at IS NULL AND error IS NULL ORDER BY id ASC LIMIT 5000`,
    [ctx.serverId]
  );
  for (const row of rows) {
    // Stored after its payload passed the schema (persistInbound).
    const env = JSON.parse(row.message) as FleetMessage;
    await processInbound({ ...ctx, streamId: row.stream_id }, env, Number(row.id));
  }
  if (rows.length)
    log.warn(
      `[FLEET] ${ctx.serverId}: applied ${rows.length} stored message(s) a restart left unapplied`
    );
  return rows.length;
}

/** An ephemeral `state.snapshot`. */
export async function handleSnapshot(
  ctx: InboundContext,
  payload: StateSnapshotPayload
): Promise<SnapshotOutcome> {
  const outcome = await liveStateStore.applySnapshot(ctx.serverId, payload);
  if (outcome.kind === 'replaced' && outcome.record.needsSnapshot) {
    // Still a gap after the patches that followed on from it: ask again.
    requestSnapshot(ctx, outcome.record.epoch);
  }
  await setAvailability(
    ctx.serverId,
    payload.availability,
    parseBusyReason(payload.availability_reason),
    parseBusyDetail(payload.availability_detail)
  ).catch((error) => {
    log.warn(`[FLEET] ${ctx.serverId}: availability update failed: ${(error as Error).message}`);
  });
  noteMatchReport(ctx.serverId, (payload as { match_id?: string | null }).match_id);
  fleetInbound.emit('snapshot', { serverId: ctx.serverId, payload, outcome });
  return outcome;
}
