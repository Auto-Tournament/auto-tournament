/**
 * The manual-report module's tournament setup: what an organizer decides, and
 * how those decisions are read back off a tournament row.
 *
 * The module owns one object inside `tournament.settings`, `manualReport`.
 * The core stores and forwards `settings` without reading it, and
 * `normalizeTournamentSettings` keeps keys it does not know about, so the
 * object survives a create, an update and a template round-trip untouched.
 *
 *   gameLabel          what to call the game in the UI and in a report
 *   bestOf             games in a series; defaults to the tournament `format`
 *   allowDraw          a game (and so a series) may end level
 *   confirmation       'opponent' (the other captain has to agree) | 'none'
 *   confirmTimeoutMin  minutes the opponent has; 0 = no deadline
 *   timeoutAction      what the sweeper does at the deadline
 *
 * Every value has a default, so a tournament created without a `manualReport`
 * object is a valid one: a best-of from its format, opponent confirmation, a
 * day to answer, and auto-confirm at the deadline.
 */

import type {
  JSONSchema,
  IntegrationTournament,
  TournamentSettingsInput,
  TournamentSettingsValidation,
} from '../types';
import { catalogNameFor } from './catalog';

/** What the tournament asks for before a report counts. */
export type ConfirmationMode = 'opponent' | 'none';

/** What the sweeper does when `confirmTimeoutMin` passes with no answer. */
export type TimeoutAction = 'auto_confirm' | 'escalate';

export interface ManualReportSetup {
  gameLabel: string;
  bestOf: number;
  allowDraw: boolean;
  confirmation: ConfirmationMode;
  /** Minutes; 0 means the report waits for an answer forever. */
  confirmTimeoutMin: number;
  timeoutAction: TimeoutAction;
}

/** A day to answer is long enough for an evening league and short enough to unblock a bracket. */
export const DEFAULT_CONFIRM_TIMEOUT_MIN = 24 * 60;

/** Series lengths an organizer can pick. Odd, so a decisive series always exists. */
export const BEST_OF_CHOICES = [1, 3, 5, 7] as const;

export const CONFIRMATION_MODES: ReadonlyArray<ConfirmationMode> = ['opponent', 'none'];
export const TIMEOUT_ACTIONS: ReadonlyArray<TimeoutAction> = ['auto_confirm', 'escalate'];

/** The integration's part of `tournament.settings`, as a JSON Schema. */
export const MANUAL_REPORT_TOURNAMENT_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    manualReport: {
      type: 'object',
      description: "The manual-report module's tournament settings.",
      properties: {
        gameLabel: {
          type: 'string',
          maxLength: 60,
          description: 'What to call the game; defaults to the catalogue name of `tournament.game`.',
        },
        bestOf: {
          type: 'integer',
          enum: [...BEST_OF_CHOICES],
          description: 'Games in a series; defaults to the tournament format (bo1 -> 1).',
        },
        allowDraw: {
          type: 'boolean',
          description: 'A game may end level, so a series can end drawn.',
        },
        confirmation: {
          type: 'string',
          enum: [...CONFIRMATION_MODES],
          description: "'opponent': the other team's captain has to agree. 'none': a report stands on its own.",
        },
        confirmTimeoutMin: {
          type: 'integer',
          minimum: 0,
          maximum: 60 * 24 * 30,
          description: 'Minutes the opponent has to answer; 0 means no deadline.',
        },
        timeoutAction: {
          type: 'string',
          enum: [...TIMEOUT_ACTIONS],
          description:
            "At the deadline: 'auto_confirm' takes the report as reported, 'escalate' hands the match to an admin.",
        },
      },
      additionalProperties: false,
    },
  },
};

/** 'bo3' -> 3; anything unreadable is a single game. */
export function seriesLengthOf(format: string | null | undefined): number {
  const n = Number(/^bo(\d+)$/i.exec(format ?? '')?.[1]);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function nonNegativeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * The module's settings for a tournament, with every default applied.
 *
 * `tournament.settings` is the full tournament response for now (see
 * `IntegrationTournament`), so the module's object is at
 * `settings.settings.manualReport`; a bare settings object is read too, so a
 * caller that already has one does not have to wrap it.
 */
export function readSetup(
  tournament: IntegrationTournament | null,
  game?: string | null
): ManualReportSetup {
  const outer = asRecord(tournament?.settings);
  const settings = asRecord(outer.settings ?? outer);
  const own = asRecord(settings.manualReport);

  const confirmation = own.confirmation === 'none' ? 'none' : 'opponent';
  const timeoutAction = own.timeoutAction === 'escalate' ? 'escalate' : 'auto_confirm';
  const label = typeof own.gameLabel === 'string' ? own.gameLabel.trim() : '';
  const gameRef = game ?? (typeof outer.game === 'string' ? outer.game : null);

  return {
    gameLabel: label || (gameRef && catalogNameFor(gameRef)) || 'the game',
    bestOf: positiveInt(own.bestOf, seriesLengthOf(tournament?.format)),
    allowDraw: own.allowDraw === true,
    confirmation,
    confirmTimeoutMin: nonNegativeInt(own.confirmTimeoutMin, DEFAULT_CONFIRM_TIMEOUT_MIN),
    timeoutAction,
  };
}

/**
 * Check the `manualReport` object of a create or update. Only fields that are
 * present are checked: an update sends what changed, and every field has a
 * default, so absent is always valid.
 */
export function validateSetup(input: TournamentSettingsInput): TournamentSettingsValidation {
  const own = asRecord(asRecord(input.settings).manualReport);
  const errors: string[] = [];

  if ('gameLabel' in own && (typeof own.gameLabel !== 'string' || own.gameLabel.length > 60)) {
    errors.push('manualReport.gameLabel must be a string of at most 60 characters');
  }
  if ('bestOf' in own && !BEST_OF_CHOICES.includes(own.bestOf as (typeof BEST_OF_CHOICES)[number])) {
    errors.push(`manualReport.bestOf must be one of ${BEST_OF_CHOICES.join(', ')}`);
  }
  if ('allowDraw' in own && typeof own.allowDraw !== 'boolean') {
    errors.push('manualReport.allowDraw must be true or false');
  }
  if ('confirmation' in own && !CONFIRMATION_MODES.includes(own.confirmation as ConfirmationMode)) {
    errors.push(`manualReport.confirmation must be one of ${CONFIRMATION_MODES.join(', ')}`);
  }
  if ('timeoutAction' in own && !TIMEOUT_ACTIONS.includes(own.timeoutAction as TimeoutAction)) {
    errors.push(`manualReport.timeoutAction must be one of ${TIMEOUT_ACTIONS.join(', ')}`);
  }
  if ('confirmTimeoutMin' in own) {
    const n = Number(own.confirmTimeoutMin);
    if (!Number.isInteger(n) || n < 0 || n > 60 * 24 * 30) {
      errors.push('manualReport.confirmTimeoutMin must be a whole number of minutes, 0 to 43200');
    }
  }

  return { valid: errors.length === 0, errors };
}
