/**
 * Game integration interface.
 *
 * A game integration ("game module") owns everything that is specific to one
 * game: how a match config is built, how matches get onto game servers (if the
 * game has servers at all), which events the game emits and which player stats
 * it records. The core owns tournaments, brackets, scheduling and results, and
 * talks to a game only through this interface.
 *
 * CS2 is the only integration today (`integrations/cs2`), and in this step it
 * is a thin wrapper around the existing services: nothing in the core calls it
 * yet. Later PRs move logic behind it one seam at a time (see the TODOs).
 *
 * Two rules keep a future out-of-process (HTTP/webhook) integration possible:
 * - every value that crosses the boundary can be serialised to JSON;
 * - every hook is async and idempotent, keyed by match slug (plus an event id
 *   for events).
 *
 * The `Router` import below is type-only; `routes` and `legacyRoutes` are the
 * in-process-only members, and an HTTP integration would replace them with its
 * own server.
 */

import type { Router } from 'express';

/** Identifier stored in the `game` column: 'cs2' today; later e.g. 'manual-report', 'fake'. */
export type GameId = string;

/** The game every existing row belongs to; also the column default. */
export const DEFAULT_GAME: GameId = 'cs2';

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * What an integration can do. The core and the client use these flags to decide
 * which features to show and which lifecycle steps to run; they never check the
 * game id for that.
 */
export interface IntegrationCapabilities {
  /** Matches run on game servers that must be allocated (cs2: true; manual-report: false). */
  servers: boolean;
  /** Matches have a pre-match map veto / side pick phase (cs2: true). */
  veto: boolean;
  /** The game pushes live events (scores, phases, presence) while a match runs. */
  liveEvents: boolean;
  /** The game records demos that can be listed and downloaded. */
  demos: boolean;
  /** The game reports per-player stats (see `statsSchema`). */
  playerStats: boolean;
}

// ---------------------------------------------------------------------------
// Shared value types
// ---------------------------------------------------------------------------

export type TeamSide = 'team1' | 'team2';

/** A player's account with an external provider, e.g. `{ provider: 'steam', externalId: '7656…' }`. */
export interface LinkedAccountRef {
  provider: 'steam' | 'discord' | string;
  externalId: string;
}

export interface ParticipantRef {
  /** `teams.id` */
  id: string;
  name?: string;
}

/**
 * The neutral view of a tournament an integration gets. `settings` is the
 * integration-owned part: the core stores and forwards it without reading it.
 *
 * TODO(PR 9): for CS2 this is the full `TournamentResponse` until the CS2
 * tournament fields (maps, map_sequence, max_rounds, overtime_*, veto order)
 * are validated through `validateTournamentSettings` and narrowed.
 */
export interface IntegrationTournament {
  id: number;
  /** Format id: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss' | 'shuffle' */
  type: string;
  /** Series format: 'bo1' | 'bo3' | 'bo5' */
  format: string;
  settings: unknown;
}

/** Everything an integration needs to know about one match. */
export interface MatchContext {
  slug: string;
  matchId: number;
  game: GameId;
  /** `null` for standalone matches (no tournament). */
  tournament: IntegrationTournament | null;
  team1: ParticipantRef | null;
  team2: ParticipantRef | null;
  round: number;
  bracket?: string | null;
  /** Parsed `matches.config`: an integration-owned blob (for CS2, the MatchZy config). */
  integrationConfig: unknown;
}

/**
 * Input to `buildMatchConfig`.
 *
 * Tournament matches (`tournament` set, `round >= 1`) are built from the
 * tournament's settings and the participants. Standalone matches
 * (`tournament: null`, or `round === 0`) have no tournament to build from:
 * - with `settings` (the admin's per-match settings, see `SetupSchema.match`)
 *   the integration returns the config to store for a new match;
 * - without, it returns the config to hand the game for the stored match.
 *
 * `matchId` is 0 while the match row does not exist yet (configs for new
 * bracket slots are built before the insert, as before).
 */
export type BuildMatchConfigContext = Omit<MatchContext, 'integrationConfig'> & {
  settings?: unknown;
  /**
   * Standalone creation only: the tournament whose rules a new standalone
   * match falls back to for settings the admin left out (CS2: the round
   * limit). Chosen by the caller; absent means no fallback.
   */
  defaultsFrom?: IntegrationTournament | null;
};

/** Neutral description of a match config, so the core never parses the blob itself. */
export interface MatchDescription {
  seriesLength: number;
  /** Planned maps (or game-specific equivalent), empty when not decided yet. */
  maps: string[];
  /** Players per side the config expects, when it says. */
  playersPerTeam?: number;
  /**
   * The config opts out of the pre-match phase (CS2: a manual match created
   * with the veto disabled). Unset when the config does not say.
   */
  skipPreMatchPhase?: boolean;
  team1: MatchDescriptionTeam;
  team2: MatchDescriptionTeam;
}

export interface MatchDescriptionTeam {
  id?: string;
  /** Empty when the config names no team. */
  name: string;
  tag?: string;
  /** Country code, when the config carries one. */
  flag?: string;
  players: MatchDescriptionPlayer[];
}

export interface MatchDescriptionPlayer {
  account: LinkedAccountRef;
  name: string;
  avatar?: string;
}

export type AllocateResult =
  | { status: 'assigned'; resourceId?: string }
  | { status: 'queued'; reason: string }
  | { status: 'failed'; error: string; retryable: boolean };

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** JSON Schema document. Kept loose on purpose; the core only stores and forwards it. */
export type JSONSchema = Record<string, unknown>;

export interface SetupSchema {
  /** Tournament-level settings (cs2: maps/map pool, map sequence, max rounds, overtime, veto order, team size). */
  tournament: JSONSchema;
  /** Per-match overrides, used for standalone matches. */
  match: JSONSchema;
  /** Instance-wide settings (cs2: the `matchzy_*` app settings). */
  instance: JSONSchema;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface StatsMetric {
  key: string;
  label: string;
  higherIsBetter: boolean;
  /** Whether an ELO template may weight this metric. */
  ratingWeightable: boolean;
}

export interface StatsSchema {
  metrics: StatsMetric[];
}

export interface PlayerStatLine {
  account: LinkedAccountRef;
  name: string;
  team: TeamSide;
  won: boolean;
  metrics: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Normalized events (integration -> core)
// ---------------------------------------------------------------------------

/**
 * What an integration turns its own events into. The core never sees
 * game-specific fields (no MatchZy payloads past the adapter).
 *
 * `eventId` makes ingest idempotent: the core ignores an event it has already
 * applied for that slug.
 *
 * `mapNumber` is the 0-based position of the map in the series, the same
 * index `matches.map_number` and `match_map_results.map_number` store.
 *
 * CS2 produces these in `cs2/events/normalize.ts`. TODO(PR 6b): the core
 * consumes them through `MatchLifecycleApi.ingest`; until then they are only
 * logged at debug and the adapter still drives the old event handler.
 */
export type NormalizedEvent =
  | { type: 'series.started'; slug: string; eventId: string; seriesLength: number }
  | { type: 'map.started'; slug: string; eventId: string; mapNumber: number; mapName?: string }
  | {
      type: 'score.updated';
      slug: string;
      eventId: string;
      mapNumber: number;
      team1: number;
      team2: number;
      phase?: string;
    }
  | {
      type: 'map.result';
      slug: string;
      eventId: string;
      mapNumber: number;
      mapName?: string;
      team1Score: number;
      team2Score: number;
      winner: TeamSide | 'draw';
    }
  | {
      type: 'series.ended';
      slug: string;
      eventId: string;
      team1SeriesScore: number;
      team2SeriesScore: number;
      /** 'none' feeds the exhausted-series / needs-decision path. */
      winner: TeamSide | 'none';
      /** How long the resource (server) stays busy before `release`. */
      releaseAfterSeconds?: number;
    }
  | {
      type: 'player.stats';
      slug: string;
      eventId: string;
      scope: 'map' | 'series';
      mapNumber?: number;
      lines: PlayerStatLine[];
    }
  | { type: 'phase.changed'; slug: string; eventId: string; phase: string }
  | {
      type: 'presence.changed';
      slug: string;
      eventId: string;
      account: LinkedAccountRef;
      team?: TeamSide;
      state: 'connected' | 'disconnected' | 'ready' | 'unready';
    };

export type NormalizedEventType = NormalizedEvent['type'];

// ---------------------------------------------------------------------------
// Core-facing API (core -> used by integrations and admin/report routes)
// ---------------------------------------------------------------------------

/** Result of one game (map) within a series. */
export interface GameResult {
  /** 1-based position in the series. */
  gameNumber: number;
  /** Map or game-specific label, when the game has one. */
  mapName?: string;
  team1Score: number;
  team2Score: number;
  winner: TeamSide | 'draw';
}

export interface SeriesResult {
  games: GameResult[];
  /** Series score (games won). */
  team1Score: number;
  team2Score: number;
  winner: TeamSide | 'none';
}

/** Who produced a result: the game itself, an admin, or a team report. */
export type ResultSource = 'integration' | 'admin' | 'report';

export interface ResultMeta {
  source: ResultSource;
  /** Player / admin id that caused it; null for automatic results. */
  actorId: string | null;
}

export interface ApplySeriesResultOutcome {
  applied: boolean;
  /** Set when `applied` is false, e.g. 'already_completed', 'match_not_found'. */
  reason?: string;
}

/**
 * The game-neutral result path the core offers. Every way a series can end
 * (MatchZy `series_end`, the admin "set winner" action, a manual-report
 * submission) goes through `applySeriesResult`, so bracket progression,
 * ratings and stats run the same way regardless of source.
 *
 * TODO(PR 6b): implemented in `core/matchLifecycle.ts`, when
 * `processSeriesEnd` / `setSeriesWinnerByAdmin` move out of
 * `matchEventHandler`. Until then nothing implements this.
 */
export interface MatchLifecycleApi {
  applySeriesResult(slug: string, result: SeriesResult, meta: ResultMeta): Promise<ApplySeriesResultOutcome>;
  ingest(events: NormalizedEvent[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Client slots (types only; the client registry arrives in PR 12)
// ---------------------------------------------------------------------------

/**
 * Named places in the client UI an integration can fill with its own
 * component. The API only declares which slots an integration fills; the
 * components live in `client/src/integrations/<id>/`.
 */
export type ClientSlotName = 'MatchPanel' | 'SetupStep' | 'StatsPanel';

// ---------------------------------------------------------------------------
// The integration
// ---------------------------------------------------------------------------

/**
 * How an integration's game appears in the player-facing game catalogue
 * ("What do you play?"). `slug` is the IGDB slug, so a search result from IGDB
 * and the built-in entry for an installed module are the same `games` row.
 */
export interface GameCatalogEntry {
  slug: string;
  /** Extra search terms, e.g. 'cs2'. */
  aliases?: string[];
}

export interface GameIntegration {
  id: GameId;
  displayName: string;
  capabilities: IntegrationCapabilities;
  /** Catalogue entry; defaults to a slug of `displayName`. */
  catalog?: GameCatalogEntry;
  /**
   * The account a player needs for this game, by sign-in provider id (CS2:
   * 'steam', the Steam ID matches identify players by). Drives the "Game
   * accounts" list on /me/connections. Omit when the game needs none.
   */
  accountProvider?: LinkedAccountRef['provider'];

  /**
   * The stats this game records. A function so it can depend on tournament
   * settings (e.g. a mode that records fewer metrics); `null` for standalone
   * matches.
   */
  statsSchema(tournament: IntegrationTournament | null): StatsSchema;

  /** TODO(PR 9 / PR 11): CS2 declares its tournament and `matchzy_*` settings here. */
  setupSchema?: SetupSchema;
  /** TODO(PR 9): CS2 validates maps, map sequence, rounds and veto order here. */
  validateTournamentSettings?(settings: unknown): ValidationResult;

  // --- setup ---------------------------------------------------------------

  /** Build the integration-owned `matches.config` for a match. */
  buildMatchConfig(ctx: BuildMatchConfigContext): Promise<unknown>;
  /** Neutral view of a stored config: roster, maps, series length. */
  describeMatch(config: unknown): MatchDescription;

  // --- lifecycle -----------------------------------------------------------

  /**
   * Called once a match has both participants, a config and status `ready`.
   * CS2: auto-allocate a server. Must be safe to call twice.
   */
  onMatchReady?(ctx: MatchContext): Promise<void>;
  /** TODO(PR 8): CS2 returns false until the veto is complete. */
  isReadyToAllocate?(ctx: MatchContext): Promise<boolean>;
  /** Idle resources that can take a match; `null` means unlimited (no servers). */
  capacity(): Promise<number | null>;
  /** Select a resource and load the match on it. */
  allocate(ctx: MatchContext, opts: { baseUrl: string }): Promise<AllocateResult>;
  restart(ctx: MatchContext, opts: { baseUrl: string }): Promise<void>;
  /** TODO(PR 7a): force-cancel's server side (end the match on the server). */
  cancel?(ctx: MatchContext, reason: string): Promise<void>;
  /** TODO(PR 6b): server turnover after series end. */
  release?(ctx: MatchContext): Promise<void>;

  // --- plumbing ------------------------------------------------------------

  /** Module routes, mounted at `/api/game/<id>`. */
  routes?: Router;
  /**
   * Built-in routes that must keep their existing URL (MatchZy and existing
   * API clients are configured with them), mounted at `prefix`, in the order
   * returned. `routes/routeTable.ts` reads them from the registry, so the
   * server and the API reference generator both see them.
   *
   * A function so that loading the registry does not load the routers (and
   * everything they import) until something actually mounts them.
   */
  legacyRoutes?(): LegacyRouteMount[];
  /** Client slots this integration fills (see `ClientSlotName`). */
  clientSlots?: ClientSlotName[];
  /**
   * Background jobs (monitors, fleet checks) and one-off startup work. Called
   * once the database is ready and the HTTP server is listening, alongside the
   * core startup tasks; must not reject (log and carry on instead).
   */
  start?(): Promise<void>;
  /** Stop what `start` started. Called on SIGINT / SIGTERM. */
  stop?(): Promise<void>;
  /**
   * Fields this integration adds to `GET /api/health/fleet`, merged after
   * `status` and `timestamp` (CS2: `cs2Fleet` and `servers`).
   */
  healthContributions?(): Promise<Record<string, unknown>>;

  // --- live state ----------------------------------------------------------

  /**
   * Refresh who is connected to a match, when the game can be asked (CS2: the
   * plugin's match report over RCON, at most every few seconds unless
   * `force`). Never rejects.
   */
  refreshPresence?(slug: string, opts?: { force?: boolean }): Promise<void>;
  /**
   * Pull the game's own view of a running match (score, phase, connections)
   * and apply it, e.g. after an API restart. `resourceId` asks the resource
   * the match runs on; `report` applies a report the caller already has (test
   * helpers). Returns a short summary for logs, or null when there was
   * nothing to apply.
   */
  syncMatchState?(
    slug: string,
    source: { resourceId: string } | { report: unknown }
  ): Promise<Record<string, unknown> | null>;
}

/** A router mounted at a fixed prefix, plus its heading in the API reference. */
export interface LegacyRouteMount {
  /** Path prefix the router is mounted under, e.g. `/api/servers`. */
  prefix: string;
  router: Router;
  /** Group heading in the generated reference. */
  title: string;
  /** One line on what this group is for. */
  description: string;
}
