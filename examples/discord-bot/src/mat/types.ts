/**
 * The bits of MAT's responses this bot reads.
 *
 * Hand-written on purpose: these are the two or three shapes the example
 * actually touches, and a reader can see them at a glance.
 *
 * When you start calling more of the API, stop hand-writing these and generate
 * the lot from the spec instead:
 *
 *     yarn gen:types      # ../../docs/openapi.json -> src/mat/openapi.d.ts
 *
 * then pull operations out of the generated `paths` type. MAT's spec is built
 * by walking its own routers, so it covers every endpoint and always says what
 * each one requires. Note that response *bodies* are only described where
 * someone wrote them by hand — see docs/API.md in the MAT repo.
 */

export interface TeamRef {
  id: string;
  name: string;
  tag?: string | null;
}

/**
 * `| string` on purpose: MAT has more statuses than the common four
 * (`ready` and `warmup` among them) and adds to them, so pinning the union
 * would make this example fail to compile against a newer MAT rather than
 * simply display a status it had not heard of.
 */
export type MatchStatus = 'pending' | 'ready' | 'loaded' | 'live' | 'completed' | string;

export interface Match {
  id: number;
  slug: string;
  status: MatchStatus;
  round?: number;
  matchNumber?: number;
  /**
   * Only present for matches whose teams are rows in MAT's `teams` table —
   * tournament matches. A manual match has its team names in `config` instead,
   * so read them with `teamName()` rather than from here.
   */
  team1?: TeamRef;
  team2?: TeamRef;
  winner?: TeamRef;
  team1Score?: number;
  team2Score?: number;
  currentMap?: string;
  mapNumber?: number;
  serverName?: string;
  config?: MatchConfig;
}

/** The MatchZy config MAT hands the game server. Only the parts used here. */
export interface MatchConfig {
  team1?: { name?: string };
  team2?: { name?: string };
}

/**
 * The display name of one side.
 *
 * There are two places a team name can live and which one is populated depends
 * on how the match was made: tournament matches join to the `teams` table and
 * get a `team1` object, manual matches only ever have the name in the MatchZy
 * config. Reading just the first gives "TBD" for every manual match.
 */
export function teamName(match: Match, side: 'team1' | 'team2'): string {
  return match[side]?.name ?? match.config?.[side]?.name ?? 'TBD';
}

export interface MatchListResponse {
  success: boolean;
  count: number;
  tournamentStatus: string;
  matches: Match[];
}

export interface MatchResponse {
  success: boolean;
  match: Match;
}
