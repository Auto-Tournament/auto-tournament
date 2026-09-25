/**
 * `FleetBus`: the one way the rest of the platform talks to a Ready Up server
 * (FLEET.md §19.1, D15).
 *
 * v1 is in-process: the socket is in this process's gateway. A multi-instance
 * bus (Postgres LISTEN/NOTIFY or Redis, routing to the instance that holds the
 * socket) implements the same interface, and callers do not change. Reliable
 * messages are written to the server's outbox first, so they reach a server
 * that is offline now when it reconnects, whatever instance it lands on.
 */

import type { FleetGateway } from './gateway';
import * as registry from './registry';

export interface FleetOutboundMessage {
  type: string;
  payload: Record<string, unknown>;
  /** Reliable (default for everything but ping/pong/ack/error): seq'd, stored and replayed until acked. */
  reliable?: boolean;
  /** Assignment epoch, for match-scoped messages. */
  epoch?: number;
  ref?: string | null;
  /** Unix seconds after which a replay is pointless (FLEET.md §6.4 `expires_at`). */
  expiresAt?: number | null;
}

export interface FleetSendResult {
  /** Handed to an open socket now. */
  delivered: boolean;
  /** The seq a reliable message got (it is in the outbox either way). */
  seq?: number;
}

export interface FleetBus {
  send(serverId: string, message: FleetOutboundMessage): Promise<FleetSendResult>;
  /** The server has a live, welcomed session. */
  isConnected(serverId: string): boolean;
  connectedServerIds(): string[];
  /** Close a server's session with a protocol close code (4403 on revoke, 4409, …). */
  disconnect(serverId: string, code: number, reason: string): boolean;
}

const EPHEMERAL = new Set(['ping', 'pong', 'ack', 'error']);

export class InProcessFleetBus implements FleetBus {
  constructor(private readonly gateway: FleetGateway) {}

  async send(serverId: string, message: FleetOutboundMessage): Promise<FleetSendResult> {
    const reliable = message.reliable ?? !EPHEMERAL.has(message.type);
    const session = this.gateway.session(serverId);
    if (!reliable) {
      const delivered = session ? session.sendEphemeral(message.type, message.payload, message.ref ?? undefined) : false;
      return { delivered };
    }
    const envelope = await registry.appendOutbox(serverId, {
      type: message.type,
      payload: message.payload,
      ...(message.epoch !== undefined ? { epoch: message.epoch } : {}),
      ...(message.ref !== undefined ? { ref: message.ref } : {}),
      expiresAt: message.expiresAt ?? null,
    });
    // Re-read: the session may have gone (or come) while the row was written.
    const live = this.gateway.session(serverId);
    const delivered = live ? await live.flushOutbox() : false;
    return { delivered, seq: envelope.seq };
  }

  isConnected(serverId: string): boolean {
    return this.gateway.session(serverId) !== null;
  }

  connectedServerIds(): string[] {
    return this.gateway.connectedServerIds();
  }

  disconnect(serverId: string, code: number, reason: string): boolean {
    return this.gateway.close(serverId, code, reason);
  }
}
