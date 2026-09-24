/**
 * The only way core client code reaches a game integration (mirrors
 * api/src/integrations/registry.ts).
 *
 * Core asks for the integration that owns a tournament or match by its `game`
 * field. A missing `game` is CS2's, the same way the API treats it (column
 * default 'cs2'). A game no installed module runs is the "module not
 * installed" placeholder (`utils/moduleResolution`), never CS2.
 */

import { cs2ClientIntegration } from './cs2';
import { manualReportClientIntegration } from './manual-report';
import { resolveIntegration } from '../utils/moduleResolution';
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
 * The integration behind a `game` value, or the "module not installed"
 * placeholder when this instance has none for it.
 *
 * Mirrors `integrationForMatch` in `api/src/integrations/registry.ts`: a
 * `game` column holds an integration id today ('cs2') and a game catalogue id
 * from 3.0 phase D onwards ('rocket-league'), because a module like
 * manual-report runs many catalogue games and the row has to say which one. So
 * the lookup goes: the integration's own id, then the catalogue ids it claims,
 * then an integration that runs any catalogue game.
 *
 * A row with no `game` at all is a response from before the column existed,
 * and belongs to CS2 — that is `DEFAULT_GAME`, not "unknown". When CS2 is not
 * installed, it and a `game` of 'cs2' get the placeholder, as does a game no
 * module claims or runs. The placeholder is valid in every slot (all empty,
 * every capability false), so a caller never has to check for it to not
 * crash; see `utils/moduleResolution`.
 */
export function getIntegration(game: GameId | null | undefined): ClientGameIntegration {
  return resolveIntegration(game, listIntegrations());
}

/**
 * The catalogue id for a `game` value, or undefined when there is none.
 *
 * `game` holds a catalogue slug from 3.0 phase D onwards ('rocket-league'),
 * and an integration id for a module's own game ('cs2'). Pages that name a
 * game the way the catalogue does — the browse list's filter and its game
 * mark — want the slug either way. A module that is not a game ('manual-report',
 * meaning "a game this instance has no catalogue row for") has none.
 */
export function catalogSlugFor(game: GameId | null | undefined): string | undefined {
  const wanted = (game || DEFAULT_GAME).trim().toLowerCase();
  const integration = getIntegration(wanted);
  return integration.id === wanted ? integration.catalogSlug : wanted;
}

/** The integration that owns a tournament or match row (by its `game`). */
export function integrationFor(row: GameOwned | null | undefined): ClientGameIntegration {
  return getIntegration(row?.game);
}
