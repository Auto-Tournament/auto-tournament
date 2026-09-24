/**
 * The manual-reporting client integration (3.0 phase D, PR D7).
 *
 * Mirrors `api/src/integrations/manual-report`: the module is not a game, it
 * is the way a result reaches MAT when the game cannot send one itself. So it
 * fills exactly three slots — the report panel on a team's match page, the
 * admin control that appoints the captain who may use it, and the admin
 * dispute queue (3.0 phase D, PR D8) — and leaves the CS2 shaped ones (veto,
 * servers, maps, map pools) empty.
 *
 * `runsAnyCatalogGame` mirrors what the API's registry resolves: a
 * tournament's `game` holds a catalogue id from phase D onwards
 * ('rocket-league'), and anything this instance has no other module for is
 * reported manually. The module ships no list of games — those are packs,
 * installed on the instance — so there is no `catalogGames` to keep in step
 * with the API.
 */

import type { ClientGameIntegration } from '../types';
import { DisputesQueue } from './admin/DisputesQueue';
import { ManualReportPanel } from './match/ManualReportPanel';
import { ManualReportSetupStep } from './setup/ManualReportSetupStep';
import { CustomStatsTables } from './stats/CustomStatsTables';
import { TeamCaptainsCard } from './team/TeamCaptainsCard';
import { manualReportLocales } from './locales';
export const manualReportClientIntegration: ClientGameIntegration = {
  id: 'manual-report',

  // Its strings, namespace 'manual-report' (item 6).
  locales: manualReportLocales,

  runsAnyCatalogGame: true,

  // The same five facts `manualReportIntegration.capabilities` states on the
  // API side: nothing runs anywhere, nothing is measured, nothing is recorded.
  capabilities: {
    servers: false,
    veto: false,
    liveEvents: false,
    demos: false,
    playerStats: false,
  },

  matchPanels: {
    reportView: ManualReportPanel,
  },

  teamAdminPanel: TeamCaptainsCard,

  adminDisputesView: DisputesQueue,

  tournamentStatsView: CustomStatsTables,

  tournamentSetupSteps: {
    settings: ManualReportSetupStep,
  },
  standaloneMatchSteps: {},
  resourceDialogs: {},
  dashboardWidgets: {},

  routes: [],
  navItems: [],
};
