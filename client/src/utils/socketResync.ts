import type { Socket } from 'socket.io-client';

/**
 * Call `resync` every time `socket` reconnects after having been connected.
 *
 * The server broadcasts updates and keeps no backlog, so anything emitted
 * while a client was disconnected (laptop asleep, Wi-Fi drop, API restart,
 * proxy idle timeout) is simply lost. socket.io reconnects on its own, but the
 * page keeps showing whatever it had until something else happens to trigger
 * a fetch - which in practice meant "until a hard refresh". Refetching on
 * reconnect closes that gap.
 *
 * The first `connect` is skipped: the page has just done its initial load.
 * Returns an unsubscribe function for the effect cleanup.
 */
export function onSocketReconnect(socket: Socket, resync: () => void): () => void {
  let connectedBefore = socket.connected;
  const handleConnect = () => {
    if (connectedBefore) {
      resync();
    }
    connectedBefore = true;
  };
  socket.on('connect', handleConnect);
  return () => {
    socket.off('connect', handleConnect);
  };
}
