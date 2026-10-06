import { Navigate } from 'react-router-dom';
import { YourMatchCard } from '../components/tournament/match/YourMatchCard';
import { useTournamentPage } from '../components/tournament/page/tournamentPageContext';
import { tournamentTabPath } from '../paths';

/** The tournament page's "Your match" tab: the signed-in player's team's match. */
export default function TournamentYourMatchTab() {
  const { tournament, viewerTeam } = useTournamentPage();
  if (!viewerTeam) return <Navigate to={tournamentTabPath(tournament.id)} replace />;
  return <YourMatchCard teamId={viewerTeam.id} />;
}
