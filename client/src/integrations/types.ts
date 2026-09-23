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
import type { MapPool, Map as MapType } from '../types/api.types';
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
   * Admin area, `/disputes`: what this module needs an admin to settle (D8).
   * Left empty by a game whose results come from the game itself.
   */
  adminDisputesView?: ComponentType<AdminDisputesViewProps>;

  /** Shown to the teams before the match can be allocated (CS2: map veto). */
  preMatchView?: ComponentType<PreMatchViewProps>;
  /** Record of the pre-match phase, shown on the match details. */
  preMatchHistory?: ComponentType<PreMatchHistoryProps>;

  tournamentSetupSteps: {
    rules?: ComponentType<TournamentRulesStepProps>;
    content?: ComponentType<TournamentContentStepProps>;
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
