import { useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { startPresenceReporting } from './presenceStore';

/**
 * A signed-in player's tab tells the server when it goes idle and comes back,
 * so others see them away (presenceStore.ts). Renders nothing.
 */
export function PresenceReporter() {
  const { playerSteamId, impersonation } = useAuth();
  const enabled = Boolean(playerSteamId) && !impersonation;
  useEffect(() => {
    if (!enabled) return;
    return startPresenceReporting();
  }, [enabled, playerSteamId]);
  return null;
}
