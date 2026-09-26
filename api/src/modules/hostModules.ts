/**
 * The core modules a code module's server half may import, by their path
 * under `api/src` without extension (DESIGN-modules §10.3).
 *
 * A code module is bundled on its own, so an import of one of these would
 * otherwise be a second copy — a database pool nobody initialised, a socket
 * server nobody started. The module build (`scripts/modules/cs2/build.ts`)
 * turns each such import into a read of the platform's live instance from
 * `globalThis.__AT_HOST__` (`hostBridge.ts`), and refuses to build a module
 * that needs one not listed here.
 *
 * Data only, so the build script can read it without loading the modules.
 * This list is the server API surface: removing a name is a server API major
 * (`SERVER_API_VERSION`), adding one a minor. Today it is exactly what CS2
 * uses.
 */
export const HOST_MODULES: readonly string[] = [
  'config/dataDir',
  'config/database',
  'config/publicPaths',
  'core/allocationQueue',
  'core/matchLifecycle',
  'core/scheduler',
  'middleware/auth',
  'middleware/serverAuth',
  'services/adminCallService',
  'services/matchConfigFetchTracker',
  'services/matchLiveStatsService',
  'services/matchMapResultService',
  'services/matchTerminationService',
  'services/playerConnectionService',
  'services/settingsService',
  'services/socketService',
  'types/adminCall.types',
  'utils/cs2Version',
  'utils/eventLogger',
  'utils/logger',
  'utils/matchIntegration',
  'utils/matchStatusHelpers',
  'utils/playerTransform',
  'utils/pluginServerReplies',
  'utils/serverAttribution',
  'utils/settingFields',
  'utils/simulationTimescale',
  'utils/tournamentRow',
  'utils/viewerIdentity',
];

/** Where the platform keeps the bridge for a code module's bundle to read. */
export const HOST_GLOBAL = '__AT_HOST__';
