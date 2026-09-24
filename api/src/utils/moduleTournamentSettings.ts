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
  'rules',
  'rulebookUrl',
  'prizes',
  'schedule',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  body: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  target: ModuleSettingsTarget
): S {
  const handler = moduleSettingsHandler(game);
  if (!handler) return settings;
  const before = stored?.[handler.key];
  const next = handler.fromRequest(body, before, target);
  if (next === undefined) {
    // Nothing to store; keep what was there rather than what the request's
    // own `settings` may have carried in under the key.
    if (before === undefined) {
      const rest = { ...(settings as Record<string, unknown>) };
      delete rest[handler.key];
      return rest as S;
    }
    return { ...settings, [handler.key]: before };
  }
  return { ...settings, [handler.key]: next };
}

/** The 2.x top-level response fields the module fills from its object. */
export function moduleResponseFields(
  game: GameId | null | undefined,
  settings: unknown,
  target: ModuleSettingsTarget
): Record<string, unknown> {
  const handler = moduleSettingsHandler(game);
  if (!handler?.responseFields) return {};
  const value = isRecord(settings) ? settings[handler.key] : undefined;
  return handler.responseFields(value, target) ?? {};
}

/** Whether moving the module's object from `before` to `after` changes the bracket. */
export function moduleSettingsChangeBracket(
  game: GameId | null | undefined,
  before: unknown,
  after: unknown
): boolean {
  const handler = moduleSettingsHandler(game);
  if (!handler?.changesBracket) return false;
  const pick = (settings: unknown) => (isRecord(settings) ? settings[handler.key] : undefined);
  return handler.changesBracket(pick(before), pick(after));
}
