/**
 * Tell the signed-in admins when a csm machine changes, so the Servers page
 * shows a command's progress, its result and the machine's inventory as they
 * happen. One push per machine at most every 250 ms: progress can come in
 * bursts, and the page reloads the whole list either way.
 */
import { emitFleetHostChanged } from '../../../../services/socketService';
import { hostEvents } from './gateway';

const THROTTLE_MS = 250;
const timers = new Map<string, NodeJS.Timeout>();

/** Push `hostId` soon, once, however many changes arrive meanwhile. */
export function pushHostChanged(hostId: string): void {
  if (timers.has(hostId)) return;
  timers.set(
    hostId,
    setTimeout(() => {
      timers.delete(hostId);
      emitFleetHostChanged(hostId);
    }, THROTTLE_MS)
  );
}

for (const event of ['inventory', 'health', 'result', 'progress', 'online', 'offline']) {
  hostEvents.on(event, (hostId: string) => pushHostChanged(hostId));
}
