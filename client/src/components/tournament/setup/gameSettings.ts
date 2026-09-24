import type { TFunction } from 'i18next';
import { getIntegration } from '../../../integrations/registry';
import type {
  TournamentSettingChange,
  TournamentSetupContext,
  TournamentSetupSummary,
} from '../../../integrations/types';

/**
 * The core's own keys in `tournament.settings`. Everything else in there is a
 * game module's object (CS2: `cs2`, manual reporting: `manualReport`), which
 * the core stores and forwards without reading.
 */
const CORE_SETTING_KEYS = new Set([
  'matchFormat',
  'thirdPlaceMatch',
  'autoAdvance',
  'checkInRequired',
  'seedingMethod',
  'grandFinalMode',
  'maxRounds',
  'overtimeMode',
  'overtimeSegments',
  'customVetoOrder',
  'description',
  'location',
  'rules',
  'rulebookUrl',
  'prizes',
  'schedule',
]);

/**
 * A game module's own settings inside a settings object: everything the core
 * does not name. "Not one of ours" is the only test there can be, since the
 * core never reads them (3.0 phase D, PR D9).
 */
export function moduleKeysOf(settings: object | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (!CORE_SETTING_KEYS.has(key)) out[key] = value;
  }
  return out;
}

/**
 * The game settings the wizard edits for `game`: the modules' keys of a saved
 * settings object (a tournament's or a template's), completed by the game's
 * module (its defaults, and whatever it reads from older saves). Without
 * `from`, a new tournament's.
 */
export function gameSettingsFor(
  ctx: TournamentSetupContext,
  from?: object | null
): Record<string, unknown> {
  const saved = from ? (from as Record<string, unknown>) : undefined;
  const model = getIntegration(ctx.game).tournamentSetup;
  return {
    ...moduleKeysOf(saved),
    ...(model?.initialSettings?.(ctx, saved) ?? {}),
  };
}

/** The game module's check of its settings for a step, or null. */
export function gameSettingsError(
  step: 'rules' | 'content',
  settings: Record<string, unknown>,
  ctx: TournamentSetupContext,
  t: TFunction
): string | null {
  return getIntegration(ctx.game).tournamentSetup?.stepError?.(step, settings, ctx, t) ?? null;
}

const NO_SUMMARY: TournamentSetupSummary = { rows: [], checklist: [], review: [] };

/** The game module's summary rows, checklist items and review rows. */
export function gameSettingsSummary(
  settings: Record<string, unknown>,
  ctx: TournamentSetupContext,
  t: TFunction
): TournamentSetupSummary {
  return getIntegration(ctx.game).tournamentSetup?.summary?.(settings, ctx, t) ?? NO_SUMMARY;
}

/** Rounds a shuffle tournament gets from the game's settings, or null. */
export function gameSettingsRoundCount(
  settings: Record<string, unknown>,
  ctx: TournamentSetupContext
): number | null {
  return getIntegration(ctx.game).tournamentSetup?.roundCount?.(settings, ctx) ?? null;
}

/**
 * What changed in the game's settings between the saved tournament and the
 * form, as the module sees it. A module that does not say reports nothing,
 * as before: its settings step saves with the rest of the form.
 */
export function gameSettingsChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ctx: TournamentSetupContext,
  t: TFunction
): TournamentSettingChange[] {
  return getIntegration(ctx.game).tournamentSetup?.changes?.(before, after, ctx, t) ?? [];
}

/** The settings patch a change of tournament type makes to the game's settings. */
export function gameSettingsOnTypeChange(
  game: string,
  settings: Record<string, unknown>,
  from: string,
  to: string
): Record<string, unknown> {
  return getIntegration(game).tournamentSetup?.onTypeChange?.(settings, from, to) ?? {};
}
