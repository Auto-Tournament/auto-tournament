/**
 * Live updates over Socket.IO.
 *
 * MAT pushes; polling `GET /api/matches` on a timer works but is a worse
 * scoreboard — it is either stale or wasteful, and never quite either.
 *
 * Events worth knowing (see docs/API.md in the MAT repo for the full list):
 *   match:update            any match changed
 *   match:update:<slug>     one match changed
 *   match:event:<slug>      round ends, map results
 *   veto:update:<slug>      map veto progressed
 *   bracket:update          bracket advanced
 *   tournament:update       tournament changed (started, completed, reset)
 *   server:status           a server came up or went down
 *
 * Treat a push as "this changed", not as the new state. `match:update` payloads
 * are partial — often just a slug, a status and live stats — and some carry
 * `team1Score` as maps won where the REST endpoints give the current map's
 * rounds. Refetch the match and render that; it is one small request, and the
 * score fields then mean what src/mat/types.ts says they mean.
 */

import { io, type Socket } from 'socket.io-client';
import type { Config } from '../config.js';

export function connectLiveUpdates(config: Config): Socket {
  // The Socket.IO endpoint is the API origin — no token. It is a read-only
  // broadcast of the same data the public match endpoints return.
  const socket = io(config.matUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
  });

  socket.on('connect', () => console.log('[mat] live updates connected'));
  socket.on('disconnect', (reason) => console.warn(`[mat] live updates lost: ${reason}`));
  socket.on('connect_error', (error) =>
    console.warn(`[mat] live updates could not connect: ${error.message}`)
  );

  return socket;
}

/**
 * Call `onChange` whenever MAT says one match changed, until the returned
 * function is called.
 *
 * Returns the unsubscribe rather than leaving the caller to remember the exact
 * event name it registered — forgetting that is how a bot ends up editing a
 * message for a match that finished an hour ago.
 */
export function followMatch(socket: Socket, slug: string, onChange: () => void): () => void {
  const event = `match:update:${slug}`;
  const handler = () => onChange();

  socket.on(event, handler);
  return () => socket.off(event, handler);
}
