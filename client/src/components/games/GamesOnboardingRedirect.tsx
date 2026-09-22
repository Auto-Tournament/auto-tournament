import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchMyGames } from './gamesApi';

/**
 * "What do you play?": a signed-in player with no games, who has not
 * dismissed the prompt, is sent to `/welcome/games` from wherever they landed
 * (the destination they were heading to is preserved as `?next=`). Replaces
 * the old app-wide dialog (`GamesPromptDialog`, removed) — a full page reads
 * better for a first-run choice than a modal stacked on top of whatever the
 * player opened first.
 *
 * Never redirects:
 * - an admin session (`isAuthenticated`) — admins can still open the page
 *   themselves, but are not pushed there;
 * - while impersonating — the endpoints answer for the real session, and a
 *   redirect here would be confusing mid-impersonation;
 * - anonymous visitors (no `playerSteamId`);
 * - already on `/welcome/games` (avoids a redirect loop).
 */
export function GamesOnboardingRedirect() {
  const { playerSteamId, isAuthenticated, impersonation, isLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading || isAuthenticated || impersonation || !playerSteamId) return;
    if (location.pathname === '/welcome/games') return;

    let cancelled = false;
    void fetchMyGames()
      .then((mine) => {
        if (cancelled || !mine?.showPrompt) return;
        const next = `${location.pathname}${location.search}${location.hash}`;
        navigate(`/welcome/games?next=${encodeURIComponent(next)}`, { replace: true });
      })
      .catch(() => {
        // No redirect if we cannot tell.
      });
    return () => {
      cancelled = true;
    };
  }, [
    isLoading,
    isAuthenticated,
    impersonation,
    playerSteamId,
    location.pathname,
    location.search,
    location.hash,
    navigate,
  ]);

  return null;
}
