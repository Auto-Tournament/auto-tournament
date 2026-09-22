/**
 * Swiss standings and round pairing (pure logic, no database access).
 *
 * Standings: wins desc, losses asc, Buchholz (sum of opponents' wins) desc,
 * round differential desc, then seed (the tournament's team order).
 *
 * Pairing for the next round:
 *  1. Odd team count: the lowest-ranked team that has not had a bye gets one
 *     (a bye counts as a win; each team gets at most one while possible).
 *  2. Teams are grouped by record (wins-losses). A group with an odd number of
 *     teams floats its lowest-ranked team down into the next group.
 *  3. Inside a group the top team meets the bottom team (Major-style), searched
 *     with backtracking so nobody meets an opponent they already played. When
 *     no rematch-free pairing exists inside the groups, the fewest possible
 *     pairs cross record groups (nearest groups first). Only when no
 *     rematch-free pairing exists at all are rematches allowed.
 */

export interface SwissMatchLike {
  team1Id: string | null;
  team2Id: string | null;
  winnerId: string | null;
  status: string;
  /** Rounds won by team1/team2 over all maps, for the differential tiebreak. */
  team1Rounds?: number;
  team2Rounds?: number;
}

export interface SwissStanding {
  teamId: string;
  seed: number;
  wins: number;
  losses: number;
  buchholz: number;
  roundDiff: number;
  byes: number;
  opponents: string[];
}

export interface SwissPairingResult {
  pairs: Array<[string, string]>;
  byeTeamId: string | null;
  /** True when no rematch-free pairing existed and a rematch was allowed. */
  rematchesAllowed: boolean;
}

export function computeSwissStandings(
  teamIds: string[],
  matches: SwissMatchLike[]
): SwissStanding[] {
  const byId = new Map<string, SwissStanding>();
  teamIds.forEach((teamId, seed) =>
    byId.set(teamId, {
      teamId,
      seed,
      wins: 0,
      losses: 0,
      buchholz: 0,
      roundDiff: 0,
      byes: 0,
      opponents: [],
    })
  );

  for (const m of matches) {
    if (m.status !== 'completed') continue;
    const t1 = m.team1Id ? byId.get(m.team1Id) : undefined;
    const t2 = m.team2Id ? byId.get(m.team2Id) : undefined;

    // Bye: one team, completed, won by that team.
    if ((t1 && !m.team2Id) || (t2 && !m.team1Id)) {
      const solo = (t1 ?? t2)!;
      if (m.winnerId === solo.teamId) {
        solo.wins += 1;
        solo.byes += 1;
      }
      continue;
    }
    if (!t1 || !t2) continue;

    t1.opponents.push(t2.teamId);
    t2.opponents.push(t1.teamId);
    const r1 = m.team1Rounds ?? 0;
    const r2 = m.team2Rounds ?? 0;
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

  for (const s of byId.values()) {
    s.buchholz = s.opponents.reduce((sum, id) => sum + (byId.get(id)?.wins ?? 0), 0);
  }

  return [...byId.values()].sort(compareStandings);
}

function compareStandings(a: SwissStanding, b: SwissStanding): number {
  return (
    b.wins - a.wins ||
    a.losses - b.losses ||
    b.buchholz - a.buchholz ||
    b.roundDiff - a.roundDiff ||
    a.seed - b.seed
  );
}

/** Search budget per attempt, and for the whole rematch-free phase. */
const MAX_SEARCH_STEPS = 20_000;
const MAX_TOTAL_STEPS = 400_000;
/** Bye candidates tried, lowest-ranked first. */
const MAX_BYE_CANDIDATES = 4;

export function pairSwissRound(standings: SwissStanding[]): SwissPairingResult {
  // Pairing order within a record group follows seeding, not tiebreaks, so a
  // group's top seed meets its bottom seed.
  const ranked = [...standings].sort(
    (a, b) => b.wins - a.wins || a.losses - b.losses || a.seed - b.seed
  );

  const byeCandidates: Array<string | null> = [];
  if (ranked.length % 2 === 1) {
    const fromBottom = [...ranked].reverse();
    for (const s of fromBottom) {
      if (s.byes === 0 && byeCandidates.length < MAX_BYE_CANDIDATES) byeCandidates.push(s.teamId);
    }
    // Everybody already had a bye: fall back to the lowest-ranked team.
    if (byeCandidates.length === 0) byeCandidates.push(fromBottom[0].teamId);
  } else {
    byeCandidates.push(null);
  }

  // Loosen step by step: first no rematches and as few pairs across record
  // groups as possible, and only then rematches.
  const maxCrossPairs = Math.floor(ranked.length / 2);
  const budget = { steps: MAX_TOTAL_STEPS };
  for (const allowRematch of [false, true]) {
    for (let crossPairs = 0; crossPairs <= maxCrossPairs; crossPairs++) {
      for (const byeTeamId of byeCandidates) {
        if (!allowRematch && budget.steps <= 0) break;
        const players = ranked.filter((s) => s.teamId !== byeTeamId);
        const pairs = pairPlayers(players, allowRematch, crossPairs, budget);
        if (pairs) return { pairs, byeTeamId, rematchesAllowed: allowRematch };
      }
    }
  }

  // Unreachable with allowRematch=true (any even list pairs), kept for safety.
  const players = ranked.filter((s) => s.teamId !== byeCandidates[0]);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < players.length; i += 2) {
    pairs.push([players[i].teamId, players[i + 1].teamId]);
  }
  return { pairs, byeTeamId: byeCandidates[0], rematchesAllowed: true };
}

function pairPlayers(
  players: SwissStanding[],
  allowRematch: boolean,
  maxCrossPairs: number,
  budget: { steps: number }
): Array<[string, string]> | null {
  // Group by record, then float the lowest-ranked team of each odd group down.
  const groups: SwissStanding[][] = [];
  for (const s of players) {
    const last = groups[groups.length - 1];
    if (last && last[0].wins === s.wins && last[0].losses === s.losses) last.push(s);
    else groups.push([s]);
  }
  for (let g = 0; g < groups.length - 1; g++) {
    if (groups[g].length % 2 === 1) {
      const floater = groups[g].pop()!;
      groups[g + 1].unshift(floater);
    }
  }

  const order: Array<{ s: SwissStanding; group: number }> = [];
  groups.forEach((members, group) => members.forEach((s) => order.push({ s, group })));

  const played = new Map(players.map((s) => [s.teamId, new Set(s.opponents)]));
  const used = new Array<boolean>(order.length).fill(false);
  const pairs: Array<[string, string]> = [];
  let steps = 0;
  let crossPairs = 0;

  const search = (): boolean => {
    budget.steps--;
    if (++steps > MAX_SEARCH_STEPS) return false;
    const i = used.indexOf(false);
    if (i === -1) return true;
    used[i] = true;
    const a = order[i];

    const candidates: number[] = [];
    for (let j = i + 1; j < order.length; j++) if (!used[j]) candidates.push(j);
    // Same group first, top meets bottom; then the nearest lower groups, best
    // ranked first.
    candidates.sort((x, y) => {
      const gx = order[x].group - a.group;
      const gy = order[y].group - a.group;
      if (gx !== gy) return gx - gy;
      return gx === 0 ? y - x : x - y;
    });

    for (const j of candidates) {
      const b = order[j];
      if (!allowRematch && played.get(a.s.teamId)?.has(b.s.teamId)) continue;
      const cross = b.group !== a.group ? 1 : 0;
      if (crossPairs + cross > maxCrossPairs) continue;
      used[j] = true;
      crossPairs += cross;
      pairs.push([a.s.teamId, b.s.teamId]);
      if (search()) return true;
      pairs.pop();
      crossPairs -= cross;
      used[j] = false;
    }
    used[i] = false;
    return false;
  };

  return search() ? pairs : null;
}
