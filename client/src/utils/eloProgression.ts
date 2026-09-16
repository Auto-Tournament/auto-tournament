/**
 * Skill Rating progression shown on the player page (chart + history table).
 *
 * Everything is anchored on the player's stored `startingElo`, the same value
 * the page shows as "Starting ELO". The first history row's `eloBefore` is not
 * a baseline: before tournament resets rolled ratings back, ratings carried
 * over from reset runs whose history was deleted, so Alpha 1 (seeded 1500)
 * showed a 1743 baseline and a chart that looked like a drop next to a +125
 * total change (QA 2.4.11).
 */

export interface EloHistoryPoint {
  eloBefore: number;
  baseEloAfter: number | null;
  createdAt: number;
}

export type EloPointRole = 'start' | 'before' | 'base_after' | 'current';

export interface EloProgression {
  points: Array<{ elo: number; role: EloPointRole }>;
  minElo: number;
  maxElo: number;
  startingElo: number;
  totalChange: number;
}

/** Rating shown on the history table's baseline row. */
export function ratingHistoryBaseline(startingElo: number): number {
  return startingElo;
}

export function buildEloProgression(
  history: EloHistoryPoint[],
  currentElo: number,
  startingElo: number
): EloProgression {
  const sorted = [...history].sort((a, b) => a.createdAt - b.createdAt);
  const points: EloProgression['points'] = [{ elo: startingElo, role: 'start' }];

  sorted.forEach((entry, index) => {
    // The first match normally starts at the seed; don't plot the same value twice.
    if (!(index === 0 && entry.eloBefore === startingElo)) {
      points.push({ elo: entry.eloBefore, role: 'before' });
    }
    if (entry.baseEloAfter !== null && entry.baseEloAfter !== undefined) {
      points.push({ elo: entry.baseEloAfter, role: 'base_after' });
    }
  });
  points.push({ elo: currentElo, role: 'current' });

  const elos = points.map((p) => p.elo);
  return {
    points,
    minElo: Math.min(...elos),
    maxElo: Math.max(...elos),
    startingElo,
    totalChange: currentElo - startingElo,
  };
}
