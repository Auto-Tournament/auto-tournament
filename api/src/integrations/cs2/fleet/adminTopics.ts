/**
 * The `fleet` page topic (services/socketService emitTopic): the Servers page
 * panels, server availability and the match panels re-read when something in
 * the fleet changes, instead of polling. A server connecting or going, its
 * availability, snapshots, events and command answers, a stored live-state
 * change, a csm machine's progress, an autoscale action and a failover each
 * count; the socket service coalesces a burst into one push.
 */
import type { NextFunction, Request, Response } from 'express';
import { emitTopic } from '../../../services/socketService';
import { fleetInbound } from './inbound';
import { liveStateStore } from './state';
import { onFleetServerClosed, onFleetServerReady } from './service';
import { hostEvents } from './hosts/gateway';

/** Tell the admins' pages that the fleet changed. */
export function fleetChanged(): void {
  emitTopic('fleet', { admin: true });
}

/** Router middleware: an admin's change through it (anything but a read that succeeded) is a fleet change. */
export function fleetChangedOnWrite(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => {
      if (res.statusCode < 400) fleetChanged();
    });
  }
  next();
}

let started = false;

export function startFleetTopics(): void {
  if (started) return;
  started = true;
  onFleetServerReady(() => fleetChanged());
  onFleetServerClosed(() => fleetChanged());
  fleetInbound.onAvailability(() => fleetChanged());
  fleetInbound.onSnapshot(() => fleetChanged());
  // A rev-only event (in-game chat) changes nothing the admin pages show.
  fleetInbound.onEvent((notice) => {
    if (!notice.revOnly) fleetChanged();
  });
  fleetInbound.onCommandResult(() => fleetChanged());
  liveStateStore.onLiveStateChange(() => fleetChanged());
  for (const event of ['inventory', 'health', 'result', 'progress', 'online', 'offline']) {
    hostEvents.on(event, () => fleetChanged());
  }
}
