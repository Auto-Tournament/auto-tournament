import type { TFunction } from 'i18next';
import { TOURNAMENT_TYPES } from '../../../constants/tournament';
import { getIntegration } from '../../../integrations/registry';
import { validateTeamCountForType } from '../../../utils/tournamentValidation';
import { validateMapCount } from '../../../utils/tournamentVerification';

export const SETUP_STEPS = [
  'game',
  'basics',
  'format',
  'teams',
  'maps',
  'eventPage',
  'review',
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number];

/**
 * The steps for one game (3.0 phase D, PR D9).
 *
 * Every step but "Maps and veto" is the core's and is asked for every game.
 * That one is the game module's — it renders the module's `content` step and
 * nothing else — so a game whose module has none (a manually reported one:
 * there are no maps to pick and no veto to play) does not get the step at
 * all, rather than an empty page with a Continue button.
 */
export function setupStepsFor(game: string | null | undefined): SetupStepId[] {
  const hasContent = Boolean(getIntegration(game).tournamentSetupSteps.content);
  return SETUP_STEPS.filter((step) => step !== 'maps' || hasContent);
}

/** The index of the last step for a game; Review is always last. */
export function reviewStepIndexFor(game: string | null | undefined): number {
  return setupStepsFor(game).length - 1;
}

export const REVIEW_STEP_INDEX = SETUP_STEPS.indexOf('review');

/** What the step checks need to know about the form. */
export interface SetupValidationInput {
  name: string;
  type: string;
  format: string;
  teamCount: number;
  mapIds: string[];
  maxRounds: number;
  teamSize: number;
}

/**
 * The message that blocks Continue on a step, or null when it is fine. Uses
 * the same rules as saving (Tournament.tsx handleSave) so a step never lets
 * through what the save would reject.
 */
export function stepError(
  step: SetupStepId,
  input: SetupValidationInput,
  t: TFunction
): string | null {
  const isShuffle = input.type === 'shuffle';
  switch (step) {
    case 'basics':
      return input.name.trim() ? null : t('tournament.toasts.nameRequired');
    case 'format':
      if (!input.type) return t('tournament.wizard.validation.selectType');
      if (!isShuffle && !input.format) return t('tournament.wizard.validation.selectFormat');
      if (isShuffle && (input.teamSize < 2 || input.teamSize > 10)) {
        return t('tournament.toasts.teamSizeRange');
      }
      if (input.maxRounds < 1 || input.maxRounds > 30) {
        return t('tournament.toasts.maxRoundsRange');
      }
      return null;
    case 'teams': {
      if (isShuffle) return null;
      if (input.teamCount === 0) return t('tournament.toasts.selectAtLeastTwoTeams');
      const validation = validateTeamCountForType(input.type, input.teamCount, t);
      return validation.isValid
        ? null
        : (validation.error ?? t('tournament.toasts.invalidTeamCount'));
    }
    case 'maps': {
      const validation = validateMapCount(input.mapIds, input.type, input.format);
      return validation.valid
        ? null
        : (validation.message ?? t('tournament.toasts.invalidMapSelection'));
    }
    default:
      return null;
  }
}

/** Team counts the stepper can land on for a type, from the existing validation rules. */
export function teamCountChoices(type: string): number[] {
  const rule = TOURNAMENT_TYPES.find((tt) => tt.value === type);
  if (!rule || type === 'shuffle') return [];
  if (rule.requirePowerOfTwo && rule.validCounts) return rule.validCounts;
  const min = rule.minTeams ?? 2;
  const max = rule.maxTeams ?? 128;
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** The allowed count closest to `count` (ties go to the smaller one). */
export function nearestTeamCount(type: string, count: number): number {
  const choices = teamCountChoices(type);
  if (choices.length === 0) return count;
  return choices.reduce((best, c) => (Math.abs(c - count) < Math.abs(best - count) ? c : best));
}
