/**
 * Game integration interface.
 *
 * A game integration ("game module") owns everything that is specific to one
 * game: how a match config is built, how matches get onto game servers (if the
 * game has servers at all), which events the game emits and which player stats
 * it records. The core owns tournaments, brackets, scheduling and results, and
 * talks to a game only through this interface.
 *
 * CS2 is the only production integration (`integrations/cs2`); test runs also
 * register a fake one (`integrations/fake`) that proves the core runs a
 * tournament without CS2. The core reaches them only through the registry
 * (eslint-rules/integration-boundaries.mjs enforces it). Some CS2 features still live in core files (the stats columns the
 * leaderboard and profile queries read); later PRs move them
 * behind this interface one seam at a time (see the TODOs).
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
import type { DbMatchRow } from '../types/database.types';

/**
 * Identifier stored in the `game` column: 'cs2', plus 'fake' in test runs
 * (integrations/fake); later e.g. 'manual-report'.
 */
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
 * For CS2 this is still the full `TournamentResponse`. The CS2 tournament
 * fields (maps, map_sequence, max_rounds, overtime_*, veto order) are
 * validated through `validateTournamentSettings`; narrowing `settings` to
 * them waits for the columns to fold into `tournament.integration_settings`.
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
  /** The resource the match is assigned to (CS2: `matches.server_id`), when it has one. */
  resourceId?: string | null;
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
  /**
   * A single game (map) can end level, so a series can end drawn (CS2: overtime
   * disabled). Unset when games always produce a winner.
   */
  gamesCanDraw?: boolean;
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

/**
 * Outcome of putting a match on a resource. `queued` means nothing is wrong,
 * the match just has to wait (no free resource yet). A `failed` attempt names
 * the resource it tried when there was one.
 */
export type AllocateResult =
  | { status: 'assigned'; resourceId?: string }
  | { status: 'queued'; reason: string }
  | { status: 'failed'; error: string; retryable: boolean; resourceId?: string };

/**
 * What a capacity or pool question is about. Resources may be shared across
 * tournaments (CS2: one server fleet), but the question is always asked for a
 * tournament (null for a standalone match) and, when there is one, a match.
 */
export interface CapacityScope {
  tournamentId: number | null;
  slug?: string;
}

/** Outcome of an admin action on a match's resource: load it, restart it, move it. */
export type ResourceActionResult =
  | {
      ok: true;
      /** One line for the admin. */
      message: string;
      /** The resource the match is on afterwards. */
      resourceId?: string;
      /** Integration-specific fields the route passes through (CS2: RCON replies). */
      details?: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
      /** The action is not possible right now (no free resource), rather than broken. */
      conflict?: boolean;
      details?: Record<string, unknown>;
    };

/**
 * Snapshot of an integration's resources for the allocation status views
 * (start dialog, server availability).
 */
export interface ResourcePoolStatus {
  /** Resources that can take a match right now. */
  availableCount: number;
  /** How long a freed resource rests before it is handed out again. */
  gracePeriodSeconds: number;
  /** When every resource is resting: seconds until the first one is free. */
  nextAllocationInSeconds: number | null;
  /** One row per resource; fields beyond `id` and `online` are integration-specific. */
  resources: Array<{ id: string; online: boolean } & Record<string, unknown>>;
  offlineCount: number;
  busyCount: number;
  graceWindowCount: number;
}

/**
 * Why the core ends a match on its resource. `force-cancel` is the admin
 * action on one match; the others end every loaded or live match of a
 * tournament before it is restarted, reset, deleted or (dev) wiped for a new
 * simulation run.
 */
export type CancelReason =
  | 'force-cancel'
  | 'tournament-restart'
  | 'tournament-reset'
  | 'tournament-delete'
  | 'simulation-reset';

/**
 * Outcome of an integration's check before a tournament starts. A failed
 * check blocks the start; `errorCode`, `message` and `details` go to the
 * admin as they are (CS2: `cs2_outdated_servers` with the affected servers).
 */
export type StartCheckResult =
  | { ok: true }
  | { ok: false; errorCode: string; message: string; details?: Record<string, unknown> };

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** What a tournament create or update asks its integration to validate. */
export interface TournamentSettingsInput {
  /** The request's `settings` object. */
  settings: unknown;
  /**
   * Map pool size a settings-only check (no `mode`) validates against. With
   * a `mode` the integration works it out from `body` and `stored`.
   */
  mapCount?: number;
  /**
   * - 'create': POST /api/tournament; required fields apply.
   * - 'create-shuffle': POST /api/tournament/shuffle.
   * - 'update': PUT /api/tournament; only what is sent is checked.
   * Omitted: only `settings`, against `mapCount`.
   */
  mode?: 'create' | 'create-shuffle' | 'update';
  /**
   * The request body. The integration reads its own top-level fields (CS2:
   * maps, mapSequence, maxRounds, overtimeMode, overtimeSegments).
   */
  body?: Record<string, unknown>;
  /** Update: the stored tournament row, for fields the request leaves alone. */
  stored?: Record<string, unknown> | null;
}

/**
 * Result of `validateTournamentSettings`. `valid` is false when any list is
 * non-empty. The core reports them in this order, around its own checks:
 * its required fields together with `missingFields` (one "Missing required
 * fields" message naming its own and `requiredFields`), then `fieldErrors`,
 * then its participant checks, then `errors` (the `settings`).
 */
export interface TournamentSettingsValidation extends ValidationResult {
  /** Required integration fields absent from the request. */
  missingFields?: string[];
  /** Errors in the integration's top-level fields (CS2: an empty map pool). */
  fieldErrors?: string[];
  /** The integration's required fields for this mode, missing or not, for the core's message. */
  requiredFields?: string[];
}

/**
 * The connection a `seed` hook gets: the schema initialisation client, plain
 * SQL with `$n` placeholders.
 */
export interface SeedClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** JSON Schema document. Kept loose on purpose; the core only stores and forwards it. */
export type JSONSchema = Record<string, unknown>;

export interface SetupSchema {
  /**
   * Tournament-level settings (cs2: maps/map pool, map sequence, max rounds,
   * overtime, veto order, team size). Not declared yet: CS2 validates them
   * through `validateTournamentSettings`.
   */
  tournament?: JSONSchema;
  /** Per-match overrides, used for standalone matches. Not declared yet. */
  match?: JSONSchema;
  /**
   * Instance-wide settings: the `app_settings` keys the integration owns
   * (cs2: the `matchzy_*` and simulation keys), one property per key. The
   * store and the settings API use `instanceSettings`; this is the
   * declarative view of the same keys.
   */
  instance: JSONSchema;
}

// ---------------------------------------------------------------------------
// Instance settings (app_settings)
// ---------------------------------------------------------------------------

/** What an `applyRequest` gets from `PUT /api/settings`. */
export interface SettingWriteContext {
  /** The tournament the request is scoped to (`resolveTournamentId`). */
  tournamentId: number;
  /** Store a value under this setting's key, through the settings store (so `normalize` runs). */
  set(value: string | null): Promise<void>;
  /**
   * Start the pre-match phases the tournament has waiting (the core calls
   * its integration's `startPendingPreMatchPhases`, in the background of the
   * request; failures are logged, never returned).
   */
  startPendingPreMatchPhases(): Promise<void>;
}

/**
 * One `app_settings` key. The core owns a few (webhook URL, ratings,
 * self-registration, IGDB); an integration contributes the rest through
 * `GameIntegration.instanceSettings`. The settings store accepts exactly the
 * union, and key names never change, so stored rows stay valid.
 */
export interface SettingDefinition {
  /** The `app_settings` key. */
  key: string;
  /**
   * Store an empty (trimmed) value as is. Otherwise "" is stored as NULL,
   * which falls back to the default.
   */
  keepEmpty?: boolean;
  /**
   * Turn a trimmed, non-empty value (or "" with `keepEmpty`) into what is
   * stored, and the line logged on success. Throw to reject it; the message
   * reaches the client as a 400.
   */
  normalize(trimmed: string): { value: string; message: string };
  /** The `PUT /api/settings` body field, when the key is editable there. */
  field?: string;
  /**
   * Where the field is applied in a `PUT /api/settings`. Fields are applied
   * one at a time in this order and a rejected one stops the request, so the
   * order decides which earlier fields were already saved.
   */
  order?: number;
  /**
   * Apply the request value (never `undefined`). Return an error message for
   * a 400, or nothing once it is stored (through `ctx.set`).
   */
  applyRequest?(value: unknown, ctx: SettingWriteContext): Promise<string | void>;
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
  /**
   * The key an ELO template stores this metric's weight under, when it is not
   * `key` (CS2: the camelCase keys templates have always been saved with,
   * e.g. `flashAssists` for `flash_assists`). Only for `ratingWeightable`
   * metrics.
   */
  ratingWeightKey?: string;
}

/**
 * The metrics a game records per player. The rating stat adjustment sums the
 * weighted metrics in the order listed here, so an integration keeps the
 * order stable (floating-point sums depend on it).
 */
export interface StatsSchema {
  metrics: StatsMetric[];
}

/** One player's stats as the game reported them: `metrics` keyed by `statsSchema` keys. */
export interface ReportedStatLine {
  account: LinkedAccountRef;
  name: string;
  /** The side the game filed the player under (not always their roster side). */
  team: TeamSide;
  metrics: Record<string, number>;
}

export interface PlayerStatLine extends ReportedStatLine {
  won: boolean;
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
 * CS2 produces these in `cs2/events/normalize.ts`; the core consumes them
 * through `MatchLifecycleApi.ingest` (`core/matchLifecycle.ts`). The core acts
 * on `map.result` and `series.ended` today; the others are still applied by the
 * integration's own adapter (live score, phase, presence) and ignored by ingest.
 *
 * There is no event-id dedupe yet: results are guarded by match state (a
 * finished series is not finished twice, a stale map is dropped by the
 * adapter), and a restarted match legitimately replays the same map ids.
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
      /**
       * The series score the game reports after this map. When absent the
       * series is not treated as won on this map (a separate `series.ended`
       * finishes it).
       */
      seriesScore?: { team1: number; team2: number };
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
  /**
   * Set when `applied` is false: 'match_not_found', 'already_completed' (the
   * match already has a winner), 'in_progress' (another result for the match
   * is being applied right now) or 'no_winner' (a decisive result named a
   * side the match has no team for).
   */
  reason?: string;
}

/**
 * The game-neutral result path the core offers (`core/matchLifecycle.ts`).
 * Every way a series can end (the game's `series.ended`, the admin "set
 * winner" action, later a manual-report submission) goes through
 * `applySeriesResult`, so bracket progression, ratings and stats run the same
 * way regardless of source.
 *
 * `applySeriesResult` contract:
 * - takes the match by slug, whatever its status (`ready`, `loaded`, `live`,
 *   `needs_decision`, or `completed` without a winner); the tournament comes
 *   from the match row;
 * - idempotent: a match that already has a winner is left alone
 *   (`already_completed`), so applying the same result twice changes nothing;
 * - `games` are written to `match_map_results` (game N is map N-1), skipping
 *   games already stored with the same result;
 * - player stats come from the integration (`seriesPlayerStats`); without
 *   them each rostered player still gets a `player_match_stats` row carrying
 *   only `won_match`;
 * - `meta.source` other than 'integration' is recorded with its `actorId` as
 *   a `series_result` row in `match_events`.
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
  /**
   * The catalogue row's name. Defaults to the integration's `displayName`,
   * which is right for a module that is one game (CS2) and wrong for one that
   * ships several (see `catalogEntries`), where the module's name is not any
   * of the games' names.
   */
  name?: string;
  /** Extra search terms, e.g. 'cs2'. */
  aliases?: string[];
  /**
   * The module's own square tile for this game, as a path the client serves
   * (`/games/rocket-league.svg`). It ships with the module rather than coming
   * from the games catalogue, because the setup wizard lists what this
   * instance can run: the art is ours, so every card reads the same — one
   * square, one palette, its own background, nothing cropped or recoloured.
   *
   * The catalogue's IGDB and Wikidata logos stay where a player is
   * recognising their own game ("What do you play?", a profile). That is a
   * different question — it covers every game, not only the ones a module
   * runs — and it keeps its own answer.
   *
   * Omit it and the wizard falls back to the game's text mark, which is the
   * honest answer for a title no module ships a tile for. Nothing is
   * stretched or borrowed to fill the box.
   */
  icon?: string;
}

export interface GameIntegration {
  id: GameId;
  displayName: string;
  capabilities: IntegrationCapabilities;
  /**
   * Catalogue entry; defaults to a slug of `displayName`. `null` keeps the
   * integration out of the player-facing catalogue (the test-only fake).
   */
  catalog?: GameCatalogEntry | null;
  /**
   * More catalogue entries the same module ships, for a module that is not one
   * game. Each entry becomes a `games` row the module is the integration for,
   * so those games read as supported and a tournament can be created for
   * them. `catalog` (one entry, named after the module) and `catalogEntries`
   * are independent; a module with only `catalogEntries` sets `catalog: null`.
   *
   * No module uses this today. Manual reporting did until 3.0 — eighteen
   * titles in its source — and they are game packs now: data installed on the
   * instance, naming the module as their `engine`, so adding a game no longer
   * takes a release. Prefer a pack. This stays for a module whose games
   * genuinely are code.
   *
   * An entry whose slug another integration already claims is skipped, so a
   * module that ships a CS2 entry never takes CS2's rows.
   */
  catalogEntries?: ReadonlyArray<GameCatalogEntry>;
  /**
   * This module runs any catalogue game, not just its own entries: the
   * manual-report module (3.0 phase D), where the result is typed in and the
   * game only decides the labels. `integrationForGameRef` falls back to it for
   * a `game` value no other module claims, so a tournament row can carry a
   * catalogue id ('rocket-league', 'chess') and still find its module. At most
   * one integration may set it.
   */
  runsAnyCatalogGame?: boolean;
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

  /** The settings this game declares (CS2: `instance`, its `app_settings` keys). */
  setupSchema?: SetupSchema;
  /**
   * The `app_settings` keys this game owns, with how each is stored and
   * edited through `/api/settings`. Keys must not clash with the core's or
   * another integration's.
   */
  instanceSettings?: ReadonlyArray<SettingDefinition>;
  /**
   * This game's fields of the `GET /api/settings` response (the stored
   * values with their defaults applied), keyed by `SettingDefinition.field`.
   */
  readInstanceSettings?(): Promise<Record<string, unknown>>;
  /**
   * Validate a tournament create or update: the integration's top-level
   * fields and its part of `settings`. CS2: the map pool (`maps`), the shuffle
   * map sequence and max rounds, and the custom veto order against the pool
   * size.
   */
  validateTournamentSettings?(input: TournamentSettingsInput): TournamentSettingsValidation;
  /**
   * Insert the integration's default data. Called after the core schema is
   * created or migrated: on every API start and after a database reset. Must
   * be idempotent; a rejection fails schema initialisation. CS2: the map
   * catalogue when the `maps` table is empty, then the default map pools.
   */
  seed?(db: SeedClient): Promise<void>;

  // --- setup ---------------------------------------------------------------

  /** Build the integration-owned `matches.config` for a match. */
  buildMatchConfig(ctx: BuildMatchConfigContext): Promise<unknown>;
  /** Neutral view of a stored config: roster, maps, series length. */
  describeMatch(config: unknown): MatchDescription;

  // --- lifecycle -----------------------------------------------------------

  /**
   * Whether the core may ready and allocate a match that has just got both
   * participants (`makeMatchReady` in bracket progression). `false` hands the
   * match to `onMatchReady` instead, and the integration readies it itself.
   * Omitted means `true`.
   *
   * CS2: `false` in simulation mode for BO formats, where the automated veto
   * runs first. Outside simulation there is no per-match gate: the players'
   * veto is gated tournament-wide by `capabilities.veto` in
   * `Scheduler.startTournament`.
   */
  isReadyToAllocate?(ctx: MatchContext): Promise<boolean>;
  /**
   * A match got both participants and `isReadyToAllocate` returned `false`:
   * run the integration's pre-match phase. The integration readies and
   * allocates the match when the phase ends (CS2 simulation: the automated
   * veto, then `scheduler.allocateReadyMatch`). Awaited. Must be safe to call
   * twice.
   */
  onMatchReady?(ctx: MatchContext): Promise<void>;
  /**
   * Start the pre-match phase, in the background, for every match of the
   * tournament that is waiting on one, and return the slugs started. Called
   * when a tournament starts, when a Swiss round is paired and when
   * simulation mode is switched on mid-tournament.
   *
   * CS2: the automated veto for every match with both teams, no server and
   * no finished veto (an unfinished one is resumed). `[]` outside simulation
   * mode, for shuffle tournaments and for formats without a veto.
   */
  startPendingPreMatchPhases?(tournamentId: number): Promise<string[]>;
  /**
   * Whose move it is in the match's pre-match phase (CS2: the map veto), or
   * `null` when there is none or it is done. Drives the player's "your turn"
   * prompt (`GET /api/players/me/match-status`).
   */
  preMatchTurn?(match: DbMatchRow): Promise<'team1' | 'team2' | null>;
  /**
   * Check the integration's resources before a tournament starts (CS2: every
   * enabled server runs an up-to-date CS2 build). Omit when there is nothing
   * to check.
   */
  checkStart?(scope: CapacityScope): Promise<StartCheckResult>;
  /**
   * Get the resources ready for a tournament start (CS2: the persistent
   * webhook config on every enabled server). Idempotent; a rejection is
   * logged and the start carries on.
   */
  prepareStart?(scope: CapacityScope): Promise<void>;
  /**
   * The URL the integration's resources reach this platform on. It is the
   * `baseUrl` the core hands to `allocate`, `load` and `restart` (CS2: the
   * webhook URL from Settings, which MatchZy posts its events to).
   *
   * Rejects when the integration needs one and it is not configured; that
   * rejection blocks a tournament start. An integration with no resources to
   * reach back has nothing to resolve and omits this: the core then passes
   * `''`, and a tournament for that game starts without a webhook URL.
   */
  resolveBaseUrl?(scope: CapacityScope): Promise<string>;
  /**
   * Idle resources that can take a match now; `null` means unlimited (no
   * servers). The core asks before it hands out a queue turn.
   */
  capacity(scope: CapacityScope): Promise<number | null>;
  /**
   * Select a resource and load the match on it. The core has already checked
   * that the match is ready and that it is its turn in the queue.
   */
  allocate(ctx: MatchContext, opts: { baseUrl: string }): Promise<AllocateResult>;
  /**
   * Allocate a wave of matches at once (tournament start, a new round): one
   * result per match, in the order given. The integration pairs matches with
   * the resources free at that moment, in order; the rest come back `queued`.
   * Without it the core calls `allocate` for each.
   */
  allocateBatch?(ctxs: MatchContext[], opts: { baseUrl: string }): Promise<AllocateResult[]>;
  /**
   * Restart a loaded or live match on its resource, or with `moveResource`
   * move a match that has not gone live to another free resource.
   */
  restart(
    ctx: MatchContext,
    opts: { baseUrl: string; moveResource?: boolean }
  ): Promise<ResourceActionResult>;
  /** Load the match on the resource it is assigned to (the admin "load" action). */
  load?(ctx: MatchContext, opts: { baseUrl: string; skipWebhook?: boolean }): Promise<ResourceActionResult>;
  /**
   * Best-effort end of the match on its resource (force-cancel, or a
   * tournament restart, reset or delete: see `CancelReason`). Rejects when the
   * resource could not be told; the core records the cancel regardless.
   */
  cancel?(ctx: MatchContext, reason: CancelReason): Promise<void>;
  /**
   * The series is over (finished, drawn, or parked for an admin decision):
   * free the match's resource for the next match. CS2: mark the server idle
   * and try to allocate waiting matches. Called by the core; safe to call twice.
   */
  release?(ctx: MatchContext): Promise<void>;
  /** Resource snapshot for the allocation status views. */
  poolStatus?(scope: CapacityScope): Promise<ResourcePoolStatus>;
  /**
   * How long a freed resource rests before the next match (CS2: the server
   * grace period). The core waits this long between shuffle rounds; 0 when
   * omitted.
   */
  turnoverSeconds?(): Promise<number>;
  /**
   * After an API restart, make sure the match's resource still reports to us
   * (CS2: the server's persistent webhook and demo upload config). Idempotent;
   * rejects when it could not be checked.
   */
  reattach?(ctx: MatchContext): Promise<void>;
  /**
   * The live state of one resource for the player and team match views, with
   * how to show it; null when it is unknown or the resource is offline.
   */
  resourceStatus?(resourceId: string): Promise<{
    status: string;
    description: {
      label: string;
      description: string;
      color: 'success' | 'warning' | 'error' | 'info' | 'default';
    };
  } | null>;

  // --- results -------------------------------------------------------------

  /**
   * Per-player stats for a finished series, one line per player the game
   * reported, team1's side first. The core matches lines to the roster by
   * account id (a later line for the same account wins), so `team` is only
   * where the game filed the player. Without it, or when it has nothing, the
   * core records rows with the result only.
   */
  seriesPlayerStats?(slug: string): Promise<ReportedStatLine[]>;
  /**
   * The integration's columns of a `player_match_stats` row for one player's
   * metrics (CS2: adr, total_damage, kills, …). The core writes them next to
   * its own columns (player, match, team, won_match, created_at). A player the
   * game reported nothing for gets `{}` as metrics.
   *
   * Transitional: a later PR adds a `metrics` JSONB column and a `game`
   * column; until then the metrics live in the CS2 columns.
   */
  playerStatsColumns?(metrics: Record<string, number>): Record<string, unknown>;
  /**
   * The reverse of `playerStatsColumns`: the metrics of a stored
   * `player_match_stats` row, as the rating stat adjustment reads them.
   * Without it a stored row has no metrics (no stat adjustment).
   */
  playerStatsMetrics?(row: Record<string, unknown>): Record<string, number>;
  /**
   * Account ids (`externalId`) per side of a standalone match, whose teams
   * exist only in its config; null when the config cannot be parsed. Without
   * it the core uses `describeMatch`.
   */
  standaloneRoster?(config: unknown): { team1: string[]; team2: string[] } | null;
  /**
   * Apply one stored game event again (`match_events.event_data`), as when it
   * arrived but without the webhook's side effects. Used by event replay after
   * downtime.
   */
  replayEvent?(event: unknown): Promise<void>;

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
  /**
   * Test-only routes: mounted as usual, but left out of the API reference and
   * the OpenAPI spec. An integration that is only registered in test runs
   * would otherwise make the generated docs depend on the environment they
   * were generated in.
   */
  testOnly?: boolean;
}
