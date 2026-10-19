/**
 * A game module's own object inside `tournament.settings` and a template's
 * `settings` (`GameIntegration.tournamentSettings`, integrations/types.ts).
 *
 * The core keeps that object under the module's key and never reads a field
 * of it: this file only asks the module for the object a request stores, for
 * the 2.x top-level fields a response keeps, and whether a change moves the
 * bracket. A tournament whose module is not installed keeps its object as
 * stored, because the core's settings merge carries every key it does not
 * rewrite.
 */

import { integrationForMatch } from '../integrations/registry';
import type { GameId, ModuleSettingsTarget, ModuleTournamentSettings } from '../integrations/types';
import type { Untrusted } from './untrusted';

/**
 * The core's own settings keys (`TournamentSettings`). A module's key may not
 * be one of them; a module that declares one is treated as having no
 * settings object, so it can never overwrite the core's.
 */
export const CORE_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  'matchFormat',
  'thirdPlaceMatch',
  'autoAdvance',
  'checkInRequired',
  'seedingMethod',
  'grandFinalMode',
  'customVetoOrder',
  'maxRounds',
  'overtimeMode',
  'overtimeSegments',
  'description',
  'location',
  'organizer',
  'rules',
  'rulebookUrl',
  'prizes',
  'schedule',
  'registrationOpen',
  'registrationClosesAt',
  'maxTeams',
  'checkInOpensAt',
  'checkInClosesAt',
]);

/**
 * A module's object in a settings value, by the module's key. The one place
 * the core reads a settings object by a key it only knows at run time.
 */
function moduleObject(settings: object | null | undefined, key: string): object | undefined {
  const value = settings ? (settings as Record<string, object | undefined>)[key] : undefined;
  return value !== null && typeof value === 'object' ? value : undefined;
}

/** The settings handler of the module that runs `game`, when it has a usable one. */
export function moduleSettingsHandler(
  game: GameId | null | undefined
): ModuleTournamentSettings | undefined {
  const handler = integrationForMatch({ game }).tournamentSettings;
  if (!handler || CORE_SETTINGS_KEYS.has(handler.key)) return undefined;
  return handler;
}

/**
 * `settings` with the module's object set to what the request asks for.
 * `stored` is the settings as stored before the request (undefined on a
 * create). Everything else in `settings` is left as it is.
 */
export function withModuleSettings<S extends object>(
  game: GameId | null | undefined,
  settings: S,
  body: Record<string, Untrusted>,
  stored: object | undefined,
  target: ModuleSettingsTarget
): S {
  const handler = moduleSettingsHandler(game);
  if (!handler) return settings;
  const before = moduleObject(stored, handler.key);
  const next = handler.fromRequest(body, before, target);
  if (next === undefined) {
    // Nothing to store; keep what was there rather than what the request's
    // own `settings` may have carried in under the key.
    if (before === undefined) {
      const rest: Partial<Record<string, object>> & S = { ...settings };
      delete rest[handler.key];
      return rest;
    }
    return { ...settings, [handler.key]: before };
  }
  return { ...settings, [handler.key]: next };
}

/** The 2.x top-level response fields the module fills from its object. */
export function moduleResponseFields(
  game: GameId | null | undefined,
  settings: object | null | undefined,
  target: ModuleSettingsTarget
): object {
  const handler = moduleSettingsHandler(game);
  if (!handler?.responseFields) return {};
  return handler.responseFields(moduleObject(settings, handler.key), target) ?? {};
}

/** Whether moving the module's object from `before` to `after` changes the bracket. */
export function moduleSettingsChangeBracket(
  game: GameId | null | undefined,
  before: object | null | undefined,
  after: object | null | undefined
): boolean {
  const handler = moduleSettingsHandler(game);
  if (!handler?.changesBracket) return false;
  return handler.changesBracket(
    moduleObject(before, handler.key),
    moduleObject(after, handler.key)
  );
}
