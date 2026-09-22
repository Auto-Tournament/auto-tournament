/**
 * Registry of game integrations.
 *
 * Core code finds the integration for a match through `integrationForMatch`
 * (or `getIntegration` for a known game id) and must not import a specific
 * integration directly; the boundary lint enforces that.
 */

import { cs2Integration } from './cs2';
import { fakeIntegration, isFakeIntegrationEnabled } from './fake';
import { slugify } from '../utils/slug';
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
 * that entry's aliases. An integration kept out of the catalogue (`catalog:
 * null`, the test-only fake) claims only its id.
 */
function claimedGameRefs(integration: GameIntegration): string[] {
  const refs = [integration.id];
  if (integration.catalog === null) return refs;
  refs.push(integration.catalog?.slug || slugify(integration.displayName));
  refs.push(...(integration.catalog?.aliases ?? []));
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
 * (`runsAnyCatalogGame`, the manual-report module from phase D2; nothing
 * declares it yet).
 */
export function integrationForGameRef(ref: string): GameIntegration | null {
  const wanted = ref.trim().toLowerCase();
  if (!wanted) return null;

  const direct = integrations.get(wanted);
  if (direct) return direct;

  for (const integration of integrations.values()) {
    if (claimedGameRefs(integration).some((claim) => claim.toLowerCase() === wanted)) {
      return integration;
    }
  }

  for (const integration of integrations.values()) {
    if (integration.runsAnyCatalogGame) return integration;
  }
  return null;
}

/**
 * The integration that owns a match (or tournament / template) row. Rows read
 * before the `game` column existed, or selected without it, belong to CS2.
 */
export function integrationForMatch(row: { game?: GameId | null }): GameIntegration {
  const game = row.game || DEFAULT_GAME;
  const integration = integrationForGameRef(game);
  if (!integration) throw new UnknownGameError(game);
  return integration;
}
