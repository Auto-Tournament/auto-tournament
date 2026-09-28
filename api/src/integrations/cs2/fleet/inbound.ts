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

import { EventEmitter } from 'events';
import type { PoolClient } from 'pg';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { redactFleetSecrets } from './credentials';
import { recordCommandResult, type FleetCommandRecord } from './commands';
import { ingestFleetEvent } from './ingest';
import {
  isFleetEventType,
  type Availability,
  type CmdResultPayload,
  type Envelope,
  type FleetEventData,
  type FleetEventPayload,
  type ServerAvailabilityPayload,
  type SkinsStattrakPayload,
  type StatePatchPayload,
  type StateSnapshotPayload,
} from './protocol/v1';
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
  /** Send an ephemeral message on this session (`state.request`). False when the socket is gone. */
  sendEphemeral(
    type: string,
    payload: Record<string, unknown>,
    extra?: { epoch?: number }
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
export interface InboundHandler {
  handle(ctx: InboundContext, env: Envelope): Promise<void>;
  persist?: boolean;
  priority?: 'normal' | 'low';
  validate?(payload: unknown): string | null;
}

const handlers = new Map<string, InboundHandler>();

export function registerInboundHandler(type: string, handler: InboundHandler): () => void {
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
  envelope: Envelope;
  /** What the state store did with the patch. */
  patch: PatchOutcome['kind'];
  /** The match's record after the patch (null when it has none yet). */
  record: LiveMatchRecord | null;
}

export interface FleetCommandResultNotice {
  serverId: string;
  envelope: Envelope;
  result: CmdResultPayload;
  /** The command it answers; null when `ref` is not one of ours. */
  command: FleetCommandRecord | null;
}

export interface FleetSnapshotNotice {
  serverId: string;
  payload: StateSnapshotPayload;
  outcome: SnapshotOutcome;
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

  onAvailability(
    listener: (notice: { serverId: string; availability: Availability; reason: string }) => void
  ): () => void {
    return this.on('availability', listener);
  }

  onSnapshot(listener: (notice: FleetSnapshotNotice) => void): () => void {
    return this.on('snapshot', listener);
  }

  onStattrak(
    listener: (notice: { serverId: string; payload: SkinsStattrakPayload }) => void
  ): () => void {
    return this.on('stattrak', listener);
  }

  /** @internal */
  emit(name: string, value: unknown): void {
    for (const listener of this.emitter.listeners(name) as Array<(v: unknown) => void>) {
      try {
        listener(value);
      } catch (error) {
        log.warn(`[FLEET] ${name} listener failed: ${(error as Error).message}`);
      }
    }
  }

  private on<T>(name: string, listener: (value: T) => void): () => void {
    this.emitter.on(name, listener as (v: unknown) => void);
    return () => this.emitter.off(name, listener as (v: unknown) => void);
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

function matchSlugOf(env: Envelope): string | null {
  const id = (env.payload as { match_id?: unknown }).match_id;
  return typeof id === 'string' ? id : null;
}

function revOf(env: Envelope): number | null {
  const rev = (env.payload as { rev?: unknown }).rev;
  return typeof rev === 'number' ? rev : null;
}

/**
 * Store a reliable message and move the server's stream position to its seq,
 * atomically. `rowId` is null when (server, stream, seq) was stored already.
 */
export async function persistInbound(
  ctx: InboundContext,
  env: Envelope
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
        matchSlugOf(env),
        env.epoch ?? null,
        revOf(env),
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
  env: Envelope,
  payload: { match_id: string; rev: number; patch: Record<string, unknown> }
): Promise<PatchOutcome> {
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

async function applyEvent(ctx: InboundContext, env: Envelope): Promise<void> {
  const payload = env.payload as unknown as FleetEventPayload;
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
    const round = (payload.data as FleetEventData['round_end']).round;
    mapRounds =
      (await liveStateStore.recordRound(payload.match_id, env.epoch, payload.map_number, round)) ??
      undefined;
  } else if (env.type === 'event.rounds_voided') {
    const data = payload.data as FleetEventData['rounds_voided'];
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
  fleetInbound.emit('event', {
    serverId: ctx.serverId,
    envelope: env,
    patch: outcome.kind,
    record,
  });
}

async function applyCommandResult(ctx: InboundContext, env: Envelope): Promise<void> {
  const result = env.payload as unknown as CmdResultPayload;
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
    // match.update answers carry the server's config_rev (the new one, or its own on a conflict).
    if (command.type === 'match.update' && command.matchSlug && typeof result.rev === 'number') {
      await liveStateStore.setConfigRev(command.matchSlug, result.rev);
    }
  }
  fleetInbound.emit('command', { serverId: ctx.serverId, envelope: env, result, command });
}

async function applyAvailability(
  ctx: InboundContext,
  payload: ServerAvailabilityPayload
): Promise<void> {
  await setAvailability(ctx.serverId, payload.availability);
  log.info(`[FLEET] ${ctx.serverId}: ${payload.availability} (${payload.reason})`);
  fleetInbound.emit('availability', {
    serverId: ctx.serverId,
    availability: payload.availability,
    reason: payload.reason,
  });
}

async function setAvailability(serverId: string, availability: Availability): Promise<void> {
  await db.runAsync('UPDATE cs2_fleet_servers SET availability = ?, updated_at = ? WHERE id = ?', [
    availability,
    Math.floor(Date.now() / 1000),
    serverId,
  ]);
}

/** Rows being applied right now (this process). */
const inFlight = new Set<number>();

/** Apply one stored message. Failures are logged and recorded on the row, never thrown. */
export async function processInbound(
  ctx: InboundContext,
  env: Envelope,
  rowId: number | null
): Promise<void> {
  if (rowId !== null) {
    // Another session of the same server may already be applying it.
    if (inFlight.has(rowId)) return;
    inFlight.add(rowId);
  }
  try {
    if (isFleetEventType(env.type)) {
      await applyEvent(ctx, env);
    } else {
      switch (env.type) {
        case 'state.patch':
          await applyPatchOf(ctx, env, env.payload as unknown as StatePatchPayload);
          break;
        case 'cmd.result':
          await applyCommandResult(ctx, env);
          break;
        case 'server.availability':
          await applyAvailability(ctx, env.payload as unknown as ServerAvailabilityPayload);
          break;
        case 'skins.stattrak':
          fleetInbound.emit('stattrak', {
            serverId: ctx.serverId,
            payload: env.payload as unknown as SkinsStattrakPayload,
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
    const env = JSON.parse(row.message) as Envelope;
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
  await setAvailability(ctx.serverId, payload.availability).catch((error) => {
    log.warn(`[FLEET] ${ctx.serverId}: availability update failed: ${(error as Error).message}`);
  });
  fleetInbound.emit('snapshot', { serverId: ctx.serverId, payload, outcome });
  return outcome;
}
