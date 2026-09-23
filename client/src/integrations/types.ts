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
import type { SvgIconComponent } from '@mui/icons-material';
import type {
  Match,
  Server,
  ServerAllocationInfo,
  TeamMatchInfo,
  VetoAction,
  VetoState,
} from '../types';
import type { MapPool, Map as MapType, ServerAvailabilityResponse } from '../types/api.types';
import type { CS2MapData } from '../types/veto.types';
import type { PluginVersionSummary, ServerFleetCounts } from '../hooks/useAdminHomeData';

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

/** How players join the match: server address, connect button, copy command. */
export interface MatchConnectPanelProps {
  server: TeamMatchInfo['server'];
  currentMapData: CS2MapData | null;
  currentMapNumber?: number | null;
  connected: boolean;
  copied: boolean;
  onConnect: () => void;
  onCopy: () => void;
}

/** Admin match list: which resources (servers) the queued matches wait for. */
export interface MatchAllocationPanelProps {
  servers: ServerAllocationInfo[];
  gracePeriodSeconds: number;
  requiredServerCount?: number;
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
  onComplete?: (vetoState: VetoState) => void;
}

/** What happened in the pre-match phase, shown once the match is on. */
export interface PreMatchHistoryProps {
  actions: VetoAction[];
  team1Name: string;
  team2Name: string;
}

// ---------------------------------------------------------------------------
// Tournament setup and standalone match steps
// ---------------------------------------------------------------------------

/** The game's match rules inside the tournament setup (CS2: rounds, overtime). */
export interface MatchRulesValue {
  maxRounds: number;
  overtimeMode?: 'enabled' | 'disabled';
  overtimeSegments?: number | null;
}

export interface TournamentRulesStepProps {
  value: MatchRulesValue;
  onChange: (patch: Partial<MatchRulesValue>) => void;
  disabled?: boolean;
  /** Keeps the test id the old wizard had for each kind of tournament. */
  maxRoundsTestId: string;
}

/** Game content picked for a tournament (CS2: the map pool). */
export interface TournamentContentStepProps {
  format: string;
  type?: string; // Tournament type - needed for shuffle tournament explanation
  maps: string[];
  mapPools: MapPool[];
  availableMaps: MapType[];
  selectedMapPool: string;
  loadingMaps: boolean;
  canEdit: boolean;
  saving: boolean;
  onMapPoolChange: (poolId: string) => void;
  onMapsChange: (maps: string[]) => void;
  onSaveMapPool: () => void;
  onMapRemove?: (mapId: string) => void;
  /**
   * When true, hides the shuffle‑tournament specific explanation block.
   * Useful for reusing this component in non‑tournament contexts (e.g. manual matches).
   */
  hideShuffleExplanation?: boolean;
  /**
   * When false, disables drag-and-drop ordering even for shuffle tournaments and
   * falls back to a simple chip preview. This is handy for contexts where map
   * order is irrelevant but we still want shuffle-style validation rules.
   */
  enableOrdering?: boolean;
}

/**
 * The module's own tournament settings, inside the setup wizard (3.0 phase D,
 * PR D9).
 *
 * `rules` above is the *core's* question asked in the game's words (CS2:
 * rounds and overtime). This is the module's own object inside
 * `tournament.settings` — manual reporting's `manualReport` key: what to call
 * the game, how long a series is, who has to agree with a result. The core
 * stores and forwards that object without reading it, so the step is the only
 * thing that knows its shape.
 *
 * A module that ships this step also owns the series-length question, so the
 * core hides its own: a tournament has one series length, and asking for it
 * twice is a way to store two different answers.
 */
export interface TournamentGameSettingsStepProps {
  /** The tournament's `settings` object as the wizard has it so far. */
  settings: Record<string, unknown>;
  /** Merge a patch into `settings`. A module writes only its own key. */
  onChange: (patch: Record<string, unknown>) => void;
  /** The tournament's `game`, for a default that depends on the title. */
  game: string;
  /** What the catalogue calls that game, for a label that defaults to it. */
  gameName: string;
  /** The tournament's series length ('bo3'), which this step owns. */
  format: string;
  onFormatChange: (format: string) => void;
  disabled?: boolean;
}

export type StartingSide = 'knife' | 'team1_ct' | 'team2_ct';

/** Standalone match: series length, veto, sides, rounds and roster size. */
export interface StandaloneRulesStepProps {
  activeStep: number;

  bestOf: 'bo1' | 'bo3' | 'bo5';
  onBestOfChange: (format: 'bo1' | 'bo3' | 'bo5') => void;

  useVeto: boolean;
  onUseVetoChange: (value: boolean) => void;

  requiredMaps: number;
  selectedMapsCount: number;
  hasVetoMapCountError: boolean;
  hasSeriesMapCountError: boolean;

  startingSide: StartingSide;
  onStartingSideChange: (side: StartingSide) => void;
  mapSideSelections: Array<StartingSide>;
  onMapSideSelectionsChange: (index: number, side: StartingSide) => void;

  maxRounds: number;
  onMaxRoundsChange: (value: number) => void;

  // Overtime configuration for manual matches
  overtimeEnabled: boolean;
  onOvertimeEnabledChange: (value: boolean) => void;
  overtimeMaxRounds: number | null;
  onOvertimeMaxRoundsChange: (value: number | null) => void;

  playersPerTeam: number;
  onPlayersPerTeamChange: (value: number) => void;
}

/** Standalone match: the game content (CS2: maps) for the series. */
export interface StandaloneContentStepProps {
  activeStep: number;

  maps: string[];
  mapPools: MapPool[];
  availableMaps: MapType[];
  selectedMapPool: string;
  loadingMaps: boolean;
  saving: boolean;
  onMapPoolChange: (poolId: string) => void;
  onMapsChange: (maps: string[]) => void;
  onMapRemove: (mapId: string) => void;
  onOpenSaveMapPool: () => void;

  useVeto: boolean;
  requiredMaps: number;
  selectedMapsCount: number;
  hasVetoMapCountError: boolean;
  hasSeriesMapCountError: boolean;
}

// ---------------------------------------------------------------------------
// Resources (CS2: game servers)
// ---------------------------------------------------------------------------

/** Add or edit one resource. */
export interface ResourceDialogProps {
  open: boolean;
  server: Server | null;
  servers: Server[]; // All existing servers for duplicate checking
  onClose: () => void;
  onSave: (createdIds?: string[]) => void;
}

/** Add many resources at once. */
export interface BatchResourceDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (createdIds?: string[]) => void;
  existingServers?: Server[];
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

/** Admin home: summary card for the game's resources. */
export interface AdminHomeResourcesProps {
  fleet: ServerFleetCounts | null;
  pluginVersions: PluginVersionSummary | null;
}

/** Manage page: live grid of the game's resources and what runs on them. */
export interface ManageResourcesProps {
  servers: ServerAllocationInfo[];
  matches: Match[];
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
  /** Path from `paths.ts`. `admin` routes use it without the leading slash. */
  path: string;
  scope: IntegrationRouteScope;
  element: ReactElement;
}

/**
 * A page link the integration adds to the admin navigation. `key` is also the
 * i18n key suffix each surface already used (`nav.<key>`, `layout.pageTitle.<key>`,
 * `managePage.rail.<key>`, `dashboard.site.<key>`), so labels are unchanged.
 */
export interface IntegrationNavItem {
  key: string;
  path: string;
  icon: SvgIconComponent;
}

// ---------------------------------------------------------------------------
// The admin shell, and starting the tournament
// ---------------------------------------------------------------------------

/**
 * Something the module needs an admin to fix before its tournament can run,
 * shown on every admin page (3.0 phase E).
 *
 * CS2 fills it with the webhook URL — what a CS2 server reaches the platform
 * on — and with the MatchZy plugin's database health, which is the plugin's
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
  /** The way out of a refusal `ownsFailure` claimed. */
  failureView?: ComponentType<TournamentStartFailureProps>;

  /**
   * The setup page's start, which is the same action asked in a different
   * place: it runs the module's check first (`view`), and answers a refusal
   * `ownsFailure` claimed with `failureView` below.
   *
   * There are two failure views rather than one because the two surfaces have
   * always worded the same refusal differently — the dashboard's is literal
   * English and hands the admin to the Servers page, the setup page's is
   * translated into all ten locales and leaves them on the page they are
   * setting up. Folding them into one would change one of those for every CS2
   * install, which is a copy change, not a move.
   */
  preflight?: {
    /** The check itself, which asks only when there is something to ask. */
    view: ComponentType<TournamentStartPreflightProps>;
    /** The way out of a refusal `ownsFailure` claimed, in this surface's words. */
    failureView?: ComponentType<TournamentStartFailureProps>;
  };
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
  availability: ServerAvailabilityResponse | null;
  /** Seconds until the next allocation pass, ticked down locally between polls. */
  nextInSeconds: number | null;
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

export interface ClientGameIntegration {
  id: GameId;

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
   * True for a module that runs every other catalogue game (manual reporting).
   * The registry falls back to it before it falls back to CS2.
   */
  runsAnyCatalogGame?: boolean;

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
  };

  standaloneMatchSteps: {
    rules?: ComponentType<StandaloneRulesStepProps>;
    content?: ComponentType<StandaloneContentStepProps>;
  };

  resourceDialogs: {
    add?: ComponentType<ResourceDialogProps>;
    batchAdd?: ComponentType<BatchResourceDialogProps>;
  };

  dashboardWidgets: {
    adminHomeResources?: ComponentType<AdminHomeResourcesProps>;
    manageResources?: ComponentType<ManageResourcesProps>;
  };

  /** Pages the integration owns. URLs come from `paths.ts`. */
  routes: IntegrationRoute[];

  /**
   * Links to those pages. Each surface places them where its own list had
   * them (see Layout, ManageRail and SiteLinksGrid).
   */
  navItems: IntegrationNavItem[];
}
