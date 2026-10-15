/**
 * Where a team finished in an elimination bracket: "Your team placed #3".
 *
 * A team is out when it lost its last match and has nothing left to play
 * (in double elimination, only a loss in the lower bracket or the grand final
 * puts a team out). Teams that go out in the same round share the place: the
 * best place a round's losers can have is one more than the number of teams
 * still in after it. With byes the rounds have fewer matches, so the count
 * goes by the matches each round really has.
 *
 * Pure, so it is tested without a page (tests/api/placement-units.spec.ts).
 */

export interface PlacementMatch {
  slug: string;
  round: number;
  /** 'WB' | 'LB' | 'GF' | 'GF_RESET' in double elimination; empty in single. */
  bracket?: string | null;
  status: string;
  team1Id?: string | null;
  team2Id?: string | null;
  winnerId?: string | null;
}

export interface Placement {
  /** The best place the team can have (shared with the round's other losers). */
  place: number;
  /** The worst place in that shared range; equal to `place` when it is not shared. */
  placeTo: number;
  /** Won the tournament. */
  champion: boolean;
}

const has = (m: PlacementMatch, teamId: string) => m.team1Id === teamId || m.team2Id === teamId;
const done = (m: PlacementMatch) => m.status === 'completed' && !!m.winnerId;
const open = (m: PlacementMatch) => m.status !== 'completed' && m.status !== 'cancelled';

/** The elimination step of a match (higher = later), or null when its loser stays in. */
function eliminationStep(m: PlacementMatch, double: boolean): number | null {
  if (!double) return m.round;
  const b = (m.bracket ?? '').toUpperCase();
  if (b === 'LB') return m.round;
  if (b === 'GF' || b === 'GF_RESET') return 1000 + (b === 'GF_RESET' ? 1 : 0);
  return null;
}

/**
 * The team's placement, or null while it is still in (or never played).
 * `teamCount`: the teams in the bracket. `championId`: the winner, once known.
 */
export function teamPlacement(
  matches: PlacementMatch[],
  teamId: string,
  opts: {
    teamCount: number;
    double: boolean;
    championId?: string | null;
    thirdPlaceMatch?: boolean;
  }
): Placement | null {
  const { teamCount, double, championId } = opts;
  if (championId && championId === teamId) return { place: 1, placeTo: 1, champion: true };
  const own = matches.filter((m) => has(m, teamId));
  if (own.length === 0 || own.some(open)) return null;
  const played = own.filter(done).sort((a, b) => {
    const sa = eliminationStep(a, double) ?? a.round;
    const sb = eliminationStep(b, double) ?? b.round;
    return sa - sb;
  });
  const last = played[played.length - 1];
  if (!last) return null;

  // Single elimination with a match for third place: its two teams are 3rd and 4th.
  if (!double && opts.thirdPlaceMatch) {
    const finalRound = Math.max(...matches.map((m) => m.round));
    const finalRoundMatches = matches.filter((m) => m.round === finalRound);
    if (finalRoundMatches.length === 2 && last.round === finalRound) {
      // The final's teams won their semi-final; the third-place match's teams lost theirs.
      const isFinal = played.some((m) => m.round === finalRound - 1 && m.winnerId === teamId);
      if (isFinal) {
        return last.winnerId === teamId ? null : { place: 2, placeTo: 2, champion: false };
      }
      return last.winnerId === teamId
        ? { place: 3, placeTo: 3, champion: false }
        : { place: 4, placeTo: 4, champion: false };
    }
  }

  if (last.winnerId === teamId) return null; // won its last match: still in, or the champion
  const step = eliminationStep(last, double);
  if (step === null) return null; // a winners-bracket loss: down to the lower bracket

  // Matches whose loser goes out, by step; each puts one team out.
  const outAt = new Map<number, number>();
  for (const m of matches) {
    if (m.status === 'cancelled') continue;
    const s = eliminationStep(m, double);
    if (s === null) continue;
    outAt.set(s, (outAt.get(s) ?? 0) + 1);
  }
  // A grand final reset only happens when the first grand final was lost by the
  // lower bracket's team: either way one team goes out over the two.
  if (double && outAt.has(1001)) {
    outAt.set(1000, 1);
    outAt.delete(1001);
  }
  let outBefore = 0;
  for (const [s, n] of outAt) if (s < (step === 1001 ? 1000 : step)) outBefore += n;
  const outHere = outAt.get(step === 1001 ? 1000 : step) ?? 1;
  const placeTo = teamCount - outBefore;
  const place = placeTo - outHere + 1;
  return { place: Math.max(1, place), placeTo: Math.max(1, placeTo), champion: false };
}
