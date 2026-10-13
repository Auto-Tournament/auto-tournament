import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { matchPagePath, tournamentTabPath } from '../paths';

/**
 * `/tournament/:id/match`, the old "Your match" tab: the viewer's team's
 * current match is played in its match room, so this sends them there, or to
 * the tournament's Overview when they have no match.
 */
export default function TournamentMatchRedirect() {
  const { tournament, viewerTeam } = useTournamentPage();
  const [slug, setSlug] = useState<string | null | undefined>(viewerTeam ? undefined : null);

  useEffect(() => {
    if (!viewerTeam) return;
    let live = true;
    fetch(`/api/team/${encodeURIComponent(viewerTeam.id)}/match`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { hasMatch?: boolean; match?: { slug?: string } } | null) => {
        if (live) setSlug(body?.hasMatch && body.match?.slug ? body.match.slug : null);
      })
      .catch(() => live && setSlug(null));
    return () => {
      live = false;
    };
  }, [viewerTeam]);

  if (slug === undefined) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  return <Navigate to={slug ? matchPagePath(slug) : tournamentTabPath(tournament.id)} replace />;
}
