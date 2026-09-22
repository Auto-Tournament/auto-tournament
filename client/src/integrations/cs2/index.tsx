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
import Servers from './pages/Servers';
import Maps from './pages/Maps';
import ConnectSteam from './pages/ConnectSteam';

export const cs2ClientIntegration: ClientGameIntegration = {
  id: 'cs2',

  matchPanels: {
    teamView: MatchServerPanel,
    adminView: ServerAllocationWidget,
  },

  preMatchView: VetoInterface,
  preMatchHistory: MatchVetoHistory,

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
