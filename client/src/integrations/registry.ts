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
import { useModuleState } from '../module-loader/useModuleState';
import { manualReportClientIntegration } from './manual-report';
import { resolveIntegration, resolveIntegrationWhileLoading } from '../utils/moduleResolution';
import {
  getModuleState,
  isBroken,
  modulesMayArrive,
  type ModuleState,
} from '../module-loader/moduleState';
import { registerModuleLocales } from '../module-loader/moduleLocales';
import i18n from '../i18n';
import { DEFAULT_GAME, type ClientGameIntegration, type GameId, type GameOwned } from './types';

// CS2 first, the same order the API registers them in: the two overlap on
// nothing, but a claimed catalogue slug is resolved in registration order, so
// the module that owns a game outright is asked before the one that runs
// anything.
//
// CS2 is a catalog module (DESIGN-modules §10). The production build
// (`vite.config.ts`, `withoutCs2`) answers the `./cs2` import with `null`, so
// the bundle carries no CS2 and loads it at runtime like any code module. The
// dev server keeps it compiled in, the dev alias of DESIGN-module-client-api
// §6, unless AT_CS2_BUILTIN=0.
const INTEGRATIONS: Record<string, ClientGameIntegration> = {
  ...(cs2ClientIntegration ? { [cs2ClientIntegration.id]: cs2ClientIntegration } : {}),
  [manualReportClientIntegration.id]: manualReportClientIntegration,
};

// Each built-in's strings become its namespace now, before anything renders:
// the same step the loader takes for a code module (see `moduleLocales`).
for (const integration of Object.values(INTEGRATIONS)) {
  registerModuleLocales(i18n, integration.id, integration.locales);
}

/**
 * Code modules loaded at runtime (DESIGN-module-client-api.md, 8a), in load
 * order. Empty on an instance with none, and then this registry answers
 * exactly as it did before they existed.
 */
const CODE_MODULES: ClientGameIntegration[] = [];

/** The ids compiled into this bundle. A code module may not take one. */
export function builtInIntegrationIds(): string[] {
  return Object.keys(INTEGRATIONS);
}

/**
 * Adds a code module the loader imported and validated. Built-ins come first
 * and win: a code module with a built-in's id, or one already registered, is
 * refused rather than shadowing it.
 */
export function registerCodeModule(integration: ClientGameIntegration): void {
  if (INTEGRATIONS[integration.id] || CODE_MODULES.some((m) => m.id === integration.id)) {
    throw new Error(`a module with id "${integration.id}" is already registered`);
  }
  CODE_MODULES.push(integration);
}

/**
 * Built-ins, then code modules, minus any code module that broke while
 * rendering this session: a game it ran then resolves to the "module not
 * installed" placeholder instead of rendering it again.
 */
export function listIntegrations(): ClientGameIntegration[] {
  const builtIns = Object.values(INTEGRATIONS);
  if (CODE_MODULES.length === 0) return builtIns;
  return builtIns.concat(CODE_MODULES.filter((integration) => !isBroken(integration.id)));
}

/**
 * The routes to mount: every registered module's, including a code module
 * that broke while rendering. Its page stays mounted, so the slot boundary
 * around it keeps saying why, rather than the path turning into a 404 when
 * the routes re-render on the failure. (Slots and nav leave it out, through
 * `listIntegrations`.)
 */
export function listRouteIntegrations(): ClientGameIntegration[] {
  return Object.values(INTEGRATIONS).concat(CODE_MODULES);
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
 * `getIntegration`, for a page that renders while code modules may still be
 * loading (DESIGN-module-client-api.md §4.2): the integration, or the
 * "module pending" placeholder when the module that runs `game` may be one
 * that has not arrived yet. The placeholder's slots are empty like the
 * missing-module one, and `modulePending` says why, so the surfaces that
 * would say "not installed" show a loading state instead.
 *
 * A game is pending while `modulesMayArrive`:
 * - when nothing installed runs it (it would be the missing-module
 *   placeholder), or
 * - once the manifest has listed a code module, when only a catch-all module
 *   (manual reporting) runs it: the code module may claim it outright.
 *
 * A built-in that owns the game (CS2) never waits, and nothing waits at all
 * once the manifest says there is no code module. While the manifest has not
 * answered, a catch-all game shows the catch-all as before, so a stock
 * install never holds back manual reporting's slots.
 *
 * Not reactive on its own: `useIntegration` re-renders the caller when a
 * module arrives.
 */
export function getIntegrationWhileLoading(
  game: GameId | null | undefined,
  state: ModuleState = getModuleState()
): ClientGameIntegration {
  return resolveIntegrationWhileLoading(game, listIntegrations(), modulesMayArrive(state), state.manifest);
}

/**
 * `getIntegration`, for render: the component re-renders when a code module
 * arrives, and a game whose module may still be loading answers the "module
 * pending" placeholder (`getIntegrationWhileLoading`).
 *
 * The app renders before code modules have loaded (they never hold back first
 * paint), so a component that reads the registry while rendering should use
 * this. On an instance with no code module it answers exactly what
 * `getIntegration` does as soon as the manifest has said so, and the store it
 * subscribes to never changes again.
 */
export function useIntegration(game: GameId | null | undefined): ClientGameIntegration {
  const state = useModuleState();
  return getIntegrationWhileLoading(game, state);
}

/** `integrationFor(row)`, for render: see `useIntegration`. */
export function useIntegrationFor(row: GameOwned | null | undefined): ClientGameIntegration {
  return useIntegration(row?.game);
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
