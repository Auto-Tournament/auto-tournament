/**
 * The Counter-Strike 2 client integration: every CS2-only component the core
 * pages render goes through one of these slots (see ../types.ts).
 */

import StorageIcon from '@mui/icons-material/Storage';
import MapIcon from '@mui/icons-material/Map';
import type { ClientGameIntegration } from '../types';
import { links } from '../../module-sdk';
import { MatchServerPanel } from './match/MatchServerPanel';
import { ServerAllocationWidget } from './servers/ServerAllocationWidget';
import { AddServerDialog, BatchAddServersDialog } from './servers/ResourceDialogs';
import { ServersOverviewCard } from './servers/ServersOverviewCard';
import { ServerGrid } from './servers/ServerGrid';
import { VetoInterface } from './veto/VetoInterface';
import { MatchVetoHistory } from './veto/MatchVetoHistory';
import { Cs2MatchSettings } from './setup/Cs2MatchSettings';
import { Cs2TournamentMapsStep } from './setup/Cs2TournamentMapsStep';
import { Cs2TournamentReview } from './setup/Cs2TournamentReview';
import { cs2TournamentSetup } from './setup/cs2TournamentSettings';
import { CreateManualMatchModal } from './standalone/CreateManualMatchModal';
import { Cs2AdminWarnings } from './global/Cs2AdminWarnings';
import { Cs2StartConfirm } from './start/Cs2StartConfirm';
import { Cs2StartPreflight } from './start/Cs2StartPreflight';
import {
  Cs2OutdatedServersDialog,
  parseCs2OutdatedError,
} from './start/Cs2OutdatedServersDialog';
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
import { cs2Locales } from './locales';

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
  },

  preMatchView: VetoInterface,
  preMatchHistory: MatchVetoHistory,

  // The webhook URL a CS2 server reaches the platform on, and the Auto Tournament CS2
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

  resourceDialogs: {
    add: AddServerDialog,
    batchAdd: BatchAddServersDialog,
  },

  dashboardWidgets: {
    adminHomeResources: ServersOverviewCard,
    manageResources: ServerGrid,
  },

  // The admin home's "Add a server" row; this module counts its own servers.
  adminHomeSetup: serversSetupItems,

  // At URLs the platform keeps. The Steam connect page these used to include
  // is core's now: Steam is the platform's sign-in, not this game's.
  routes: [
    { path: links.servers(), scope: 'admin', element: <Servers /> },
    { path: links.maps(), scope: 'admin', element: <Maps /> },
  ],

  // Labelled from this module's own strings: `cs2:nav.servers` and so on.
  navItems: [
    { key: 'servers', path: links.servers(), icon: StorageIcon },
    { key: 'maps', path: links.maps(), icon: MapIcon },
  ],
};
