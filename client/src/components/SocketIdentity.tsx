import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { reconnectSharedSocket } from '../utils/sharedSocket';

/**
 * The server knows who a socket is from its handshake. After signing in or
 * out (or starting to view as someone), the page's shared socket
 * (utils/sharedSocket) opens again, so its rooms are the new viewer's.
 * Renders nothing.
 */
export function SocketIdentity() {
  const { playerSteamId, isAuthenticated, impersonation, isLoading } = useAuth();
  const who = `${playerSteamId ?? ''}|${isAuthenticated ? 'admin' : ''}|${impersonation ? 'as' : ''}`;
  // Who the socket opened as: the first known viewer (the page's own cookie).
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading) return;
    if (seen.current === null) {
      seen.current = who;
      return;
    }
    if (who === seen.current) return;
    seen.current = who;
    reconnectSharedSocket();
  }, [who, isLoading]);
  return null;
}
