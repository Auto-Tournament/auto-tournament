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
