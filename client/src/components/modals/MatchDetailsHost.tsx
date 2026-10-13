import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerMatchDetailsOpener } from './matchDetailsOpener';

/**
 * What `openMatchDetails(slug)` does, mounted once by `App`
 * (DESIGN-module-client-api.md, decision 7): it opens the match room, the one page a match is
 * run from, for players and admins alike. The old match dialog is gone.
 */
export function MatchDetailsHost() {
  const navigate = useNavigate();
  useEffect(
    () =>
      registerMatchDetailsOpener(async (slug) => {
        navigate(`/match/${encodeURIComponent(slug)}`);
      }),
    [navigate]
  );
  return null;
}
