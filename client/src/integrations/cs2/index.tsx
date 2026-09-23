/**
 * The Counter-Strike 2 client integration: every CS2-only component the core
 * pages render goes through one of these slots (see ../types.ts).
 */

import StorageIcon from '@mui/icons-material/Storage';
import MapIcon from '@mui/icons-material/Map';
import type { ClientGameIntegration } from '../types';
import { adminRoute, paths } from '../../paths';
import { MatchServerPanel } from './match/MatchServerPanel';
import { ServerAllocationWidget } from './servers/ServerAllocationWidget';
import ServerModal from './servers/ServerModal';
import BatchServerModal from './servers/BatchServerModal';
import { ServersOverviewCard } from './servers/ServersOverviewCard';
import { ServerGrid } from './servers/ServerGrid';
import { VetoInterface } from './veto/VetoInterface';
import { MatchVetoHistory } from './veto/MatchVetoHistory';
import { Cs2MatchSettings } from './setup/Cs2MatchSettings';
import { MapPoolStep } from './setup/MapPoolStep';
import { ManualMatchMapsRulesStep } from './standalone/ManualMatchMapsRulesStep';
import { ManualMatchMapsStep } from './standalone/ManualMatchMapsStep';
import { Cs2AdminWarnings } from './global/Cs2AdminWarnings';
import { Cs2StartConfirm } from './start/Cs2StartConfirm';
import { Cs2StartPreflight } from './start/Cs2StartPreflight';
import {
  Cs2OutdatedServersDialog,
  parseCs2OutdatedError,
} from './start/Cs2OutdatedServersDialog';
import { Cs2SetupOutdatedServersDialog } from './start/Cs2SetupOutdatedServersDialog';
import { Cs2AllocationBanner } from './bracket/Cs2AllocationBanner';
import Servers from './pages/Servers';
import Maps from './pages/Maps';
import ConnectSteam from './pages/ConnectSteam';

export const cs2ClientIntegration: ClientGameIntegration = {
  id: 'cs2',

  // The same slug and aliases the API's cs2Integration claims, so a tournament
  // whose `game` is the catalogue id resolves here rather than falling through
  // to the module that runs anything (3.0 phase D, PR D7).
  catalogGames: ['counter-strike-2', 'cs', 'counter strike', 'csgo'],
  catalogSlug: 'counter-strike-2',

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

  // The webhook URL a CS2 server reaches the platform on, and the MatchZy
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
    cancelPath: paths.servers,
    confirmColor: 'warning',
    ownsFailure: (error) => parseCs2OutdatedError(error) !== null,
    failureView: Cs2OutdatedServersDialog,
    // The same start asked from the setup page, which checks the fleet before
    // it starts rather than describing it, and words a refusal its own way.
    preflight: {
      view: Cs2StartPreflight,
      failureView: Cs2SetupOutdatedServersDialog,
    },
  },

  // A CS2 match waits for a server, so the bracket says which round is waiting
  // and for how many, and the core asks this route what is free right now.
  matchQueueBanner: Cs2AllocationBanner,
  resourceAvailabilityEndpoint: '/api/tournament/server-availability',

  tournamentSetupSteps: {
    rules: Cs2MatchSettings,
    content: MapPoolStep,
  },

  standaloneMatchSteps: {
    rules: ManualMatchMapsRulesStep,
    content: ManualMatchMapsStep,
  },

  resourceDialogs: {
    add: ServerModal,
    batchAdd: BatchServerModal,
  },

  dashboardWidgets: {
    adminHomeResources: ServersOverviewCard,
    manageResources: ServerGrid,
  },

  routes: [
    { path: paths.connectSteam, scope: 'admin-standalone', element: <ConnectSteam /> },
    { path: adminRoute(paths.servers), scope: 'admin', element: <Servers /> },
    { path: adminRoute(paths.maps), scope: 'admin', element: <Maps /> },
  ],

  navItems: [
    { key: 'servers', path: paths.servers, icon: StorageIcon },
    { key: 'maps', path: paths.maps, icon: MapIcon },
  ],
};
