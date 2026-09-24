/**
 * The platform's live core modules, handed to code modules' server halves
 * (DESIGN-modules §10.3). See `hostModules.ts` for why and for the list.
 *
 * A module bundle reads `globalThis.__AT_HOST__.module('utils/logger')` where
 * its source said `import { log } from '../../utils/logger'`, and gets this
 * process's own instance: the pool `db.init()` opened, the socket server the
 * app started. Each export is a getter, so a binding the core reassigns is
 * read as it is now, like an ES module's live binding.
 *
 * Installed at boot, before the first disk module is imported.
 */

import * as configDataDir from '../config/dataDir';
import * as configDatabase from '../config/database';
import * as configPublicPaths from '../config/publicPaths';
import * as coreAllocationQueue from '../core/allocationQueue';
import * as coreMatchLifecycle from '../core/matchLifecycle';
import * as coreScheduler from '../core/scheduler';
import * as middlewareAuth from '../middleware/auth';
import * as middlewareServerAuth from '../middleware/serverAuth';
import * as matchConfigFetchTracker from '../services/matchConfigFetchTracker';
import * as matchLiveStatsService from '../services/matchLiveStatsService';
import * as matchMapResultService from '../services/matchMapResultService';
import * as matchTerminationService from '../services/matchTerminationService';
import * as playerConnectionService from '../services/playerConnectionService';
import * as settingsService from '../services/settingsService';
import * as socketService from '../services/socketService';
import * as cs2Version from '../utils/cs2Version';
import * as eventLogger from '../utils/eventLogger';
import * as logger from '../utils/logger';
import * as matchIntegration from '../utils/matchIntegration';
import * as matchStatusHelpers from '../utils/matchStatusHelpers';
import * as playerTransform from '../utils/playerTransform';
import * as pluginServerReplies from '../utils/pluginServerReplies';
import * as serverAttribution from '../utils/serverAttribution';
import * as settingFields from '../utils/settingFields';
import * as simulationTimescale from '../utils/simulationTimescale';
import * as tournamentRow from '../utils/tournamentRow';
import * as viewerIdentity from '../utils/viewerIdentity';
import { HOST_GLOBAL, HOST_MODULES } from './hostModules';
import { SERVER_API_VERSION } from './version';

const MODULES: Record<string, object> = {
  'config/dataDir': configDataDir,
  'config/database': configDatabase,
  'config/publicPaths': configPublicPaths,
  'core/allocationQueue': coreAllocationQueue,
  'core/matchLifecycle': coreMatchLifecycle,
  'core/scheduler': coreScheduler,
  'middleware/auth': middlewareAuth,
  'middleware/serverAuth': middlewareServerAuth,
  'services/matchConfigFetchTracker': matchConfigFetchTracker,
  'services/matchLiveStatsService': matchLiveStatsService,
  'services/matchMapResultService': matchMapResultService,
  'services/matchTerminationService': matchTerminationService,
  'services/playerConnectionService': playerConnectionService,
  'services/settingsService': settingsService,
  'services/socketService': socketService,
  'utils/cs2Version': cs2Version,
  'utils/eventLogger': eventLogger,
  'utils/logger': logger,
  'utils/matchIntegration': matchIntegration,
  'utils/matchStatusHelpers': matchStatusHelpers,
  'utils/playerTransform': playerTransform,
  'utils/pluginServerReplies': pluginServerReplies,
  'utils/serverAttribution': serverAttribution,
  'utils/settingFields': settingFields,
  'utils/simulationTimescale': simulationTimescale,
  'utils/tournamentRow': tournamentRow,
  'utils/viewerIdentity': viewerIdentity,
};

/** The names the bridge exports, for the spec that keeps it and the list equal. */
export function bridgedModuleNames(): string[] {
  return Object.keys(MODULES).sort();
}

const exposed = new Map<string, object>();

/**
 * A module as a bundle sees it: an `__esModule` object whose every export is
 * a getter onto the platform's own namespace.
 */
function expose(name: string): object {
  const cached = exposed.get(name);
  if (cached) return cached;
  const namespace = MODULES[name] as Record<string, unknown> | undefined;
  if (!namespace || !HOST_MODULES.includes(name)) {
    throw new Error(
      `A code module imported the platform's '${name}', which this platform does not share with modules (server API ${SERVER_API_VERSION}).`
    );
  }
  const view: Record<string, unknown> = {};
  Object.defineProperty(view, '__esModule', { value: true });
  for (const key of Object.keys(namespace)) {
    if (key === '__esModule') continue;
    Object.defineProperty(view, key, { enumerable: true, get: () => namespace[key] });
  }
  Object.freeze(view);
  exposed.set(name, view);
  return view;
}

export interface HostBridge {
  serverApi: string;
  module(name: string): object;
}

/** Put the bridge where module bundles look for it. Idempotent. */
export function installHostBridge(): void {
  const target = globalThis as unknown as Record<string, HostBridge | undefined>;
  if (target[HOST_GLOBAL]) return;
  target[HOST_GLOBAL] = Object.freeze({ serverApi: SERVER_API_VERSION, module: expose });
}
