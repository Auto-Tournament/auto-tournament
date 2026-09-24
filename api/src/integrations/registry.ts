/**
 * Registry of game integrations.
 *
 * Core code finds the integration for a match through `integrationForMatch`
 * (or `getIntegration` for a known game id) and must not import a specific
 * integration directly; the boundary lint enforces that.
 */

import { cs2Integration } from './cs2';
import { fakeIntegration, isFakeIntegrationEnabled } from './fake';
import { manualReportIntegration } from './manual-report';
import { slugify } from '../utils/slug';
import { missingModuleIntegration } from '../core/missingModule';
import { DEFAULT_GAME, type GameId, type GameIntegration } from './types';

export class UnknownGameError extends Error {
  constructor(public readonly game: GameId) {
    super(`No game integration registered for '${game}'`);
    this.name = 'UnknownGameError';
  }
}

const integrations = new Map<GameId, GameIntegration>();

/** Register an integration. Built-ins are registered below. */
export function registerIntegration(integration: GameIntegration): void {
  if (integrations.has(integration.id)) {
    throw new Error(`Game integration '${integration.id}' is already registered`);
  }
  integrations.set(integration.id, integration);
}

registerIntegration(cs2Integration);

// CS2 first: the two overlap on nothing, but `integrationForGameRef` resolves
// claimed catalogue slugs in registration order, so the module that owns a
// game outright is asked before the one that runs anything (3.0 phase D2).
registerIntegration(manualReportIntegration);

// Test runs only (NODE_ENV=test, or MAT_TEST_INTEGRATION=1; a production
// process also needs ENABLE_TEST_ENDPOINTS): the fake game that proves the
// core runs a tournament without CS2. See integrations/fake.
if (isFakeIntegrationEnabled()) {
  registerIntegration(fakeIntegration);
}

export function getIntegration(game: GameId): GameIntegration {
  const integration = integrations.get(game);
  if (!integration) throw new UnknownGameError(game);
  return integration;
}

export function hasIntegration(game: GameId): boolean {
  return integrations.has(game);
}

export function listIntegrations(): GameIntegration[] {
  return [...integrations.values()];
}

/**
 * The catalogue games an integration claims: its own id, its `games.slug` and
 * that entry's aliases, plus every extra entry it ships (`catalogEntries`, the
 * manual-report module's titles). An integration kept out of the catalogue
 * (`catalog: null`, the test-only fake) claims only its id and its extra
 * entries.
 */
function claimedGameRefs(integration: GameIntegration): string[] {
  const refs = [integration.id];
  if (integration.catalog !== null) {
    refs.push(integration.catalog?.slug || slugify(integration.displayName));
    refs.push(...(integration.catalog?.aliases ?? []));
  }
  for (const entry of integration.catalogEntries ?? []) {
    refs.push(entry.slug, ...(entry.aliases ?? []));
  }
  return refs;
}

/**
 * The integration behind a `game` value, or null when this instance has no
 * module for it.
 *
 * A `game` column holds an integration id today ('cs2') and a game catalogue
 * id from 3.0 phase D onwards ('rocket-league', ...), because a module like
 * manual-report runs many catalogue games and the row has to say which one.
 * So the lookup goes: the integration's own id, then its catalogue slug and
 * aliases, then an integration that runs any catalogue game
 * (`runsAnyCatalogGame`, the manual-report module from phase D2).
 */
export function integrationForGameRef(ref: string): GameIntegration | null {
  return resolveGameRef(ref, listIntegrations());
}

/**
 * `integrationForGameRef` over a given list of installed modules, in
 * registration order. Exported so a spec can ask what an instance with a
 * different set of modules would resolve — one without CS2, or without the
 * catch-all — without unregistering anything.
 */
export function resolveGameRef(
  ref: string,
  installed: readonly GameIntegration[]
): GameIntegration | null {
  const wanted = ref.trim().toLowerCase();
  if (!wanted) return null;

  const direct = installed.find((integration) => integration.id === wanted);
  if (direct) return direct;

  for (const integration of installed) {
    if (claimedGameRefs(integration).some((claim) => claim.toLowerCase() === wanted)) {
      return integration;
    }
  }

  for (const integration of installed) {
    if (integration.runsAnyCatalogGame) return integration;
  }
  return null;
}

/**
 * The integration that owns a match (or tournament / template) row, or the
 * "module not installed" placeholder (`core/missingModule`) when this instance
 * has none for it. Never throws, and never answers CS2 for a row that is not
 * CS2's.
 *
 * Rows read before the `game` column existed, or selected without it, belong
 * to CS2 (`DEFAULT_GAME`). So does a row whose `game` is 'cs2' — the column
 * default. Both resolve to the CS2 module when it is installed and to the
 * placeholder when it is not: a CS2 tournament is not a manually reported one
 * just because the catch-all module would take any string.
 */
export function integrationForMatch(row: { game?: GameId | null }): GameIntegration {
  return resolveIntegrationForRow(row, listIntegrations());
}

/** `integrationForMatch` over a given list of installed modules; see `resolveGameRef`. */
export function resolveIntegrationForRow(
  row: { game?: GameId | null },
  installed: readonly GameIntegration[]
): GameIntegration {
  const game = row.game || DEFAULT_GAME;
  if (game.trim().toLowerCase() === DEFAULT_GAME) {
    return (
      installed.find((integration) => integration.id === DEFAULT_GAME) ??
      missingModuleIntegration(DEFAULT_GAME)
    );
  }
  return resolveGameRef(game, installed) ?? missingModuleIntegration(game);
}
