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
