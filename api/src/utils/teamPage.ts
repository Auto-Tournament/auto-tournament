/**
 * Pure helpers behind the public team page (`/api/team/:teamId/*`).
 *
 * The page showed wrong data in three ways (QA, MAT 2.4.10):
 *  - rank "#6 of 9" counted every team in the database, not the tournament's;
 *  - every player read 1500 because the roster carried no rating;
 *  - history said "Match #2 / #1 / #1", the per-round number, where the
 *    matches page shows chronological numbers and bracket labels.
 */
import { compareQueueOrder, matchBracketOf } from './allocationQueue';

export interface TeamStanding {
  position: number;
  totalTeams: number;
  wins: number;
}

/**
 * Standing of `teamId` among the tournament's teams only. Swiss uses the
 * server standings order (same as the leaderboard); other formats rank by wins,
 * ties keeping the tournament's seed order.
 */
export function computeTeamStanding(
  teamId: string,
  tournamentTeamIds: string[],
  winsByTeam: Map<string, number>,
  swissOrder?: Array<{ teamId: string; wins: number }> | null
): TeamStanding | null {
  const members = new Set(tournamentTeamIds);
  if (!members.has(teamId)) return null;

  const ordered =
    swissOrder && swissOrder.length > 0
      ? swissOrder.filter((entry) => members.has(entry.teamId))
      : tournamentTeamIds
          .map((id, seed) => ({ teamId: id, wins: winsByTeam.get(id) ?? 0, seed }))
          .sort((a, b) => b.wins - a.wins || a.seed - b.seed);

  const index = ordered.findIndex((entry) => entry.teamId === teamId);
  if (index === -1) return null;
  return { position: index + 1, totalTeams: ordered.length, wins: ordered[index].wins };
}

export interface MatchOrderRow {
  id: number;
  slug: string;
  round: number;
  match_number: number;
  bracket?: string | null;
}

/**
 * Chronological 1-based number per match slug, in the order the matches page
 * numbers them (client `getGlobalMatchNumber`, api `compareQueueOrder`).
 */
export function globalMatchNumbers(rows: MatchOrderRow[]): Map<string, number> {
  const ordered = rows
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      round: row.round,
      matchNumber: row.match_number,
      bracket: matchBracketOf(row),
    }))
    .sort(compareQueueOrder);
  return new Map(ordered.map((row, index) => [row.slug, index + 1]));
}
