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
 * `catalogGames` and `runsAnyCatalogGame` mirror what the API's registry
 * resolves: a tournament's `game` holds a catalogue id from phase D onwards
 * ('rocket-league'), and anything this instance has no other module for is
 * reported manually.
 */

import type { ClientGameIntegration } from '../types';
import { DisputesQueue } from './admin/DisputesQueue';
import { ManualReportPanel } from './match/ManualReportPanel';
import { ManualReportSetupStep } from './setup/ManualReportSetupStep';
import { CustomStatsTables } from './stats/CustomStatsTables';
import { TeamCaptainsCard } from './team/TeamCaptainsCard';

/**
 * The titles the module ships ready to run, the same list as the API's
 * `MANUAL_REPORT_CATALOG`. `runsAnyCatalogGame` already catches everything
 * else; these are named so the two registries resolve the same way even if
 * that fallback changes.
 */
const MANUAL_REPORT_GAMES = [
  'rocket-league',
  'valorant',
  'league-of-legends',
  'dota-2',
  'deadlock',
  'overwatch-2',
  'rainbow-six-siege',
  'battlefield-6',
  'trackmania',
  'chess',
  'minecraft',
  'ea-sports-fc-25',
  'super-smash-bros-ultimate',
  'street-fighter-6',
  'tekken-8',
  'osu',
  'team-fortress-2',
  'age-of-empires-ii',
];

export const manualReportClientIntegration: ClientGameIntegration = {
  id: 'manual-report',

  catalogGames: MANUAL_REPORT_GAMES,
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
