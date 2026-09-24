/**
 * Client side of the game-integration contract (3.0 phase C, PR 12).
 *
 * Mirrors `api/src/integrations/types.ts`: core pages never import an
 * integration's files. They ask `integrations/registry` for the integration
 * that owns a tournament or match (by its `game` field, default 'cs2') and
 * render whatever that integration puts in each slot. A slot left empty means
 * "this game has nothing here", and the core renders nothing in its place.
 *
 * The prop interfaces below are the contract for each slot. The CS2 components
 * take exactly these props, so the core passes the same values it always did.
 *
 * Layout (the boundary lint in eslint-rules/integration-boundaries.mjs enforces
 * it for the client too):
 *
 *   client/src/integrations/types.ts      this file
 *   client/src/integrations/registry.ts   the only way to reach an integration
 *   client/src/integrations/<id>/**       one integration (cs2, later manual-report)
 */

import type { ComponentType, ReactElement } from 'react';
import type { TFunction } from 'i18next';
import type { SvgIconComponent } from '@mui/icons-material';

/** Integration id, the same value as the API's `game` column. */
export type GameId = 'cs2' | (string & {});

/** Games without a `game` field (older API responses) belong to CS2. */
export const DEFAULT_GAME: GameId = 'cs2';

/** Anything the core can look an integration up by. */
export interface GameOwned {
  game?: string | null;
}

/**
 * What a game gives the app, mirroring `IntegrationCapabilities` in
 * `api/src/integrations/types.ts` (3.0 phase D, PR D10).
 *
 * The client reads these to leave a thing out rather than render it empty. A
 * page that shows kills, ADR, headshots, maps or a demo link is showing what
 * the *game* measured; a game that measures nothing has no zero to show, it
 * has nothing to show, and those two read very differently to an organizer.
 */
export interface GameCapabilities {
  /** Matches run on game servers that must be allocated (cs2: true). */
  servers: boolean;
  /** Matches have a pre-match map veto / side pick phase (cs2: true). */
  veto: boolean;
  /** The game pushes live events (scores, phases, presence) while a match runs. */
  liveEvents: boolean;
  /** The game records demos that can be listed and downloaded. */
  demos: boolean;
  /** The game reports per-player stats (kills, deaths, ADR, ...). */
  playerStats: boolean;
}

// ---------------------------------------------------------------------------
// Match panels (team view, admin view)
// ---------------------------------------------------------------------------

/**
 * How players join the match: server address, connect button, copy command.
 *
 * The module reads all of it by match slug (client API 0.2.0; it used to be
 * handed the server, the current map's pictures and the button state).
 */
export interface MatchConnectPanelProps {
  matchSlug: string;
  /**
   * Whether this page lets the viewer join. The player page shows the
   * controls to that player only, even to a teammate looking at it; the
   * module shows its "waiting" state instead when this is false, and still
   * checks the viewer itself before it shows an address.
   */
  viewerCanJoin: boolean;
  /** Read again when the match itself moves (loaded → live …). */
  matchStatus?: string;
}

/**
 * Admin match list: which resources (servers) the queued matches wait for.
 *
 * The module asks its own endpoint what they are (client API 0.2.0). It
 * renders nothing when it has none to show.
 */
export interface MatchAllocationPanelProps {
  /** The tournament the list belongs to, or null before one exists (standalone matches). */
  tournamentId: number | null;
}

/**
 * Team match page: how this match's result reaches MAT when the game cannot
 * send one itself (3.0 phase D, PR D7).
 *
 * The panel asks the API what the viewer may do, so it takes only the match it
 * is about. CS2 leaves the slot empty — a CS2 result comes from the server.
 */
export interface MatchReportPanelProps {
  matchSlug: string;
  /** Re-read when the match itself moves (live → completed, needs_decision). */
  matchStatus?: string;
}

// ---------------------------------------------------------------------------
// Pre-match phase (CS2: the map veto)
// ---------------------------------------------------------------------------

export interface PreMatchViewProps {
  matchSlug: string;
  team1Name?: string;
  team2Name?: string;
  /** Which team is viewing, so the phase only accepts that team's actions. */
  currentTeamSlug?: string;
  /**
   * The phase is over, so the page can read the match again. It carries no
   * state: what the phase decided is the module's (client API 0.2.0).
   */
  onComplete?: () => void;
}

/**
 * What happened in the pre-match phase, shown once the match is on. The
 * module reads it itself and renders nothing when there is nothing to show
 * (client API 0.2.0).
 */
export interface PreMatchHistoryProps {
  matchSlug: string;
}

// ---------------------------------------------------------------------------
// Tournament setup steps, and the standalone match
// ---------------------------------------------------------------------------

/**
 * What every tournament setup step of a game module gets: the tournament's
 * settings object as the wizard holds it, and a way to merge a patch into it
 * (3.0 item 8b). A module reads and writes only its own key in it (CS2:
 * `cs2`, manual reporting: `manualReport`); the core stores and forwards the
 * object without reading it, and the API keeps it in `tournament.settings`.
 * A step that needs data (CS2: map pools and the map catalogue) loads it
 * itself.
 */
export interface TournamentSettingsStepProps {
  /** The tournament's `settings` object as the wizard has it so far. */
  settings: Record<string, unknown>;
  /** Merge a patch into `settings`. A module writes only its own key. */
  onChange: (patch: Record<string, unknown>) => void;
  /** The tournament's `game`, for a default that depends on the title. */
  game: string;
  /** Format id: 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss' | 'shuffle'. */
  type: string;
  /** Series length ('bo3'). */
  format: string;
  disabled?: boolean;
}

/** The game's match rules inside the Format step (CS2: rounds, overtime). */
export type TournamentRulesStepProps = TournamentSettingsStepProps;

/** The game content picked for a tournament, its own step (CS2: the map pool). */
export type TournamentContentStepProps = TournamentSettingsStepProps;

/**
 * The module's own tournament settings, inside the setup wizard (3.0 phase D,
 * PR D9).
 *
 * `rules` above is the *core's* question asked in the game's words (CS2:
 * rounds and overtime). This is the module's own object inside
 * `tournament.settings` — manual reporting's `manualReport` key: what to call
 * the game, how long a series is, who has to agree with a result.
 *
 * A module that ships this step also owns the series-length question, so the
 * core hides its own: a tournament has one series length, and asking for it
 * twice is a way to store two different answers.
 */
export interface TournamentGameSettingsStepProps extends TournamentSettingsStepProps {
  /** What the catalogue calls that game, for a label that defaults to it. */
  gameName: string;
  /** The tournament's series length ('bo3'), which this step owns. */
  onFormatChange: (format: string) => void;
}

/** What the wizard asks a module's setup model about: the tournament being set up. */
export interface TournamentSetupContext {
  game: string;
  /** Format id ('single_elimination', ..., 'shuffle'). */
  type: string;
  /** Series length ('bo3'). */
  format: string;
}

/** A row of the setup summary card or of the review of a new tournament. */
export interface TournamentSetupRow {
  /** Stable; the summary card's test id is `tournament-summary-<key>`. */
  key: string;
  label: string;
  value: string;
  /** Not decided yet: shown muted. */
  pending?: boolean;
}

/** A condition the tournament needs before it can be created or started. */
export interface TournamentSetupCheck {
  key: string;
  label: string;
  met: boolean;
}

/** What the module adds around its steps. */
export interface TournamentSetupSummary {
  /** Rows of the summary card, after the core's. */
  rows: TournamentSetupRow[];
  /** Items of the Start checklist, after the core's. */
  checklist: TournamentSetupCheck[];
  /** Rows of the review of a tournament that is not created yet. */
  review: TournamentSetupRow[];
}

/** One changed field, for the save confirmation of an existing tournament. */
export interface TournamentSettingChange {
  field: string;
  label: string;
  oldValue: string | string[];
  newValue: string | string[];
  /**
   * False: a change worth saving that does not need the confirmation dialog
   * on its own (CS2: the round rules). Omitted: it asks.
   */
  confirm?: boolean;
}

/**
 * The rest of a game module's part in the tournament setup: plain functions
 * of the settings object, for what the core shows around the module's steps
 * and when it lets the organizer go on (3.0 item 8b). All optional; a module
 * without steps needs none. `t` is the core's translate function (strings a
 * module shares with core pages live in core's namespace; a module's own are
 * `<id>:key`).
 */
export interface TournamentSetupModel {
  /**
   * The module's object(s) for a new tournament, as a settings patch (CS2:
   * `{ cs2: { maps: [], maxRounds: 24, ... } }`). `from` is a saved settings
   * object to start from: a template's, or a saved tournament's.
   */
  initialSettings?(
    ctx: TournamentSetupContext,
    from?: Record<string, unknown>
  ): Record<string, unknown>;
  /** A settings patch for a change of tournament type (CS2: a shuffle starts with no maps). */
  onTypeChange?(
    settings: Record<string, unknown>,
    from: string,
    to: string
  ): Record<string, unknown>;
  /**
   * Why the organizer cannot go on yet, or null. `rules` is asked on the
   * Format step (where the `rules` step shows), `content` on the module's own
   * step and before a save.
   */
  stepError?(
    step: 'rules' | 'content',
    settings: Record<string, unknown>,
    ctx: TournamentSetupContext,
    t: TFunction
  ): string | null;
  /** Summary rows, Start checklist items and review rows for the module's settings. */
  summary?(
    settings: Record<string, unknown>,
    ctx: TournamentSetupContext,
    t: TFunction
  ): TournamentSetupSummary;
  /**
   * Rounds a shuffle tournament will have with these settings (CS2: one per
   * map), for the match estimate. Null when it cannot say.
   */
  roundCount?(settings: Record<string, unknown>, ctx: TournamentSetupContext): number | null;
  /**
   * What differs between the saved settings and the edited ones. An empty
   * list is "no change" for the module's part of the form.
   */
  changes?(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    ctx: TournamentSetupContext,
    t: TFunction
  ): TournamentSettingChange[];
}

/**
 * A match outside the bracket, created from the admin match list (client API
 * 0.2.0).
 *
 * The module owns the whole dialog: whatever a match of its game needs
 * (CS2: series length, veto, sides, rounds, overtime, maps, teams) is its
 * form, and core only opens it. It used to be two slots, `rules` and
 * `content`, fed 37 props of state core kept. A module that leaves this out
 * has no standalone matches, and the match list offers none.
 */
export interface StandaloneMatchProps {
  open: boolean;
  onClose: () => void;
  /** The match was created; core closes the dialog and reloads the list. */
  onCreated: (matchSlug: string) => void;
}

// ---------------------------------------------------------------------------
// Resources (CS2: game servers)
// ---------------------------------------------------------------------------

/**
 * Add a resource, or several at once, from outside the module's own page (the
 * tournament setup's "not enough servers" buttons).
 *
 * Core only opens the dialog. The module reads whatever it checks a new
 * resource against itself (client API 0.2.0; it used to be handed the server
 * list).
 */
export interface ResourceDialogProps {
  open: boolean;
  onClose: () => void;
  /** Something was added: core re-reads what it counts, and closes the dialog. */
  onSaved: () => void;
}

/** The batch dialog takes the same props. */
export type BatchResourceDialogProps = ResourceDialogProps;

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

/**
 * Admin home: summary card for the game's resources. The module counts them
 * itself (client API 0.2.0), so it takes nothing.
 */
export type AdminHomeResourcesProps = Record<string, never>;

/**
 * Manage page: live grid of the game's resources and what runs on them. The
 * module asks for both itself, as often as it likes (client API 0.2.0).
 */
export interface ManageResourcesProps {
  /** The tournament being managed, or null before one exists. */
  tournamentId: number | null;
}

// ---------------------------------------------------------------------------
// Pages and navigation
// ---------------------------------------------------------------------------

/**
 * Where a route is mounted:
 * - `admin`: nested in the admin shell (`/` + `Layout`), path relative to it.
 * - `admin-standalone`: top level, admins only, outside the shell.
 */
export type IntegrationRouteScope = 'admin' | 'admin-standalone';

export interface IntegrationRoute {
  /**
   * The page's URL, from the SDK's `links` (`links.servers()`). Core nests an
   * `admin` route in the shell itself, so the leading slash is optional there.
   */
  path: string;
  scope: IntegrationRouteScope;
  element: ReactElement;
}

/**
 * The places core shows a module's page link, each with its own label:
 * - `nav`: the admin sidebar entry
 * - `pageTitle`: the page header while the page is open
 * - `rail`: the manage page's rail
 * - `siteLabel` / `siteHint`: the admin home's site grid tile and its one-liner
 */
export type IntegrationNavLabelSurface = 'nav' | 'pageTitle' | 'rail' | 'siteLabel' | 'siteHint';

/**
 * A page link the integration adds to the admin navigation.
 *
 * Its labels are the module's own strings: core renders each one from the
 * module's namespace (its `id`, see `ClientGameIntegration.locales`), never
 * from core's. By default the key for each surface is the one core used for
 * its own links, under the module's namespace:
 *
 *   nav        `<id>:nav.<key>`
 *   pageTitle  `<id>:layout.pageTitle.<key>`
 *   rail       `<id>:managePage.rail.<key>`
 *   siteLabel  `<id>:dashboard.site.<key>.label`
 *   siteHint   `<id>:dashboard.site.<key>.hint`
 *
 * `labels` names a different key in the module's namespace for any of them.
 * A key the module's strings lack renders as `key` itself (the hint as
 * nothing), so a missing string is visible without a raw i18n path. See
 * `utils/moduleNavLabels.ts`.
 */
export interface IntegrationNavItem {
  key: string;
  path: string;
  icon: SvgIconComponent;
  labels?: Partial<Record<IntegrationNavLabelSurface, string>>;
}

// ---------------------------------------------------------------------------
// The admin shell, and starting the tournament
// ---------------------------------------------------------------------------

/**
 * Something the module needs an admin to fix before its tournament can run,
 * shown on every admin page (3.0 phase E).
 *
 * CS2 fills it with the webhook URL — what a CS2 server reaches the platform
 * on — and with the Auto Tournament CS2 plugin's database health, which is the plugin's
 * own connection on the game server and has no meaning anywhere else. The core
 * shell has no opinion about either: it renders the slot and nothing else, so
 * an instance whose tournament needs no servers is never nagged about settings
 * that would change nothing for it.
 *
 * Not everything the shell warns about belongs here. Steam's health stays in
 * the shell, because the warning is about sign-ins and profile lookups — the
 * platform's own login provider, which a Rocket League instance depends on
 * exactly as much as a CS2 one.
 */
export interface AdminGlobalWarningProps {
  /** Take the admin to the settings page, whose route the core owns. */
  onOpenSettings: () => void;
}

/**
 * The body of the "Start tournament" confirmation, in the game's words (3.0
 * phase E).
 *
 * What starting *does* is the module's answer: CS2 checks its fleet, allocates
 * servers, loads matches over RCON and puts them in warmup, and says how much
 * of that fleet is ready. A module with no resources has none of that to say,
 * leaves the slot empty, and the core's own dialog — which knows only that the
 * matches open and the tournament goes live — is what the admin sees.
 */
export interface TournamentStartConfirmProps {
  /** True while the dialog is open, so the module reads its state then. */
  open: boolean;
}

/**
 * A start the API refused for a reason this module can offer a way out of
 * (CS2: servers Steam says are out of date, which it can disable and retry).
 */
export interface TournamentStartFailureProps {
  /** The raw message the start request rejected with. */
  error: string;
  /** Give up: close the dialog without starting. */
  onClose: () => void;
  /** Start again, once the module has fixed what it named. */
  onRetry: () => Promise<void>;
  /** Report a problem the module hit while fixing it, the ordinary way. */
  onError: (message: string) => void;
}

/**
 * The module's own check, run between "start" being clicked and the tournament
 * actually starting, on the setup page (3.0 phase E).
 *
 * The setup page's start asks *before* it starts rather than after: CS2 counts
 * what its fleet can take right now against what the first round wants, and
 * stops to ask when the answer is "less than that". That question, and all
 * three ways CS2 phrases it, only exist because there are servers.
 *
 * So the module owns the whole decision, including whether there is anything
 * to ask about: it renders nothing and calls `onProceed` when the start can
 * just happen. A module that leaves the slot empty is the same as one that
 * always proceeds, and the core starts without asking.
 */
export interface TournamentStartPreflightProps {
  /** True once the admin asked to start and the core is waiting for an answer. */
  open: boolean;
  /**
   * How many of the first round's matches can be played at the same time —
   * the bracket's shape, which the core knows and the module translates into
   * its own resources ("that many servers").
   */
  concurrentMatches: number;
  /** Nothing to ask about, or the admin said go ahead. */
  onProceed: () => void;
  /** The admin backed out. */
  onCancel: () => void;
}

/**
 * Everything the "Start tournament" button says in the game's words. A module
 * that leaves this out gets the core's dialog, which names nothing the game
 * does not have.
 */
export interface TournamentStartSlot {
  /** What starting does to this game's resources, and whether they are ready. */
  confirmView: ComponentType<TournamentStartConfirmProps>;
  /** The go-ahead button's label (CS2: "Yes, Start Anyway"). */
  confirmLabel: string;
  /** The dismiss button's label (CS2: "Check Servers"). */
  cancelLabel: string;
  /** Where dismissing takes the admin instead (CS2: the Servers page). */
  cancelPath?: string;
  /** The go-ahead button's colour, for a start the module calls risky. */
  confirmColor?: 'primary' | 'warning' | 'error';
  /**
   * True when `failureView` will handle this refusal. The core shows its error
   * snackbar for everything this says no to — and for every refusal at all
   * when a module has no `failureView`.
   */
  ownsFailure?: (error: string) => boolean;
  /**
   * The way out of a refusal `ownsFailure` claimed, wherever the start was
   * asked for.
   *
   * There used to be two of these, one per surface, because the dashboard and
   * the setup page had always worded the same refusal differently. They are
   * one component again: the refusal is about the same resources and offers
   * the same way out, so saying it two ways was an accident of where the code
   * grew rather than something either surface needed.
   */
  failureView?: ComponentType<TournamentStartFailureProps>;

  /**
   * The setup page's start, which is the same action asked in a different
   * place: it runs the module's check first, and answers a refusal
   * `ownsFailure` claimed with the same `failureView` above.
   */
  preflight?: {
    /** The check itself, which asks only when there is something to ask. */
    view: ComponentType<TournamentStartPreflightProps>;
  };
}

/**
 * What a module's `resourceAvailabilityEndpoint` answered (client API 0.2.0).
 *
 * The answer is the module's own, in its own shape. Core reads one field of
 * it, the seconds until the next allocation pass, to tick a countdown; the
 * rest it hands back to the module's slots untouched, and the module reads it
 * as the type it knows it is.
 */
export type ResourceAvailability = {
  nextAllocationInSeconds?: number | null;
} & Record<string, unknown>;

/**
 * The two numbers core shows about a queue itself, read by the module out of
 * its own availability answer (client API 0.2.0).
 *
 * The match list's "3 in queue" chip and the Manage console's QUEUED tile and
 * "Announce" button are core's, but the answer they are read from is the
 * module's, in its own shape. Core does not read that shape: it hands the
 * answer to `summarizeAvailability` and shows what comes back.
 */
export interface ResourceQueueSummary {
  /** Matches ready to play that are waiting for a resource. */
  waitingMatches: number;
  /** Resources the game has at all. Manage's "Announce" goes to all of them, and is off at 0. */
  resourceCount: number;
}

/**
 * The bracket, above it: why the matches that are ready have not started yet
 * (3.0 phase E).
 *
 * A match waits for something only where there is something to wait for. CS2's
 * matches wait for a server to come free, and the banner names how many and
 * when the next allocation pass runs — an allocation pass being a thing only a
 * game with servers has. A module whose matches are simply open the moment the
 * round opens leaves this empty, and the bracket has no banner.
 *
 * The core does the asking, once, through `resourceAvailabilityEndpoint`
 * below, and hands the answer over: the page already ticks the countdown down
 * between polls for a chip of its own, and two components counting the same
 * seconds from two requests would drift apart on screen.
 */
export interface MatchQueueBannerProps {
  /** What the game's resources can take right now, or null before the first answer. */
  availability: ResourceAvailability | null;
  /** Seconds until the next allocation pass, ticked down locally between polls. */
  nextInSeconds: number | null;
}

/**
 * One queued match, and when the game expects to have somewhere to run it (3.0
 * phase E follow-up).
 *
 * The admin match list put a line under every waiting match — *allocating now*,
 * *allocates in 1:20*, *waiting for servers* — worked out from how many CS2
 * servers were free and how long the rest had left on their cooldown. None of
 * that is a fact about a match; it is a fact about a fleet, and a module
 * without one leaves the slot empty. Its matches are then simply queued, which
 * is what the queue position beside this already says.
 *
 * The module gets the raw answer and the match's place in the queue, and works
 * out the rest itself, because "how long until there is room for the Nth one"
 * is a question only the thing holding the resources can answer.
 */
export interface MatchQueueStatusProps {
  /** What the game's resources can take right now, or null before the first answer. */
  availability: ResourceAvailability | null;
  /** This match's index among the upcoming matches, in the order they are shown. */
  queueIndex: number;
}

/**
 * The Manage console's status strip: the module's own tile (3.0 phase E
 * follow-up).
 *
 * The strip counts what is live, what is in veto, what is queued and what
 * round it is — all facts about matches — and then said *SERVERS FREE 0 / 0*,
 * which is a fact about a fleet. On a game with no fleet that tile was a zero
 * standing in for "not applicable", which is exactly the reading this seam
 * exists to stop. The module now supplies the tile or supplies nothing, and
 * the strip is one tile shorter.
 *
 * The tile renders itself with `ManageStatusTile` from the strip, so a
 * module's tile cannot end up looking unlike the tiles beside it.
 */
export interface ManageStatusTileProps {
  /** What the game's resources can take right now, or null before the first answer. */
  availability: ResourceAvailability | null;
}

/** What one "needs you" button does. Each calls an endpoint core already has. */
export type ManageNeedsYouActionKind = 'decide' | 'reallocate' | 'forceCancel';

export interface ManageNeedsYouAction {
  kind: ManageNeedsYouActionKind;
  label: string;
  matchSlug: string;
}

/** One row of the Manage console's "needs you" queue. */
export interface ManageNeedsYouItem {
  id: string;
  /** The dot: 'ban' (red) for outages, 'warn' (accent) for decisions, 'info' for the rest. */
  severity: 'ban' | 'warn' | 'info';
  title: string;
  detail: string;
  actions: ManageNeedsYouAction[];
  /** Present when one of the actions opens the match details/decision dialog. */
  decisionMatchSlug?: string;
}

/** One of the tournament's matches, as the "needs you" queue names it. */
export interface ManageMatchRef {
  slug: string;
  status: string;
  /** "Team A vs Team B", or the slug while a team is unknown. */
  name: string;
}

/**
 * What `manageNeedsYou` is given (client API 0.2.0).
 *
 * The Manage console's queue lists what an admin has to act on. Matches that
 * need a decision are core's. What is wrong with the game's resources (CS2: a
 * server offline, or flagged stale, while it holds a match) is the module's,
 * worked out from its own availability answer.
 */
export interface ManageNeedsYouInput {
  /** The module's own availability answer. */
  availability: ResourceAvailability;
  /** The tournament's matches, so a row can name its match. */
  matches: readonly ManageMatchRef[];
  /** The module's translator: its own namespace first, core's after it. */
  t: TFunction;
}

/**
 * One row of the admin home's "Finish setting up" card, from a module
 * (client API 0.2.0). CS2: "Add a server" / "3 servers added".
 */
export interface AdminHomeSetupItem {
  key: string;
  done: boolean;
  /** An optional row does not keep the card up once the required ones are done. */
  optional?: boolean;
  /** A key in the module's own namespace. */
  labelKey: string;
  labelValues?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Team administration
// ---------------------------------------------------------------------------

/**
 * Team page: one control the integration needs an admin to have (3.0 phase D,
 * PR D7 — manual reporting needs a team to have a captain before anybody can
 * report for it).
 */
export interface TeamAdminPanelProps {
  teamId: string;
}

// ---------------------------------------------------------------------------
// The admin area
// ---------------------------------------------------------------------------

/**
 * The admin Disputes page (3.0 phase D, PR D8): everything this module needs
 * an admin to decide, and the form for deciding it.
 *
 * Only a module whose results are *claimed* rather than measured can have a
 * dispute, so CS2 leaves this empty and the page says so. The core page owns
 * the URL and the chrome; what goes inside it is the module's, because only
 * the module knows what "a result nobody agrees on" looks like.
 */
export interface AdminDisputesViewProps {
  /** The tournament to filter to, or null for everything waiting. */
  tournamentId: number | null;
}

/**
 * The tournament's own statistics, on the public leaderboard page (3.0 phase
 * D, PR D10).
 *
 * The page's built-in columns — wins, losses, win rate, rating, ADR — are what
 * the *game* measured. A game that measures nothing fills this slot instead:
 * manual reporting lists the totals for the custom fields the tournament asks
 * reporters for, which is the only thing there is to show. CS2 leaves it
 * empty, because its own numbers are already the page.
 */
export interface TournamentStatsViewProps {
  tournamentId: number;
}

// ---------------------------------------------------------------------------
// The integration
// ---------------------------------------------------------------------------

/**
 * A module's own strings: one i18next resource bundle per language code
 * (`en`, `de`, `pt-PT`, …), each the same nested JSON core's locale files use.
 */
export type ModuleLocales = Readonly<Record<string, Record<string, unknown>>>;

export interface ClientGameIntegration {
  id: GameId;

  /**
   * The module's strings, registered with i18next as the namespace `id`
   * before any of its slots renders (item 6 of DESIGN-modules.md).
   *
   * - Inside the module, `useModuleTranslation(id)` from the module SDK gives
   *   a `t` that looks in this namespace first and in core's (`translation`)
   *   after it, so shared words like `common.cancel` stay core's.
   * - A language the module leaves out, or a key missing from one it ships,
   *   falls back to the module's own English (`en`) before anything else.
   *   `en` is the one bundle a module should always ship.
   * - Built-in modules keep theirs in `integrations/<id>/locales/<lang>.json`,
   *   where the i18n scripts check them against their English like core's.
   *   A code module loaded from disk puts them on its default export, bundled
   *   with its code (`import en from './locales/en.json'`), so they arrive in
   *   the same request and need no route of their own.
   */
  locales?: ModuleLocales;

  /**
   * Catalogue ids this integration answers for, besides its own id.
   *
   * `game` holds an integration id today ('cs2') and a game catalogue id from
   * 3.0 phase D onwards ('rocket-league'), so the client resolves it the way
   * `api/src/integrations/registry.ts` does: the id, then these, then an
   * integration that runs anything.
   */
  catalogGames?: string[];

  /**
   * The catalogue slug for this integration's *own* game, when it is one
   * (`cs2` -> `counter-strike-2`). A module that is not a game — manual
   * reporting, which runs many — leaves it out.
   *
   * It is what turns a `tournament.game` of 'cs2' back into the catalogue id
   * the rest of the app names games by. The API makes the same distinction
   * with `catalog` vs `catalogEntries`.
   */
  catalogSlug?: string;

  /**
   * The module's own square tile for its own game, mirroring
   * `GameCatalogEntry.icon` on the API side (`cs2` ->
   * `/games/counter-strike-2.svg`).
   *
   * The setup wizard takes every other game's tile from
   * `GET /api/games/playable`, which is the module's declaration reaching the
   * client the same way `integrationId` does. This one is here because the
   * wizard renders Counter-Strike 2 before that request answers — and if it
   * never answers — and a fallback entry with no art would flash a text mark
   * on the instance's own game.
   */
  catalogIcon?: string;

  /**
   * True for a module that runs every other catalogue game (manual reporting).
   * The registry falls back to it before it falls back to CS2.
   */
  runsAnyCatalogGame?: boolean;

  /**
   * Set only on the registry's "module not installed" placeholder
   * (`utils/moduleResolution`): the `game` value this instance has no module
   * for. Every slot of the placeholder is empty, so a page renders nothing
   * game-specific; the admin shell and the team match page read this to say
   * why. A real module never sets it.
   */
  notInstalled?: GameId;

  /**
   * Set only on the registry's "module pending" placeholder
   * (`getIntegrationWhileLoading`): the `game` value whose module may still
   * be loading this page load. Slots are empty as for `notInstalled`; the
   * surfaces that would say "not installed" show a loading state instead. A
   * real module never sets it.
   */
  modulePending?: GameId;

  matchPanels: {
    /** Team / player match page: how to join the match. */
    teamView?: ComponentType<MatchConnectPanelProps>;
    /** Admin match list: resource allocation status. */
    adminView?: ComponentType<MatchAllocationPanelProps>;
    /** Team match page: reporting the result, when the game cannot send one. */
    reportView?: ComponentType<MatchReportPanelProps>;
  };

  /** Team page: an admin-only control this integration needs (D7: captains). */
  teamAdminPanel?: ComponentType<TeamAdminPanelProps>;

  /**
   * The admin shell, every page: a setting this module needs before its
   * tournament can run (CS2: the webhook URL). Left empty by a module that
   * needs nothing configured, and the shell then says nothing.
   */
  adminGlobalWarning?: ComponentType<AdminGlobalWarningProps>;

  /**
   * The "Start tournament" confirmation, in this game's words. Left empty by
   * a module with no resources to prepare, which gets the core's dialog.
   */
  tournamentStart?: TournamentStartSlot;

  /** The bracket page: why the ready matches have not started (CS2: servers). */
  matchQueueBanner?: ComponentType<MatchQueueBannerProps>;

  /**
   * The bracket page's shuffle round card: the same wait as one chip beside
   * the round's own counts (CS2: "Next servers in 24s").
   *
   * The card is the core's — how many of this round's matches are done,
   * playing and still pending is true of every game — and only this one chip
   * was about a fleet. It gets the same numbers the banner does, so the two
   * cannot show a different countdown.
   */
  matchQueueChip?: ComponentType<MatchQueueBannerProps>;

  /**
   * The admin match list, where a match waits between being drawn and being
   * playable (3.0 phase E follow-up).
   *
   * All three of these are the same fact — the game has not got round to this
   * match yet — told at three sizes, and all three are about resources the
   * game allocates. A module whose matches are playable the moment they are
   * drawn fills none of them, and its match list shows a match and its queue
   * position and nothing else.
   */
  matchListQueue?: {
    /** Above the list: when the next allocation pass runs. */
    banner?: ComponentType<MatchQueueBannerProps>;
    /** In the list's toolbar: the same countdown, in one line. */
    countdown?: ComponentType<MatchQueueBannerProps>;
    /** On a waiting match's card: when this one expects somewhere to run. */
    cardStatus?: ComponentType<MatchQueueStatusProps>;
  };

  /**
   * The Manage console's status strip: this module's own tile, beside the
   * match counts the strip works out for itself (CS2: servers free).
   */
  manageStatusTile?: ComponentType<ManageStatusTileProps>;

  /**
   * Reads this module's availability answer for the counts core shows itself:
   * the match list's "N in queue", Manage's QUEUED tile and whether Manage's
   * "Announce" has anywhere to go. Without it they read 0.
   */
  summarizeAvailability?: (availability: ResourceAvailability) => ResourceQueueSummary;

  /**
   * The Manage console's "needs you" rows about this module's resources,
   * listed after core's own (CS2: servers offline or stale while holding a
   * match). Worked out from the answer core already has; called on render,
   * so it must be quick and must not fetch.
   */
  manageNeedsYou?: (input: ManageNeedsYouInput) => ManageNeedsYouItem[];

  /**
   * Where the core asks what this game's match resources can take right now
   * (3.0 phase E).
   *
   * The match list and the Manage console show a queue: how many matches are
   * waiting, how long until one gets a place to run, whether anything is free
   * at all. That queue exists because a match needs a *resource* first, and
   * only the module knows whether its game has any or where to ask about them
   * — `/api/tournament/server-availability` is a CS2 route about CS2 servers,
   * and the core used to name it in three places.
   *
   * A module that leaves this empty is saying its matches wait for nothing:
   * the core never asks, and every surface that would have shown a queue shows
   * nothing instead, which is the truth rather than "0 servers free".
   */
  resourceAvailabilityEndpoint?: string;

  /**
   * Admin area, `/disputes`: what this module needs an admin to settle (D8).
   * Left empty by a game whose results come from the game itself.
   */
  adminDisputesView?: ComponentType<AdminDisputesViewProps>;

  /**
   * The public leaderboard page: this game's own statistics, when the page's
   * built-in CS2 columns are not them (D10). Left empty by a game whose
   * numbers the page already shows.
   */
  tournamentStatsView?: ComponentType<TournamentStatsViewProps>;

  /** Shown to the teams before the match can be allocated (CS2: map veto). */
  preMatchView?: ComponentType<PreMatchViewProps>;
  /** Record of the pre-match phase, shown on the match details. */
  preMatchHistory?: ComponentType<PreMatchHistoryProps>;

  /**
   * What this game gives the rest of the app, mirroring the API integration's
   * `capabilities` (3.0 phase D, PR D10). The client reads them to leave out
   * what a game does not have rather than showing an empty column or a zero:
   * a manually reported match has no server to join, no demo to download and
   * no per-player numbers, because nothing measured it.
   */
  capabilities: GameCapabilities;

  tournamentSetupSteps: {
    rules?: ComponentType<TournamentRulesStepProps>;
    content?: ComponentType<TournamentContentStepProps>;
    /** The module's own tournament settings (manual reporting: `manualReport`). */
    settings?: ComponentType<TournamentGameSettingsStepProps>;
    /**
     * Extra lines for the review of a tournament not created yet, that need
     * data the module loads (CS2: the maps by name). Rendered inside the
     * review's list, after the rows of `tournamentSetup.summary().review`.
     */
    review?: ComponentType<TournamentSettingsStepProps>;
  };

  /** The module's answers about its settings around the setup steps; see `TournamentSetupModel`. */
  tournamentSetup?: TournamentSetupModel;

  /** The admin match list's "create match" dialog (CS2: the whole standalone match form). */
  standaloneMatch?: ComponentType<StandaloneMatchProps>;

  resourceDialogs: {
    add?: ComponentType<ResourceDialogProps>;
    batchAdd?: ComponentType<BatchResourceDialogProps>;
  };

  dashboardWidgets: {
    adminHomeResources?: ComponentType<AdminHomeResourcesProps>;
    manageResources?: ComponentType<ManageResourcesProps>;
  };

  /**
   * The admin home's "Finish setting up" rows this module adds (CS2: add a
   * server). The module fetches what it needs; core asks once per visit,
   * alongside its own rows, and shows them after its first. A rejection
   * counts as no rows.
   */
  adminHomeSetup?: () => Promise<AdminHomeSetupItem[]>;

  /** Pages the integration owns. URLs come from `paths.ts`. */
  routes: IntegrationRoute[];

  /**
   * Links to those pages. Each surface places them where its own list had
   * them (see Layout, ManageRail and SiteLinksGrid).
   */
  navItems: IntegrationNavItem[];
}
