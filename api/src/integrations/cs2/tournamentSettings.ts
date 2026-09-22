/**
 * Validation of the CS2 tournament fields, behind
 * `GameIntegration.validateTournamentSettings`.
 *
 * CS2 owns these fields of a tournament request: `maps` (the map pool),
 * `mapSequence` (shuffle), `maxRounds`, `overtimeMode`, `overtimeSegments`
 * and `settings.customVetoOrder`. They are still stored in the tournament
 * row's own columns (marked cs2-owned in `config/database.schema.ts`).
 *
 * The checks and their messages are the ones `routes/tournament.ts` and
 * `createShuffleTournament` made inline before; the core reports them in the
 * same order (see `TournamentSettingsValidation`). `maxRounds` and the overtime
 * fields of a regular create or update were never validated and still are
 * not.
 */

import type { TournamentSettingsInput, TournamentSettingsValidation } from '../types';
import { validateCustomVetoOrderSetting } from './veto/config';

/** The map pool size a veto order is checked against when nothing else says (Active Duty). */
const DEFAULT_MAP_COUNT = 7;

const CREATE_REQUIRED = ['maps'];
const SHUFFLE_REQUIRED = ['mapSequence', 'maxRounds', 'overtimeMode'];

function lengthOf(value: unknown): number | undefined {
  return (value as { length?: number } | null | undefined)?.length;
}

function settingsErrors(settings: unknown, mapCount: number | undefined): string[] {
  // `mapCount` is undefined when a create sends a `maps` without a length,
  // exactly as it was passed before.
  const result = validateCustomVetoOrderSetting(settings, mapCount as number);
  return result.valid ? [] : [result.error];
}

function done(parts: {
  errors?: string[];
  missingFields?: string[];
  fieldErrors?: string[];
  requiredFields?: string[];
}): TournamentSettingsValidation {
  const errors = parts.errors ?? [];
  const missingFields = parts.missingFields ?? [];
  const fieldErrors = parts.fieldErrors ?? [];
  return {
    valid: errors.length === 0 && missingFields.length === 0 && fieldErrors.length === 0,
    errors,
    missingFields,
    fieldErrors,
    ...(parts.requiredFields ? { requiredFields: parts.requiredFields } : {}),
  };
}

/** POST /api/tournament: a map pool is required and must not be empty; then the veto order. */
function validateCreate(input: TournamentSettingsInput): TournamentSettingsValidation {
  const maps = input.body?.maps;
  if (!maps) {
    return done({ requiredFields: CREATE_REQUIRED, missingFields: ['maps'] });
  }
  const mapCount = lengthOf(maps);
  if (mapCount === 0) {
    return done({ requiredFields: CREATE_REQUIRED, fieldErrors: ['At least one map is required'] });
  }
  return done({ requiredFields: CREATE_REQUIRED, errors: settingsErrors(input.settings, mapCount) });
}

/**
 * POST /api/tournament/shuffle: the map sequence, max rounds and overtime
 * mode are required; the sequence must not be empty and max rounds must be at
 * least 1. Shuffle tournaments have no veto, so `settings` is not checked.
 */
function validateShuffleCreate(input: TournamentSettingsInput): TournamentSettingsValidation {
  const body = input.body ?? {};
  const mapSequence = body.mapSequence;
  const maxRounds = body.maxRounds;
  if (!mapSequence || typeof maxRounds !== 'number' || !body.overtimeMode) {
    return done({
      requiredFields: SHUFFLE_REQUIRED,
      missingFields: SHUFFLE_REQUIRED.filter((field) =>
        field === 'maxRounds' ? typeof maxRounds !== 'number' : !body[field]
      ),
    });
  }
  if (lengthOf(mapSequence) === 0) {
    return done({
      requiredFields: SHUFFLE_REQUIRED,
      fieldErrors: [
        'At least one map must be selected. ' +
          'The number of maps you select determines the number of rounds in the tournament.',
      ],
    });
  }
  if (!maxRounds || maxRounds < 1) {
    return done({
      requiredFields: SHUFFLE_REQUIRED,
      fieldErrors: [
        'Invalid max rounds value. You must specify a maximum number of rounds (minimum: 1).',
      ],
    });
  }
  return done({ requiredFields: SHUFFLE_REQUIRED });
}

/**
 * PUT /api/tournament: only the veto order, against the pool the tournament
 * will run on: the request's `maps` when it sends them, else the stored pool,
 * else 7.
 */
function validateUpdate(input: TournamentSettingsInput): TournamentSettingsValidation {
  let mapCount = lengthOf(input.body?.maps);
  if (typeof mapCount !== 'number') {
    try {
      const stored = input.stored?.maps;
      mapCount = stored ? (JSON.parse(stored as string) as string[]).length : undefined;
    } catch {
      mapCount = undefined;
    }
  }
  return done({ errors: settingsErrors(input.settings, mapCount ?? DEFAULT_MAP_COUNT) });
}

export function validateCs2TournamentSettings(
  input: TournamentSettingsInput
): TournamentSettingsValidation {
  switch (input.mode) {
    case 'create':
      return validateCreate(input);
    case 'create-shuffle':
      return validateShuffleCreate(input);
    case 'update':
      return validateUpdate(input);
    default:
      // No mode: the settings alone, against the pool size given.
      return done({ errors: settingsErrors(input.settings, input.mapCount ?? DEFAULT_MAP_COUNT) });
  }
}
