/**
 * Deciding a series that has run out of maps without a series winner.
 *
 * Seen in QA (MAT 2.4.8, 8-team double elimination, Bo3 grand final): map 0
 * was recorded as a draw, maps 1 and 2 went one each, and the plugin crashed
 * before sending series_end. The series sat at 1-1 on a fourth map that does
 * not exist, the grand final stayed live and the tournament had no champion.
 *
 * Once every map in the maplist has a result, MAT decides the series itself:
 * maps won, then total rounds won across all maps, then team damage on map 0
 * when the live stats still hold it. If all of that is level, an admin has to
 * pick the winner.
 */

export interface ExhaustedSeriesMap {
  mapNumber: number;
  team1Score: number;
  team2Score: number;
  winnerTeam: 'team1' | 'team2' | 'none' | null;
}

export type ExhaustedSeriesDecision =
  | {
      winner: 'team1' | 'team2';
      decidedBy: 'maps' | 'rounds' | 'map0_damage';
      team1Maps: number;
      team2Maps: number;
      team1Rounds: number;
      team2Rounds: number;
    }
  | {
      winner: null;
      decidedBy: 'admin';
      team1Maps: number;
      team2Maps: number;
      team1Rounds: number;
      team2Rounds: number;
    };

function mapWinner(map: ExhaustedSeriesMap): 'team1' | 'team2' | null {
  if (map.winnerTeam === 'team1' || map.winnerTeam === 'team2') return map.winnerTeam;
  return null;
}

/** Every map of a `numMaps` series has a result. */
export function isSeriesOutOfMaps(results: ExhaustedSeriesMap[], numMaps: number): boolean {
  if (!Number.isFinite(numMaps) || numMaps < 1) return false;
  const played = new Set(
    results.filter((r) => r.mapNumber >= 0 && r.mapNumber < numMaps).map((r) => r.mapNumber)
  );
  return played.size >= numMaps;
}

export function decideExhaustedSeries(
  results: ExhaustedSeriesMap[],
  map0Damage?: { team1: number; team2: number } | null
): ExhaustedSeriesDecision {
  let team1Maps = 0;
  let team2Maps = 0;
  let team1Rounds = 0;
  let team2Rounds = 0;
  for (const map of results) {
    const winner = mapWinner(map);
    if (winner === 'team1') team1Maps += 1;
    if (winner === 'team2') team2Maps += 1;
    team1Rounds += Number(map.team1Score) || 0;
    team2Rounds += Number(map.team2Score) || 0;
  }
  const totals = { team1Maps, team2Maps, team1Rounds, team2Rounds };

  if (team1Maps !== team2Maps) {
    return { winner: team1Maps > team2Maps ? 'team1' : 'team2', decidedBy: 'maps', ...totals };
  }
  if (team1Rounds !== team2Rounds) {
    return {
      winner: team1Rounds > team2Rounds ? 'team1' : 'team2',
      decidedBy: 'rounds',
      ...totals,
    };
  }
  if (map0Damage && map0Damage.team1 !== map0Damage.team2) {
    return {
      winner: map0Damage.team1 > map0Damage.team2 ? 'team1' : 'team2',
      decidedBy: 'map0_damage',
      ...totals,
    };
  }
  return { winner: null, decidedBy: 'admin', ...totals };
}
