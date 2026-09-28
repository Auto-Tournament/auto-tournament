/**
 * `sendReliable`: the one call the fleet driver uses to send a platform →
 * server message that must arrive (FLEET.md §6.4, Ready Up's
 * docs/fleet-step3-platform-notes.md §2).
 *
 * - The payload is validated against its schema first: an invalid message
 *   throws here instead of sitting in the outbox.
 * - Match-scoped messages (`match.*`, a `cmd` with a `match_id`) need the
 *   assignment epoch; it goes into the **envelope** `epoch` (Ready Up also
 *   reads `payload.epoch`, which the schemas require for `match.*`).
 * - `match.assign`, `match.update`, `match.unassign` and `cmd` are answered
 *   by exactly one `cmd.result` (envelope `ref` = the message id). They are
 *   recorded in `cs2_fleet_commands` before they are sent, so the answer
 *   always finds its row; `awaitCommandResult(id)` waits for it.
 * - The message is appended to the server's outbox (seq assigned in the same
 *   transaction), written to the socket when the server is online, and
 *   replayed after every reconnect until the server acks it.
 * - `cmd.expires_at` (unix ms, 0 = never) doubles as the outbox expiry; the
 *   server answers an expired command `expired` without running it.
 */

import { ulid } from './credentials';
import { recordCommand, setCommandSeq } from './commands';
import {
  FLEET_ANSWERED_TYPES,
  FLEET_MESSAGES,
  isKnownMessageType,
  validatePayload,
  type FleetMessages,
} from './protocol/v1';
import { fleetBus } from './service';

/** Platform → server reliable types `sendReliable` accepts. */
export type ReliableType =
  | 'match.assign'
  | 'match.update'
  | 'match.unassign'
  | 'cmd'
  | 'admins.set'
  | 'skins.loadout'
  | 'skins.invalidate'
  | 'server.config';

export interface ReliableMessage<T extends ReliableType = ReliableType> {
  type: T;
  payload: FleetMessages[T];
  /** Envelope epoch. Defaults to `payload.epoch`; required for match-scoped messages. */
  epoch?: number;
}

export interface ReliableSendResult {
  /** Envelope id: the `ref` of its `cmd.result`, and the key for `awaitCommandResult`. */
  id: string;
  /** Its seq in the server's stream. */
  seq: number;
  /** Written to an open socket now (else it goes at the next connect). */
  delivered: boolean;
  /** Answered by a `cmd.result`. */
  answered: boolean;
}

export class FleetSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FleetSendError';
  }
}

function matchScope(
  type: ReliableType,
  payload: Record<string, unknown>
): { slug: string | null; scoped: boolean } {
  const slug = typeof payload.match_id === 'string' ? payload.match_id : null;
  const scoped = type.startsWith('match.') || (type === 'cmd' && slug !== null);
  return { slug, scoped };
}

export async function sendReliable<T extends ReliableType>(
  serverId: string,
  message: ReliableMessage<T>
): Promise<ReliableSendResult> {
  const { type } = message;
  const payload = message.payload as unknown as Record<string, unknown>;
  if (
    !isKnownMessageType(type) ||
    FLEET_MESSAGES[type].direction !== 'platform_to_server' ||
    !FLEET_MESSAGES[type].reliable
  ) {
    throw new FleetSendError(`${type} is not a reliable platform → server message`);
  }
  const check = validatePayload(type, payload);
  if (!check.ok) throw new FleetSendError(`invalid ${type}: ${check.errors.join('; ')}`);

  const { slug, scoped } = matchScope(type, payload);
  const epoch = message.epoch ?? (typeof payload.epoch === 'number' ? payload.epoch : undefined);
  if (scoped && (epoch === undefined || epoch < 1)) {
    throw new FleetSendError(`${type}${slug ? ` for ${slug}` : ''} needs the assignment epoch`);
  }
  if (epoch !== undefined && typeof payload.epoch === 'number' && payload.epoch !== epoch) {
    throw new FleetSendError(`${type}: envelope epoch ${epoch} != payload.epoch ${payload.epoch}`);
  }

  const id = ulid();
  const answered = FLEET_ANSWERED_TYPES.has(type);
  if (answered) {
    await recordCommand({
      id,
      serverId,
      type,
      matchSlug: slug,
      epoch: epoch ?? null,
      name: type === 'cmd' ? String(payload.name) : null,
    });
  }

  const expiresMs = type === 'cmd' ? Number(payload.expires_at) : 0;
  const sent = await fleetBus().send(serverId, {
    id,
    type,
    payload,
    reliable: true,
    ...(epoch !== undefined ? { epoch } : {}),
    expiresAt: expiresMs > 0 ? Math.ceil(expiresMs / 1000) : null,
  });
  const seq = sent.seq as number;
  if (answered) await setCommandSeq(id, seq);
  return { id, seq, delivered: sent.delivered, answered };
}

/** Ask a server for a fresh `state.snapshot` (ephemeral: only when it is online). */
export async function requestSnapshot(serverId: string, epoch?: number): Promise<boolean> {
  const sent = await fleetBus().send(serverId, {
    type: 'state.request',
    payload: {},
    reliable: false,
    ...(epoch !== undefined ? { epoch } : {}),
  });
  return sent.delivered;
}

export { awaitCommandResult, getCommand, listCommands, type FleetCommandRecord } from './commands';
