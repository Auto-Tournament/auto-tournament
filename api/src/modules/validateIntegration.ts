/**
 * Check that what a module's server entry exported is a `GameIntegration`
 * (`integrations/types.ts`) before it is registered.
 *
 * TypeScript cannot see a module that was built somewhere else, so the shape
 * is checked at run time: the members every integration must have, and the
 * type of each optional member it does have. A wrong shape is refused with the
 * first problem found, rather than registered and left to fail at the first
 * match that reaches it.
 */

import type { GameIntegration } from '../integrations/types';

const CAPABILITIES = ['servers', 'veto', 'liveEvents', 'demos', 'playerStats'] as const;

const REQUIRED_METHODS = [
  'statsSchema',
  'buildMatchConfig',
  'describeMatch',
  'capacity',
  'allocate',
  'restart',
] as const;

const OPTIONAL_METHODS = [
  'readInstanceSettings',
  'validateTournamentSettings',
  'seed',
  'isReadyToAllocate',
  'onMatchReady',
  'startPendingPreMatchPhases',
  'preMatchTurn',
  'checkStart',
  'prepareStart',
  'resolveBaseUrl',
  'allocateBatch',
  'load',
  'cancel',
  'release',
  'poolStatus',
  'turnoverSeconds',
  'reattach',
  'resourceStatus',
  'seriesPlayerStats',
  'playerStatsColumns',
  'playerStatsMetrics',
  'standaloneRoster',
  'replayEvent',
  'legacyRoutes',
  // An express Router, which is a function.
  'routes',
  'start',
  'stop',
  'healthContributions',
  'refreshPresence',
  'syncMatchState',
] as const;

const OPTIONAL_ARRAYS = ['catalogEntries', 'instanceSettings', 'clientSlots'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The integration a server entry's module namespace holds: its default
 * export, or for a CommonJS file built from ESM, `module.exports.default`.
 */
export function integrationFromNamespace(namespace: unknown): unknown {
  if (!isObject(namespace)) return undefined;
  const candidate = namespace.default;
  if (isObject(candidate) && !('id' in candidate) && isObject(candidate.default)) {
    return candidate.default;
  }
  return candidate;
}

/** The first reason `value` is not a `GameIntegration`, or null when it is one. */
export function integrationProblem(value: unknown): string | null {
  if (!isObject(value)) return 'The server entry has no default export object (a GameIntegration).';

  if (typeof value.id !== 'string' || value.id === '') return "The integration has no string 'id'.";
  if (typeof value.displayName !== 'string' || value.displayName.trim() === '') {
    return "The integration has no 'displayName'.";
  }

  if (!isObject(value.capabilities)) return "The integration has no 'capabilities' object.";
  for (const flag of CAPABILITIES) {
    if (typeof value.capabilities[flag] !== 'boolean') {
      return `'capabilities.${flag}' must be true or false.`;
    }
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof value[method] !== 'function') return `The integration has no '${method}' function.`;
  }
  for (const method of OPTIONAL_METHODS) {
    if (value[method] !== undefined && typeof value[method] !== 'function') {
      return `'${method}' must be a function when present.`;
    }
  }
  for (const key of OPTIONAL_ARRAYS) {
    if (value[key] !== undefined && !Array.isArray(value[key])) {
      return `'${key}' must be an array when present.`;
    }
  }

  if (value.catalog !== undefined && value.catalog !== null && !isObject(value.catalog)) {
    return "'catalog' must be an object or null when present.";
  }
  if (value.runsAnyCatalogGame !== undefined && typeof value.runsAnyCatalogGame !== 'boolean') {
    return "'runsAnyCatalogGame' must be true or false when present.";
  }
  if (value.accountProvider !== undefined && typeof value.accountProvider !== 'string') {
    return "'accountProvider' must be a string when present.";
  }
  if (value.setupSchema !== undefined && !isObject(value.setupSchema)) {
    return "'setupSchema' must be an object when present.";
  }
  if (value.tournamentSettings !== undefined) {
    const handler = value.tournamentSettings;
    if (!isObject(handler)) return "'tournamentSettings' must be an object when present.";
    if (typeof handler.key !== 'string' || handler.key === '') {
      return "'tournamentSettings.key' must be a non-empty string.";
    }
    if (typeof handler.fromRequest !== 'function') {
      return "'tournamentSettings.fromRequest' must be a function.";
    }
    for (const method of ['responseFields', 'changesBracket'] as const) {
      if (handler[method] !== undefined && typeof handler[method] !== 'function') {
        return `'tournamentSettings.${method}' must be a function when present.`;
      }
    }
  }
  // Only the registry's "module not installed" placeholder says this.
  if (value.notInstalled !== undefined) {
    return "'notInstalled' is reserved for the platform's missing-module placeholder.";
  }
  return null;
}

export function isGameIntegration(value: unknown): value is GameIntegration {
  return integrationProblem(value) === null;
}
