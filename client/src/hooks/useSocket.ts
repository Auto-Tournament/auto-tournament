import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { acquireSocket, currentSocket, releaseSocket } from '../utils/sharedSocket';

/**
 * The page's Socket.IO connection (utils/sharedSocket), held for as long as
 * the calling component is mounted.
 *
 * Game modules get their socket from here (through the SDK) instead of
 * calling `io()` themselves: the connection is the host's to open, configure
 * and close. Subscribe in an effect keyed on the socket and `off` your
 * handlers in its cleanup; never `close()` it. Pair it with
 * `onSocketReconnect` to refetch after a reconnect.
 *
 * Every caller shares one connection, and the socket is the same object for
 * the page's life.
 */
export function useSocket(): Socket {
  const [socket] = useState(currentSocket);

  useEffect(() => {
    acquireSocket();
    return releaseSocket;
  }, []);

  return socket;
}
