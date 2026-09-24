/**
 * How the client registry turns a `game` value into a module, and what it
 * answers when this instance has none (mirrors `api/src/core/missingModule.ts`
 * and `resolveIntegrationForRow` in `api/src/integrations/registry.ts`).
 *
 * It lives outside `integrations/registry.ts` so it imports no module: the
 * registry imports every installed module's components, and a spec running in
 * Node checks this lookup against a list of its own instead.
 *
 * The placeholder is core, not an integration. It is never in the registry's
 * list, so it adds no route, no nav item and no chrome. Every optional slot is
 * empty and every capability false, so any page that renders a module's slots
 * renders nothing game-specific for it rather than crashing on `undefined` or
 * showing CS2's panels for a game that is not CS2. `notInstalled` names the
 * game, for the surfaces that say why (see `ModuleNotInstalledNotice`).
 */

import { DEFAULT_GAME, type ClientGameIntegration, type GameId } from '../integrations/types';

/** The placeholder's `id`. Never a real module's. */
export const MISSING_MODULE_ID = 'module-not-installed';

/** The placeholder for `game`, a value no installed module runs. */
export function missingModuleIntegration(game: GameId): ClientGameIntegration {
  return {
    id: MISSING_MODULE_ID,
    notInstalled: game,
    capabilities: {
      servers: false,
      veto: false,
      liveEvents: false,
      demos: false,
      playerStats: false,
    },
    matchPanels: {},
    tournamentSetupSteps: {},
    standaloneMatchSteps: {},
    resourceDialogs: {},
    dashboardWidgets: {},
    routes: [],
    navItems: [],
  };
}

/**
 * The placeholder for `game` while a code module that may run it is still
 * loading: the same empty slots as the missing-module one, with
 * `modulePending` in place of `notInstalled`. Only `getIntegrationWhileLoading`
 * answers it, and only until the modules settle.
 */
export function pendingModuleIntegration(game: GameId): ClientGameIntegration {
  const placeholder = missingModuleIntegration(game);
  delete placeholder.notInstalled;
  return { ...placeholder, modulePending: game };
}

/**
 * The installed module behind a `game` ref, or null when none claims or runs
 * it: the module's own id, then the catalogue ids it claims, then a module
 * that runs any catalogue game. Order is registration order.
 */
function resolveGameRef(
  wanted: string,
  installed: readonly ClientGameIntegration[]
): ClientGameIntegration | null {
  const direct = installed.find((integration) => integration.id === wanted);
  if (direct) return direct;

  for (const integration of installed) {
    if (integration.catalogGames?.some((claim) => claim.toLowerCase() === wanted)) {
      return integration;
    }
  }

  for (const integration of installed) {
    if (integration.runsAnyCatalogGame) return integration;
  }
  return null;
}

/**
 * The module behind a `game` value among `installed`, or the placeholder.
 *
 * A missing `game` is a response from before the column existed and belongs to
 * CS2, and so does 'cs2' itself: both answer the CS2 module when it is
 * installed and the placeholder when it is not — never the catch-all module,
 * which would take any string and make a CS2 tournament a manually reported
 * one. Anything else goes through the lookup above, and a value nothing claims
 * or runs is the placeholder, not CS2.
 */
export function resolveIntegration(
  game: GameId | null | undefined,
  installed: readonly ClientGameIntegration[]
): ClientGameIntegration {
  const wanted = (game || DEFAULT_GAME).trim().toLowerCase();
  if (wanted === DEFAULT_GAME) {
    return (
      installed.find((integration) => integration.id === DEFAULT_GAME) ??
      missingModuleIntegration(DEFAULT_GAME)
    );
  }
  return resolveGameRef(wanted, installed) ?? missingModuleIntegration(wanted);
}

/**
 * `resolveIntegration`, while code modules may still arrive this page load
 * (`mayArrive`): the "module pending" placeholder when the module that runs
 * `game` may be one that has not arrived yet, else what `resolveIntegration`
 * answers.
 *
 * - Nothing installed runs `game` (it would be the missing-module
 *   placeholder): pending.
 * - Only a catch-all module runs it (manual reporting), and the manifest has
 *   listed a code module (`manifest === 'listed'`), which may claim it
 *   outright: pending. While the manifest has not answered, the catch-all as
 *   before, so an instance with no code module never holds its slots back.
 * - A module that owns it (CS2, or one claiming it): never pending.
 */
export function resolveIntegrationWhileLoading(
  game: GameId | null | undefined,
  installed: readonly ClientGameIntegration[],
  mayArrive: boolean,
  manifest: 'unknown' | 'empty' | 'listed'
): ClientGameIntegration {
  const resolved = resolveIntegration(game, installed);
  if (!mayArrive) return resolved;
  const wanted = (game || DEFAULT_GAME).trim().toLowerCase();
  if (resolved.id === MISSING_MODULE_ID) return pendingModuleIntegration(wanted);
  if (manifest === 'listed' && resolved.runsAnyCatalogGame && resolved.id !== wanted) {
    const owner = resolveIntegration(
      wanted,
      installed.filter((integration) => !integration.runsAnyCatalogGame)
    );
    if (owner.id === MISSING_MODULE_ID) return pendingModuleIntegration(wanted);
  }
  return resolved;
}
