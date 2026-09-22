/**
 * How many matches a tournament will play, from the same bracket math the API
 * generators use. Kept pure so the setup summary can show it live.
 *
 * Checked against the generators by creating each shape through the API and
 * counting the bracket rows:
 * - single elimination (api/src/services/standardBracketGenerator.ts,
 *   power-of-two path): N - 1.
 * - double elimination, grand final 'simple' or 'double' (power-of-two path;
 *   'double' is generated like 'simple' for now): winners N - 1, losers N - 2,
 *   one grand final = 2N - 2. N = 2 is the degenerate case of the same
 *   formula: one winners match, an empty losers bracket and a grand final
 *   between the same two teams = 2.
 * - double elimination, grand final 'none' (brackets-manager): 2N - 3.
 * - round robin (brackets-manager, one group): N(N - 1) / 2.
 * - swiss (api/src/services/swissBracketGenerator.ts): ceil(log2 N) rounds of
 *   ceil(N / 2) slots; with an odd count one slot per round is a bye that is
 *   never played, so floor(N / 2) matches per round.
 * - shuffle (api/src/services/shuffleTournamentService.ts): one round per map;
 *   each round splits the registered players into floor(players / teamSize)
 *   teams and pairs them, so floor(teams / 2) matches per round.
 */

export type GrandFinalMode = 'none' | 'simple' | 'double';

export interface MatchCountInput {
  type: string;
  /** Teams in the bracket (non-shuffle). */
  teamCount: number;
  grandFinalMode?: GrandFinalMode;
  /** Shuffle: maps in the sequence, one round each. */
  mapCount?: number;
  /** Shuffle: registered players; unknown before the tournament exists. */
  playerCount?: number;
  /** Shuffle: players per team. */
  teamSize?: number;
}

export interface MatchCountEstimate {
  /** Matches that will be played, or null when it can't be known yet. */
  matches: number | null;
  /** Rounds, or null when it can't be known yet. */
  rounds: number | null;
}

const UNKNOWN: MatchCountEstimate = { matches: null, rounds: null };

const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;

export function estimateMatchCount(input: MatchCountInput): MatchCountEstimate {
  const { type, teamCount: n } = input;

  if (type === 'shuffle') {
    const rounds = input.mapCount ?? 0;
    if (rounds < 1) return UNKNOWN;
    const teamSize = input.teamSize ?? 0;
    if (typeof input.playerCount !== 'number' || teamSize < 1) {
      return { matches: null, rounds };
    }
    const teams = Math.floor(input.playerCount / teamSize);
    return { matches: Math.floor(teams / 2) * rounds, rounds };
  }

  if (!Number.isInteger(n) || n < 2) return UNKNOWN;

  switch (type) {
    case 'single_elimination':
      if (!isPowerOfTwo(n)) return UNKNOWN;
      return { matches: n - 1, rounds: Math.log2(n) };
    case 'double_elimination': {
      if (!isPowerOfTwo(n)) return UNKNOWN;
      const mode = input.grandFinalMode ?? 'simple';
      if (mode === 'none') return { matches: 2 * n - 3, rounds: null };
      return { matches: 2 * n - 2, rounds: null };
    }
    case 'round_robin':
      return { matches: (n * (n - 1)) / 2, rounds: n % 2 === 0 ? n - 1 : n };
    case 'swiss': {
      const rounds = Math.ceil(Math.log2(n));
      return { matches: Math.floor(n / 2) * rounds, rounds };
    }
    default:
      return UNKNOWN;
  }
}
