/**
 * Round robin standings (pure logic, no database access).
 *
 * Order (#225):
 *  1. match wins, most first;
 *  2. head-to-head: wins in the matches between the teams still level. When
 *     that splits the group, each part that is still level is compared again
 *     on head-to-head among just those teams;
 *  3. round difference: rounds won minus rounds lost over every map played
 *     (from match_map_results);
 *  4. rounds won;
 *  5. seed (the tournament's team order), so the order is always strict and a
 *     finished round robin always has a champion.
 *
 * Only completed matches count. A draw counts as neither a win nor a loss.
 */

import type { SwissMatchLike } from './swissPairing';

export type RoundRobinMatchLike = SwissMatchLike;

export interface RoundRobinStanding {
  teamId: string;
  seed: number;
  wins: number;
  losses: number;
  roundDiff: number;
  roundsWon: number;
}

export function computeRoundRobinStandings(
  teamIds: string[],
  matches: RoundRobinMatchLike[]
): RoundRobinStanding[] {
  const byId = new Map<string, RoundRobinStanding>();
  teamIds.forEach((teamId, seed) =>
    byId.set(teamId, { teamId, seed, wins: 0, losses: 0, roundDiff: 0, roundsWon: 0 })
  );

  const played = matches.filter(
    (m) =>
      m.status === 'completed' &&
      m.team1Id &&
      m.team2Id &&
      byId.has(m.team1Id) &&
      byId.has(m.team2Id)
  );

  for (const m of played) {
    const t1 = byId.get(m.team1Id!)!;
    const t2 = byId.get(m.team2Id!)!;
    const r1 = m.team1Rounds ?? 0;
    const r2 = m.team2Rounds ?? 0;
    t1.roundsWon += r1;
    t2.roundsWon += r2;
    t1.roundDiff += r1 - r2;
    t2.roundDiff += r2 - r1;
    if (m.winnerId === t1.teamId) {
      t1.wins += 1;
      t2.losses += 1;
    } else if (m.winnerId === t2.teamId) {
      t2.wins += 1;
      t1.losses += 1;
    }
  }

  /** Wins of each team in `group` counting only matches inside the group. */
  const headToHeadWins = (group: RoundRobinStanding[]): Map<string, number> => {
    const ids = new Set(group.map((s) => s.teamId));
    const wins = new Map(group.map((s) => [s.teamId, 0]));
    for (const m of played) {
      if (!ids.has(m.team1Id!) || !ids.has(m.team2Id!)) continue;
      if (m.winnerId && wins.has(m.winnerId)) wins.set(m.winnerId, wins.get(m.winnerId)! + 1);
    }
    return wins;
  };

  /** Rank a group of teams that are level on everything compared so far. */
  const rankLevel = (group: RoundRobinStanding[]): RoundRobinStanding[] => {
    if (group.length <= 1) return group;
    const h2h = headToHeadWins(group);
    const buckets = splitBy(group, (s) => h2h.get(s.teamId) ?? 0);
    if (buckets.length > 1) return buckets.flatMap(rankLevel);
    return [...group].sort(
      (a, b) => b.roundDiff - a.roundDiff || b.roundsWon - a.roundsWon || a.seed - b.seed
    );
  };

  return splitBy([...byId.values()], (s) => s.wins).flatMap(rankLevel);
}

/** Group by a numeric key, highest key first, keeping the input order inside a group. */
function splitBy<T>(items: T[], key: (item: T) => number): T[][] {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k) ?? [];
    list.push(item);
    groups.set(k, list);
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, list]) => list);
}
