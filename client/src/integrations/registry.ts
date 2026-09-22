/**
 * The only way core client code reaches a game integration (mirrors
 * api/src/integrations/registry.ts).
 *
 * Core asks for the integration that owns a tournament or match by its `game`
 * field. Unknown or missing ids fall back to CS2, the only installed
 * integration, the same way the API treats `game` (column default 'cs2').
 */

import { cs2ClientIntegration } from './cs2';
import { DEFAULT_GAME, type ClientGameIntegration, type GameId, type GameOwned } from './types';

const INTEGRATIONS: Record<string, ClientGameIntegration> = {
  [cs2ClientIntegration.id]: cs2ClientIntegration,
};

export function listIntegrations(): ClientGameIntegration[] {
  return Object.values(INTEGRATIONS);
}

export function getIntegration(game: GameId | null | undefined): ClientGameIntegration {
  return INTEGRATIONS[game || DEFAULT_GAME] ?? INTEGRATIONS[DEFAULT_GAME];
}

/** The integration that owns a tournament or match row (by its `game`). */
export function integrationFor(row: GameOwned | null | undefined): ClientGameIntegration {
  return getIntegration(row?.game);
}

/**
 * The instance-wide integration, for pages that are not about one tournament
 * or match (navigation, admin home, the server and map pages). 3.0 runs one
 * game per instance, so this is CS2.
 */
export function instanceIntegration(): ClientGameIntegration {
  return getIntegration(DEFAULT_GAME);
}
