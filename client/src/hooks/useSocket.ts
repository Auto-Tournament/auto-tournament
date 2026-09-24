import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

/**
 * A connection to the platform's Socket.IO server, open for as long as the
 * calling component is mounted.
 *
 * Game modules get their socket from here (through the SDK) instead of
 * calling `io()` themselves: the connection is the host's to open, configure
 * and close. Subscribe in an effect keyed on the socket and `off` your
 * handlers in its cleanup; never `close()` it. Pair it with
 * `onSocketReconnect` to refetch after a reconnect.
 *
 * Today each caller gets its own connection, opened on mount and closed on
 * unmount, which is what the modules' own `io()` calls did. The socket object
 * is the same for the component's lifetime, and is created unconnected so
 * rendering opens nothing; the effect connects it.
 */
export function useSocket(): Socket {
  const [socket] = useState(() => io({ autoConnect: false }));

  useEffect(() => {
    socket.connect();
    return () => {
      socket.close();
    };
  }, [socket]);

  return socket;
}
