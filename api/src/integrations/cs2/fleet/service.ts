/**
 * The fleet's process-wide pieces: one gateway on the API's HTTP server, the
 * in-process `FleetBus` over it, and the token rotation job. Started and
 * stopped with the CS2 integration (../startup.ts).
 */

import type { Server as HttpServer } from 'http';
import { log } from '../../../utils/logger';
import { getIO } from '../../../services/socketService';
import { FleetGateway, type AssignmentResolver, type WelcomeRevs } from './gateway';
import type { HelloPayload } from './protocol/v1';
import { InProcessFleetBus, type FleetBus } from './bus';
import * as registry from './registry';
import { FLEET_CLOSE } from './protocol/v1';

const ROTATION_CHECK_MS = 60 * 60 * 1000;

const gateway = new FleetGateway();
const bus: FleetBus = new InProcessFleetBus(gateway);
let rotationTimer: NodeJS.Timeout | null = null;

// A server that comes online with a token due for rotation (or one an admin
// asked to rotate while it was offline) gets it straight after welcome.
gateway.onServerReady(async (serverId) => {
  const due = await registry.serversDueForRotation();
  if (due.includes(serverId)) await rotateServerToken(serverId);
});

export function fleetBus(): FleetBus {
  return bus;
}

/**
 * Run `listener` after every server's welcome (and its outbox replay), with its
 * hello: the fleet driver's zombie check, the pushes that follow the server's
 * state (./push: admins.set when its `admins_rev` is behind, server.config).
 */
export function onFleetServerReady(
  listener: (serverId: string, hello: HelloPayload) => Promise<void> | void
): void {
  gateway.onServerReady(listener);
}

/** Who fills `welcome.assignment` (the fleet driver). */
export function setFleetAssignmentResolver(resolver: AssignmentResolver | null): void {
  gateway.setAssignmentResolver(resolver);
}

/** welcome's `server_config_rev` / `admins_rev` (./push). */
export function setFleetWelcomeRevs(provider: ((serverId: string) => Promise<WelcomeRevs>) | null): void {
  gateway.setWelcomeRevs(provider);
}

/**
 * Hand a server a new token over its live socket (FLEET.md §4.3). The old
 * token keeps working for 24 h. Returns false when there is no live socket or
 * no token to rotate; `requestRotation` covers the offline case.
 */
export async function rotateServerToken(serverId: string): Promise<boolean> {
  if (!bus.isConnected(serverId)) return false;
  const started = await registry.beginRotation(serverId);
  if (!started) return false;
  // One auth.rotate per rotation: each send mints a new secret, so a second
  // copy would invalidate the token the server may already have written.
  if (started.alreadyPending) return true;
  // The secret is minted when the message is written to the socket; the
  // outbox row only holds the token id.
  await bus.send(serverId, {
    type: 'auth.rotate',
    payload: { token_id: started.tokenId, old_valid_until: started.oldValidUntil },
  });
  log.info(`[FLEET] ${serverId}: token rotation sent (old token valid until ${new Date(started.oldValidUntil).toISOString()})`);
  return true;
}

async function rotateDue(): Promise<void> {
  const due = new Set(await registry.serversDueForRotation());
  for (const serverId of bus.connectedServerIds()) {
    if (!due.has(serverId)) continue;
    await rotateServerToken(serverId).catch((error) => {
      log.warn(`[FLEET] ${serverId}: token rotation failed: ${(error as Error).message}`);
    });
  }
}

/** Revoke a server and close its socket with 4403. */
export async function revokeServer(serverId: string): Promise<boolean> {
  const revoked = await registry.revokeFleetServer(serverId);
  if (revoked) bus.disconnect(serverId, FLEET_CLOSE.REVOKED, 'revoked by an admin');
  return revoked;
}

export async function startFleet(server?: HttpServer): Promise<void> {
  const http = server ?? (getIO().httpServer as HttpServer | undefined);
  if (!http) {
    log.warn('[FLEET] no HTTP server to attach the fleet gateway to; Ready Up servers cannot connect');
    return;
  }
  await registry.markAllOffline();
  gateway.attach(http);
  if (!rotationTimer) {
    rotationTimer = setInterval(() => {
      void rotateDue().catch((error) => log.warn(`[FLEET] rotation check failed: ${(error as Error).message}`));
    }, ROTATION_CHECK_MS);
    rotationTimer.unref?.();
  }
}

export function stopFleet(): void {
  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = null;
  gateway.shutdown();
}
