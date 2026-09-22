/**
 * Registry of game integrations.
 *
 * Core code finds the integration for a match through `integrationForMatch`
 * (or `getIntegration` for a known game id) and must not import a specific
 * integration directly; the boundary lint enforces that.
 */

import { cs2Integration } from './cs2';
import { fakeIntegration, isFakeIntegrationEnabled } from './fake';
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
 * The integration that owns a match (or tournament / template) row. Rows read
 * before the `game` column existed, or selected without it, belong to CS2.
 */
export function integrationForMatch(row: { game?: GameId | null }): GameIntegration {
  return getIntegration(row.game || DEFAULT_GAME);
}
