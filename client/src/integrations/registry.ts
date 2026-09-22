/**
 * The only way core client code reaches a game integration (mirrors
 * api/src/integrations/registry.ts).
 *
 * Core asks for the integration that owns a tournament or match by its `game`
 * field. Unknown or missing ids fall back to CS2, the only installed
 * integration, the same way the API treats `game` (column default 'cs2').
 */

import { cs2ClientIntegration } from './cs2';
import { manualReportClientIntegration } from './manual-report';
import { DEFAULT_GAME, type ClientGameIntegration, type GameId, type GameOwned } from './types';

// CS2 first, the same order the API registers them in: the two overlap on
// nothing, but a claimed catalogue slug is resolved in registration order, so
// the module that owns a game outright is asked before the one that runs
// anything.
const INTEGRATIONS: Record<string, ClientGameIntegration> = {
  [cs2ClientIntegration.id]: cs2ClientIntegration,
  [manualReportClientIntegration.id]: manualReportClientIntegration,
};

export function listIntegrations(): ClientGameIntegration[] {
  return Object.values(INTEGRATIONS);
}

/**
 * The integration behind a `game` value.
 *
 * Mirrors `integrationForGameRef` in `api/src/integrations/registry.ts`: a
 * `game` column holds an integration id today ('cs2') and a game catalogue id
 * from 3.0 phase D onwards ('rocket-league'), because a module like
 * manual-report runs many catalogue games and the row has to say which one. So
 * the lookup goes: the integration's own id, then the catalogue ids it claims,
 * then an integration that runs any catalogue game.
 *
 * A row with no `game` at all is a response from before the column existed,
 * and belongs to CS2 — that is `DEFAULT_GAME`, not "unknown".
 */
export function getIntegration(game: GameId | null | undefined): ClientGameIntegration {
  const wanted = (game || DEFAULT_GAME).trim().toLowerCase();

  const direct = INTEGRATIONS[wanted];
  if (direct) return direct;

  for (const integration of listIntegrations()) {
    if (integration.catalogGames?.some((claim) => claim.toLowerCase() === wanted)) {
      return integration;
    }
  }

  for (const integration of listIntegrations()) {
    if (integration.runsAnyCatalogGame) return integration;
  }

  return INTEGRATIONS[DEFAULT_GAME];
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
