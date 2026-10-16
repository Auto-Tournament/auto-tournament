import type { Match, Tournament } from '../types';
import { teamPlacement, type Placement } from '../utils/placement';

/**
 * Where `teamId` finished in `tournament` (an elimination bracket), from the
 * bracket's matches; null while the team is still in, or for formats without
 * an elimination order (round robin, swiss, shuffle).
 */
export function placementFor(
  tournament: Pick<Tournament, 'type' | 'teamIds' | 'winner' | 'settings'> | null,
  matches: Match[],
  teamId: string | null | undefined
): Placement | null {
  if (!tournament || !teamId) return null;
  if (tournament.type === 'groups') return groupsPlacement(tournament, matches, teamId);
  const double = tournament.type === 'double_elimination';
  if (!double && tournament.type !== 'single_elimination') return null;
  return teamPlacement(
    matches.map((m) => ({
      slug: m.slug,
      round: m.round,
      bracket: m.bracket ?? null,
      status: m.status,
      team1Id: m.team1?.id ?? null,
      team2Id: m.team2?.id ?? null,
      winnerId: m.winner?.id ?? null,
    })),
    teamId,
    {
      teamCount: tournament.teamIds.length,
      double,
      championId: tournament.winner?.id ?? null,
      thirdPlaceMatch: tournament.settings?.thirdPlaceMatch === true,
    }
  );
}

/**
 * Groups, then playoffs: a team out in its group shares the places after the
 * playoffs'; a team in the playoffs places as in an elimination bracket of them.
 */
function groupsPlacement(
  tournament: Pick<Tournament, 'type' | 'teamIds' | 'winner' | 'settings'>,
  matches: Match[],
  teamId: string
): Placement | null {
  const playoffs = matches.filter((m) => /(^|-)po-/.test(m.slug ?? ''));
  if (playoffs.length === 0) return null;
  // Not drawn yet: nobody knows who is out.
  if (!playoffs.some((m) => m.team1 || m.team2)) return null;
  const settings = (tournament.settings ?? {}) as { playoffType?: string };
  const inPlayoffs = playoffs.some((m) => m.team1?.id === teamId || m.team2?.id === teamId);
  const size =
    playoffs.filter(
      (m) => m.round === Math.min(...playoffs.map((x) => x.round)) && !/lb-/.test(m.slug ?? '')
    ).length * 2;
  if (!inPlayoffs) {
    const played = matches.some((m) => m.team1?.id === teamId || m.team2?.id === teamId);
    return played ? { place: size + 1, placeTo: tournament.teamIds.length, champion: false } : null;
  }
  const offset = Math.min(...playoffs.map((m) => m.round)) - 1;
  const double = settings.playoffType === 'double_elimination';
  return teamPlacement(
    playoffs.map((m) => ({
      slug: m.slug,
      round: m.round - offset,
      bracket: m.bracket === 'SE' ? null : (m.bracket ?? null),
      status: m.status,
      team1Id: m.team1?.id ?? null,
      team2Id: m.team2?.id ?? null,
      winnerId: m.winner?.id ?? null,
    })),
    teamId,
    { teamCount: size, double, championId: tournament.winner?.id ?? null, thirdPlaceMatch: false }
  );
}
