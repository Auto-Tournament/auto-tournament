/**
 * Byes for elimination brackets whose team count is not a power of two.
 *
 * The deterministic generators (standardBracketGenerator.ts) only build
 * brackets for 2^k teams. For any other count the bracket is built for the
 * next power of two with empty seats (`padWithByes`), and `resolveByes` then
 * takes every match that can never be played out of it:
 *
 * - a slot is *dead* when no team can ever reach it: an empty seat, the
 *   winner of a match with two dead slots, or the loser of a match with a
 *   dead slot (a team that gets a bye has nobody to lose to);
 * - a match with one dead slot is a bye: its live team goes straight to where
 *   the winner would have gone; a match with two is void. Both are dropped.
 *
 * What is left is a normal bracket whose wiring points past the byes: a team
 * with a bye starts in round 2 (or later), already seated when both of that
 * match's teams are known at generation.
 */

export type Outcome = 'winner' | 'loser';

export interface ByeMatch {
  slug: string;
  round: number;
  team1Id: string | null;
  team2Id: string | null;
  team1FromMatchSlug?: string | null;
  team1FromOutcome?: Outcome | null;
  team2FromMatchSlug?: string | null;
  team2FromOutcome?: Outcome | null;
}

export const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

export const nextPowerOfTwo = (n: number): number => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

/**
 * The seats of a 2^k bracket for `teamIds` (in seed order), paired as the
 * generators pair them (seat 2m against 2m+1). Each bye pairs a team with an
 * empty seat, and the byes are spread evenly over the bracket so they don't
 * all land in one half. The top seeds get them.
 */
export function padWithByes(teamIds: readonly string[]): Array<string | null> {
  const size = nextPowerOfTwo(Math.max(2, teamIds.length));
  const byes = size - teamIds.length;
  const pairs = size / 2;
  const byePairs = new Set<number>();
  for (let i = 0; i < byes; i++) byePairs.add(Math.floor((i * pairs) / byes));
  const seats: Array<string | null> = [];
  let next = 0;
  for (let p = 0; p < pairs; p++) {
    seats.push(teamIds[next++] ?? null);
    seats.push(byePairs.has(p) ? null : (teamIds[next++] ?? null));
  }
  return seats;
}

type Side = 1 | 2;

/** The bracket without its bye and void matches, rewired past them. */
export function resolveByes<M extends ByeMatch>(matches: readonly M[]): M[] {
  const bySlug = new Map(matches.map((m) => [m.slug, m]));
  const deadMemo = new Map<string, boolean>();

  const from = (m: ByeMatch, side: Side) =>
    side === 1
      ? { slug: m.team1FromMatchSlug ?? null, outcome: m.team1FromOutcome ?? null, team: m.team1Id }
      : {
          slug: m.team2FromMatchSlug ?? null,
          outcome: m.team2FromOutcome ?? null,
          team: m.team2Id,
        };

  const dead = (m: ByeMatch, side: Side): boolean => {
    const key = `${m.slug}:${side}`;
    const known = deadMemo.get(key);
    if (known !== undefined) return known;
    const f = from(m, side);
    let result: boolean;
    if (!f.slug) {
      result = !f.team;
    } else {
      const src = bySlug.get(f.slug);
      if (!src) result = true;
      else if (f.outcome === 'loser') result = dead(src, 1) || dead(src, 2);
      else result = dead(src, 1) && dead(src, 2);
    }
    deadMemo.set(key, result);
    return result;
  };

  const dropped = (m: ByeMatch) => dead(m, 1) || dead(m, 2);

  /** Where a bye match's only team comes from: a seated team or another match's result. */
  const live = (
    m: ByeMatch
  ): { team: string | null; slug: string | null; outcome: Outcome | null } => {
    const side: Side = dead(m, 1) ? 2 : 1;
    const f = from(m, side);
    if (f.slug && f.outcome === 'winner') {
      const src = bySlug.get(f.slug)!;
      if (dropped(src)) return live(src);
    }
    return { team: f.slug ? null : f.team, slug: f.slug, outcome: f.outcome };
  };

  const out: M[] = [];
  for (const m of matches) {
    if (dropped(m)) continue;
    const next = { ...m };
    for (const side of [1, 2] as const) {
      const f = from(m, side);
      if (!f.slug) continue;
      const src = bySlug.get(f.slug)!;
      if (!dropped(src)) continue;
      // Only a bye's winner can feed a kept match (its loser and a void match are dead slots).
      const l = live(src);
      if (side === 1) {
        next.team1Id = l.team;
        next.team1FromMatchSlug = l.slug;
        next.team1FromOutcome = l.outcome;
      } else {
        next.team2Id = l.team;
        next.team2FromMatchSlug = l.slug;
        next.team2FromOutcome = l.outcome;
      }
    }
    out.push(next);
  }
  return out;
}
