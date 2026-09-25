import type { Match, Tournament } from '../../../types';
import {
  compareMatchOrder,
  eliminationRoundCount,
  getBracketMatchLabel,
  getRoundLabel,
} from '../../../utils/matchUtils';
import { deriveSeriesScore } from '../../../utils/matchScoreDisplay';

/** "Quarterfinals", "LB R2 M1", "Grand Final", "Round 3". */
export function publicMatchLabel(
  match: Pick<Match, 'slug' | 'bracket' | 'round' | 'matchNumber'>,
  tournament: Pick<Tournament, 'type' | 'teamIds'>
): string {
  return (
    getBracketMatchLabel(match) ??
    getRoundLabel(match.round, eliminationRoundCount(tournament.teamIds.length, tournament.type))
  );
}

/** Being played or about to be: a server is loaded or the match is live. */
export const isLiveMatch = (match: Pick<Match, 'status'>): boolean =>
  match.status === 'live' || match.status === 'loaded';

/** Not played yet, with at least one team known (the other may still be "TBD"). */
export const isUpcomingMatch = (match: Match): boolean =>
  (match.status === 'pending' || match.status === 'ready') && (!!match.team1 || !!match.team2);

/** Series score for a list row: maps won, falling back to the headline score. */
export function seriesScore(match: Match): { team1: number; team2: number } {
  const { team1, team2 } = deriveSeriesScore(match, match.liveStats ?? null);
  return { team1, team2 };
}

/** The match a team plays now or next, in bracket order; null when it has none left. */
export function teamCurrentMatch(matches: Match[], teamId: string): Match | null {
  const own = matches.filter(
    (match) =>
      (match.team1?.id === teamId || match.team2?.id === teamId) &&
      match.status !== 'completed' &&
      match.status !== 'cancelled'
  );
  const live = own.filter(isLiveMatch).sort(compareMatchOrder);
  if (live.length > 0) return live[0];
  const next = own.filter(isUpcomingMatch).sort(compareMatchOrder);
  return next[0] ?? null;
}

/** The team's last finished match, or null. */
export function teamLastResult(matches: Match[], teamId: string): Match | null {
  const played = matches
    .filter(
      (match) =>
        match.status === 'completed' && (match.team1?.id === teamId || match.team2?.id === teamId)
    )
    .sort(compareMatchOrder);
  return played[played.length - 1] ?? null;
}
