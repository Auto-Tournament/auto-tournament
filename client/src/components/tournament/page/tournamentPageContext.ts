import { useOutletContext } from 'react-router-dom';
import type { Tournament } from '../../../types';
import type { OverviewTeamStanding, ViewerTeam } from '../../../hooks/usePublicTournamentOverview';

/**
 * What the tournament page (`pages/TournamentPage.tsx`) hands each tab through
 * the router outlet: the tournament is loaded once for the header and every
 * tab, instead of once per tab.
 */
export interface TournamentPageContext {
  tournament: Tournament;
  liveMatchCount: number;
  /** Team standings from the leaderboard route, best first (empty for shuffle). */
  teams: OverviewTeamStanding[];
  /** The signed-in player's team, when it is in this tournament. */
  viewerTeam: ViewerTeam | null;
  viewerHasSteamIdentity: boolean;
}

/** The tournament page's data, for a tab rendered inside it. */
export function useTournamentPage(): TournamentPageContext {
  return useOutletContext<TournamentPageContext>();
}
