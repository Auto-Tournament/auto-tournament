import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import MatchDetailsModal from './MatchDetailsModal';
import { registerMatchDetailsOpener } from './matchDetailsOpener';
import { api } from '../../utils/api';
import { getRoundLabel } from '../../utils/matchUtils';
import type { Match } from '../../types';

/**
 * The match details dialog that `openMatchDetails(slug)` opens, mounted once
 * by `App` (DESIGN-module-client-api.md, decision 7).
 *
 * Game modules open it through the SDK. Core pages that already hold the
 * match (Bracket, Matches, Manage, a player's history) keep mounting their
 * own, with their own callbacks.
 */
export function MatchDetailsHost() {
  const [match, setMatch] = useState<Match | null>(null);
  const { pathname } = useLocation();

  // A dialog a page mounted went away with the page. This one outlives pages,
  // so it closes when the route changes instead (state adjusted during
  // render, as React recommends over an effect).
  const [openOn, setOpenOn] = useState(pathname);
  if (openOn !== pathname) {
    setOpenOn(pathname);
    setMatch(null);
  }

  // The opener outlives renders, so it reads the route through a ref. Only
  // the latest request may open the dialog, and only on the page it was
  // asked from.
  const currentPathname = useRef(pathname);
  useEffect(() => {
    currentPathname.current = pathname;
  }, [pathname]);
  const latestRequest = useRef(0);

  useEffect(
    () =>
      registerMatchDetailsOpener(async (slug) => {
        const request = ++latestRequest.current;
        const askedOn = currentPathname.current;
        const response = await api.get<{ success: boolean; match?: Match }>(
          `/api/matches/${encodeURIComponent(slug)}`
        );
        if (!response?.match) {
          throw new Error(`Match '${slug}' not found`);
        }
        if (request === latestRequest.current && askedOn === currentPathname.current) {
          setMatch(response.match);
        }
      }),
    []
  );

  if (!match) return null;

  return (
    <MatchDetailsModal
      match={match}
      matchNumber={match.matchNumber || match.id}
      roundLabel={getRoundLabel(match.round)}
      onClose={() => setMatch(null)}
    />
  );
}
