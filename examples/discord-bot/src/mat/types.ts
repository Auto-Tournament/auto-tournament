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
 * `| string` on purpose: MAT has more statuses than these and adds to them, so
 * pinning the union would make this example fail to compile against a newer
 * MAT rather than simply display a status it had not heard of.
 *
 * `needs_decision` is a series that ran out of maps level (maps, rounds and
 * damage all tied). Its maps are over, but the bracket cannot move on until an
 * admin picks the winner in MAT.
 */
export type MatchStatus =
  | 'pending'
  | 'ready'
  | 'loaded'
  | 'live'
  | 'needs_decision'
  | 'completed'
  | 'cancelled'
  | string;

/** How a status reads in Discord. Anything else is shown as MAT sends it. */
export function statusText(status: MatchStatus): string {
  return status === 'needs_decision' ? 'needs admin decision' : status;
}

/** Statuses after which a match will not change again on its own. */
export function isFinished(status: MatchStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/**
 * `WB`/`LB` (upper/lower bracket) and `GF`/`GF_RESET` (grand final and its
 * reset) in double elimination; `SE` or null elsewhere.
 */
export type MatchBracket = 'WB' | 'LB' | 'GF' | 'GF_RESET' | 'SE' | string;

export interface Match {
  id: number;
  slug: string;
  status: MatchStatus;
  round?: number;
  matchNumber?: number;
  /** Which bracket the match is in. Read it through `matchLabel()`. */
  bracket?: MatchBracket | null;
  /**
   * Only present for matches whose teams are rows in MAT's `teams` table —
   * tournament matches. A manual match has its team names in `config` instead,
   * so read them with `teamName()` rather than from here.
   */
  team1?: TeamRef;
  team2?: TeamRef;
  winner?: TeamRef;
  /**
   * Headline score: maps won once completed, the current map's rounds while
   * in progress. Two meanings in one field, so read the explicit ones below.
   */
  team1Score?: number;
  team2Score?: number;
  /** Maps won in the series. */
  team1SeriesScore?: number;
  team2SeriesScore?: number;
  /**
   * Rounds on the map being played (0 – 0 in warmup between maps); once
   * completed, the last map's rounds. Null when no map has been played.
   */
  team1MapScore?: number | null;
  team2MapScore?: number | null;
  currentMap?: string;
  mapNumber?: number;
  serverName?: string;
  config?: MatchConfig;
}

/** The Auto Tournament CS2 config MAT hands the game server. Only the parts used here. */
export interface MatchConfig {
  team1?: { name?: string };
  team2?: { name?: string };
}

/**
 * "maps (rounds)" for one match, e.g. "1 – 0 (7 – 3)" mid-series, "2 – 1" once
 * finished or waiting on an admin decision.
 *
 * Only for a match from the REST endpoints. Socket.IO pushes are partial, and
 * their `team1Score` can be maps won where REST would give rounds, which is
 * why the scoreboard refetches on a push rather than rendering it.
 */
export function scoreText(match: Match): string {
  const series = `${match.team1SeriesScore ?? 0} – ${match.team2SeriesScore ?? 0}`;
  if (match.status === 'completed' || match.status === 'needs_decision') return series;

  const map1 = match.team1MapScore;
  const map2 = match.team2MapScore;
  return typeof map1 === 'number' && typeof map2 === 'number'
    ? `${series} (${map1} – ${map2})`
    : series;
}

/**
 * Where the match sits, the way MAT's own UI labels it: "UB R2 M1",
 * "LB R1 M3", "Grand Final", or "R3 M2" outside double elimination. Null for
 * manual matches, which have no round.
 */
export function matchLabel(match: Pick<Match, 'slug' | 'bracket' | 'round' | 'matchNumber'>): string | null {
  // MAT itself falls back to the slug for rows stored without a bracket.
  const bracket =
    match.bracket ?? (match.slug === 'gf' ? 'GF' : match.slug.startsWith('lb-') ? 'LB' : null);
  const where = `R${match.round ?? 0} M${match.matchNumber ?? 0}`;

  switch (bracket) {
    case 'WB':
      return `UB ${where}`;
    case 'LB':
      return `LB ${where}`;
    case 'GF':
      return 'Grand Final';
    case 'GF_RESET':
      return 'Grand Final Reset';
    default:
      return match.round && match.round > 0 ? where : null;
  }
}

/**
 * The display name of one side.
 *
 * There are two places a team name can live and which one is populated depends
 * on how the match was made: tournament matches join to the `teams` table and
 * get a `team1` object, manual matches only ever have the name in the Auto Tournament CS2
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

/** `GET /api/tournament`. MAT runs one tournament at a time. */
export interface Tournament {
  id: number;
  name: string;
  type: string;
  status: 'setup' | 'ready' | 'in_progress' | 'completed' | 'cancelled' | string;
  /**
   * The champion once the tournament is completed. Null before that, for a
   * round robin or Swiss whose top spot is shared, and for shuffle
   * tournaments, which rank players rather than teams.
   */
  winner?: TeamRef | null;
}

export interface TournamentResponse {
  success: boolean;
  tournament: Tournament;
}

export interface MatchResponse {
  success: boolean;
  match: Match;
}

/**
 * A player as `GET /api/players/by-discord-id/:discordId` returns them.
 *
 * `id` is the Steam ID; it is what every other player endpoint takes. The
 * Discord ID only comes back from admin-guarded routes (some players are
 * children), which is why this lookup needs a token at all.
 */
export interface Player {
  id: string;
  name: string;
  avatar?: string;
  discordId: string | null;
}

/**
 * An array, and `[]` (still a 200) when nobody matches: a Discord ID is not
 * unique, because a parent may put their own on several children.
 */
export interface PlayersByDiscordIdResponse {
  success: boolean;
  players: Player[];
}

/**
 * `GET /api/players/:playerId/current-match` — the player's live match, or
 * failing that their next pending one. Only the fields this bot reads; the
 * real response also carries veto, connection and per-player stats.
 *
 * `hasMatch` is the discriminant: without a match there is no `match` key at
 * all, just a `message`.
 */
export type PlayerCurrentMatchResponse =
  | {
      success: boolean;
      player: { id: string; name: string; avatar?: string };
      hasMatch: false;
      message?: string;
    }
  | {
      success: boolean;
      player: { id: string; name: string; avatar?: string };
      hasMatch: true;
      tournamentStatus: string;
      match: PlayerCurrentMatch;
    };

export interface PlayerCurrentMatch {
  slug: string;
  round?: number;
  matchNumber?: number;
  status: MatchStatus;
  /** Which side the player is on. `opponent` is the other one. */
  isTeam1: boolean;
  currentMap: string | null;
  /** `null` while a bracket slot is still waiting for its team. */
  team1: TeamRef | null;
  team2: TeamRef | null;
  opponent: TeamRef | null;
}
