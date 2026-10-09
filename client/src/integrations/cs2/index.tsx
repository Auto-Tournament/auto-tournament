/**
 * The Counter-Strike 2 client integration: every CS2-only component the core
 * pages render goes through one of these slots (see ../types.ts).
 */

import { vetoMapPickers } from './veto/vetoMapPickers';
import { Cs2ProfileStats } from './profile/Cs2ProfileStats';
import { useCs2PlayerHighlights } from './profile/useCs2PlayerHighlights';
import { Cs2TeamProfileStats } from './profile/Cs2TeamProfileStats';
import {
  HardDrivesIcon,
  MapTrifoldIcon,
  SlidersHorizontalIcon,
  KnifeIcon,
  FilmStripIcon,
} from '@phosphor-icons/react';
import type { ClientGameIntegration, PlayerProfileViewProps } from '../types';
import { links } from '../../module-sdk';
import { MatchServerPanel } from './match/MatchServerPanel';
import { Cs2MatchAdminView } from './match/Cs2MatchAdminView';
import { ServerAllocationWidget } from './servers/ServerAllocationWidget';
import { ServersOverviewCard } from './servers/ServersOverviewCard';
import { ServerGrid } from './servers/ServerGrid';
import { VetoInterface } from './veto/VetoInterface';
import { MatchVetoHistory } from './veto/MatchVetoHistory';
import { Cs2RosterSteamStatus } from './roster/Cs2RosterSteamStatus';
import { Cs2MatchSettings } from './setup/Cs2MatchSettings';
import { Cs2TournamentMapsStep } from './setup/Cs2TournamentMapsStep';
import { Cs2TournamentReview } from './setup/Cs2TournamentReview';
import { cs2TournamentSetup } from './setup/cs2TournamentSettings';
import { CreateManualMatchModal } from './standalone/CreateManualMatchModal';
import { Cs2AdminWarnings } from './global/Cs2AdminWarnings';
import { Cs2StartConfirm } from './start/Cs2StartConfirm';
import { Cs2StartPreflight } from './start/Cs2StartPreflight';
import { Cs2OutdatedServersDialog, parseCs2OutdatedError } from './start/Cs2OutdatedServersDialog';
import { Cs2AllocationBanner } from './bracket/Cs2AllocationBanner';
import { Cs2NextAllocationChip } from './bracket/Cs2NextAllocationChip';
import {
  Cs2MatchAllocationStatus,
  Cs2MatchListAllocationBanner,
  Cs2MatchListAllocationCountdown,
} from './match/Cs2MatchListQueue';
import { Cs2ServersFreeTile } from './manage/Cs2ServersFreeTile';
import {
  serverNeedsYouItems,
  serversSetupItems,
  summarizeServerAvailability,
} from './manage/cs2QueueSummary';
import Servers from './pages/Servers';
import Maps from './pages/Maps';
import HighlightsAdmin from './pages/Highlights';
import { MatchRulesPage } from './settings/MatchRulesPage';
import { SkinsAdminPage } from './skins/SkinsAdminPage';
import { cs2AdminPaths } from './adminPaths';
import { InventoryPage } from './skins/InventoryPage';
import { NewSkinReveal } from './skins/NewSkinReveal';
import { ProfileLoadout } from './skins/ProfileLoadout';
import { MapActions } from './demos/MapActions';
import { highlightPaths } from './highlights/data';
import { PlayerHighlightsPage } from './highlights/PlayerHighlightsPage';
import { TournamentHighlightsTab, TournamentReelSection } from './highlights/TournamentHighlights';
import { WatchPage } from './highlights/WatchPage';
import { MatchPublicPanel } from './highlights/MatchPublicPanel';
import { DemoAnalysisPage } from './demos/DemoAnalysisPage';
import { demoPaths } from './demos/paths';
import { skinPaths } from './skins/paths';
import { skinsAccountMenuItems } from './skins/useSkins';
import { cs2Locales } from './locales';

/**
 * The profile's CS2 tab: the stats, then the player's loadout. Highlights are
 * core's section, from `usePlayerHighlights`.
 */
function Cs2ProfileView(props: PlayerProfileViewProps) {
  return (
    <>
      <Cs2ProfileStats {...props} />
      <ProfileLoadout steamId={props.playerId} isOwn={!!props.isOwn} />
    </>
  );
}

export const cs2ClientIntegration: ClientGameIntegration = {
  id: 'cs2',

  // Its strings, namespace 'cs2': the Servers and Maps pages, veto, the
  // server panels and its nav labels (item 6).
  locales: cs2Locales,

  // The same slug and aliases the API's cs2Integration claims, so a tournament
  // whose `game` is the catalogue id resolves here rather than falling through
  // to the module that runs anything (3.0 phase D, PR D7).
  catalogGames: ['counter-strike-2', 'cs', 'counter strike', 'csgo'],
  catalogSlug: 'counter-strike-2',
  catalogIcon: '/games/counter-strike-2.svg',

  // The same five facts `cs2Integration.capabilities` states on the API side.
  capabilities: {
    servers: true,
    veto: true,
    liveEvents: true,
    demos: true,
    playerStats: true,
  },

  matchPanels: {
    teamView: MatchServerPanel,
    adminView: ServerAllocationWidget,
    // Failover (Ready Up servers), then round backups and "restore to round
    // N" over the fleet link or RCON.
    adminMatchView: Cs2MatchAdminView,
    // A finished match's public page: team reels, scoreboard, highlights.
    publicView: MatchPublicPanel,
  },

  preMatchView: VetoInterface,
  preMatchHistory: MatchVetoHistory,
  mapPickers: vetoMapPickers,

  // The player profile: aim, utility, impact and the map strength radar.
  playerProfileView: Cs2ProfileView,
  // The team page: map strength, and the maps the team bans and picks.
  teamProfileView: Cs2TeamProfileStats,

  // The team page roster: whether the roster has a Steam account for each
  // member, which a CS2 player needs to join the server.
  rosterMemberStatus: Cs2RosterSteamStatus,

  // A team's jobs and size, for the team pages (strings: teamPositions.*).
  teamPositions: ['rifler', 'awper', 'igl', 'entry', 'support', 'lurker'],
  teamSize: 5,

  // The webhook URL a CS2 server reaches the platform on, and the MatchZy Enhanced
  // plugin's own database: both are settings only this game has, so the
  // shell's warnings about them are this module's (3.0 phase E).
  adminGlobalWarning: Cs2AdminWarnings,

  // Starting a CS2 tournament means allocating servers, so the dialog talks
  // about servers, and a refusal about out-of-date ones is answered here. The
  // labels are the ones the button has always shown.
  tournamentStart: {
    confirmView: Cs2StartConfirm,
    confirmLabel: 'Yes, Start Anyway',
    cancelLabel: 'Check Servers',
    cancelPath: links.servers(),
    confirmColor: 'warning',
    ownsFailure: (error) => parseCs2OutdatedError(error) !== null,
    failureView: Cs2OutdatedServersDialog,
    // The same start asked from the setup page, which checks the fleet before
    // it starts rather than describing it, and answers a refusal with the same
    // dialog the dashboard's start does.
    preflight: {
      view: Cs2StartPreflight,
    },
  },

  // A CS2 match waits for a server, so the bracket says which round is waiting
  // and for how many, and the core asks this route what is free right now.
  matchQueueBanner: Cs2AllocationBanner,
  matchQueueChip: Cs2NextAllocationChip,

  // The match list's three sizes of the same wait: when the next pass runs,
  // again in the toolbar, and when this one match expects a server.
  matchListQueue: {
    banner: Cs2MatchListAllocationBanner,
    countdown: Cs2MatchListAllocationCountdown,
    cardStatus: Cs2MatchAllocationStatus,
  },

  // The Manage strip's one tile that counts servers rather than matches.
  manageStatusTile: Cs2ServersFreeTile,

  // The queue counts core shows itself, and the Manage console's rows about
  // servers, read out of this module's own availability answer.
  summarizeAvailability: summarizeServerAvailability,
  manageNeedsYou: serverNeedsYouItems,

  resourceAvailabilityEndpoint: '/api/tournament/server-availability',

  // Round rules and the map pool: CS2's own object in the tournament's
  // settings (`settings.cs2`), which the steps edit and load data for
  // themselves, and the model answers the wizard's questions about (item 8b).
  tournamentSetupSteps: {
    rules: Cs2MatchSettings,
    content: Cs2TournamentMapsStep,
    review: Cs2TournamentReview,
  },
  tournamentSetup: cs2TournamentSetup,

  // A match outside the bracket: the whole form is CS2's, core only opens it.
  standaloneMatch: CreateManualMatchModal,

  // No "add a server" dialog: CS2 servers come only through csm, made on a
  // machine on the Servers page (setup's button opens that page).
  resourceDialogs: {},

  dashboardWidgets: {
    adminHomeResources: ServersOverviewCard,
    manageResources: ServerGrid,
  },

  // The admin home's "Add a server" row; this module counts its own servers.
  adminHomeSetup: serversSetupItems,

  // Admin tools: RCON on its servers and their live event feed (core's until
  // the module split, client API 0.2.2). Its settings are its own rail pages:
  // Skins and Match rules.
  // Virtual skins (skins/): the inventory pages, the Inventory link while
  // skins are on, the "new skin" reveal, and the loadout on profiles.
  accountMenuItems: skinsAccountMenuItems,
  globalOverlay: NewSkinReveal,

  // Each map's match reel and analysis, once the worker made them.
  matchMapAction: MapActions,

  // Highlights: the player's on their profile (core's section), the
  // tournament's own tab, and its reel on the results.
  usePlayerHighlights: useCs2PlayerHighlights,
  tournamentTab: { path: 'highlights', labelKey: 'highlights.title', Component: TournamentHighlightsTab },
  tournamentResultsSection: TournamentReelSection,

  // At URLs the platform keeps. The Steam connect page these used to include
  // is core's now: Steam is the platform's sign-in, not this game's.
  routes: [
    { path: links.servers(), scope: 'admin', element: <Servers /> },
    { path: links.maps(), scope: 'admin', element: <Maps /> },
    { path: cs2AdminPaths.skins, scope: 'admin', element: <SkinsAdminPage /> },
    { path: cs2AdminPaths.matchRules, scope: 'admin', element: <MatchRulesPage /> },
    { path: cs2AdminPaths.highlights, scope: 'admin', element: <HighlightsAdmin /> },
    { path: skinPaths.inventory, scope: 'site', element: <InventoryPage /> },
    { path: skinPaths.playerInventory, scope: 'site', element: <InventoryPage /> },
    { path: demoPaths.analysis, scope: 'site', element: <DemoAnalysisPage /> },
    { path: highlightPaths.player, scope: 'site', element: <PlayerHighlightsPage /> },
    { path: highlightPaths.watch, scope: 'site', element: <WatchPage /> },
  ],

  // Labelled from this module's own strings: `cs2:nav.servers` and so on.
  // The icons are this module's own Phosphor ones; the rail sizes them.
  navItems: [
    { key: 'servers', path: links.servers(), icon: HardDrivesIcon },
    { key: 'maps', path: links.maps(), icon: MapTrifoldIcon },
    { key: 'skins', path: cs2AdminPaths.skins, icon: KnifeIcon },
    { key: 'matchRules', path: cs2AdminPaths.matchRules, icon: SlidersHorizontalIcon },
    { key: 'highlights', path: cs2AdminPaths.highlights, icon: FilmStripIcon },
  ],
};
