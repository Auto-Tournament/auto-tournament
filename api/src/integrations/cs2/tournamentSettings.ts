/**
 * Validation of the CS2 tournament fields, behind
 * `GameIntegration.validateTournamentSettings`.
 *
 * CS2 owns these fields of a tournament request: `maps` (the map pool),
 * `mapSequence` (shuffle), `maxRounds`, `overtimeMode`, `overtimeSegments`
 * and `settings.customVetoOrder`. The first five are CS2's object inside the
 * tournament's settings, `settings.cs2` (`Cs2TournamentSettings`, stored
 * through `cs2TournamentSettings` below); a request may send them there or,
 * as 2.x clients do, at the top level.
 *
 * The checks and their messages are the ones `routes/tournament.ts` and
 * `createShuffleTournament` made inline before; the core reports them in the
 * same order (see `TournamentSettingsValidation`). `maxRounds` and the overtime
 * fields of a regular create or update were never validated and still are
 * not.
 */

import type {
  ModuleSettingsTarget,
  ModuleTournamentSettings,
  TournamentSettingsInput,
  TournamentSettingsValidation,
} from '../types';
import { validateCustomVetoOrderSetting } from './veto/config';

/** The key of CS2's object inside `tournament.settings` and a template's `settings`. */
export const CS2_SETTINGS_KEY = 'cs2';

/**
 * CS2's tournament settings, `settings.cs2`. Until 3.0 these were core
 * columns (`tournament.maps`, `map_sequence`, `max_rounds`, `overtime_mode`,
 * `overtime_segments`, and on a template `map_pool_id` and `maps`); the core
 * schema migration `2026-09-24-cs2-tournament-settings` folded them in, a
 * NULL column as an absent field.
 */
export interface Cs2TournamentSettings {
  /** The map pool (map ids). A shuffle tournament's is its map sequence. */
  maps?: string[];
  /** Shuffle: the maps in play order, one per round. */
  mapSequence?: string[];
  /** mp_maxrounds. A new tournament gets 24. */
  maxRounds?: number;
  overtimeMode?: 'enabled' | 'disabled';
  /**
   * Overtime segments before the tiebreak; absent is the plugin's default
   * (unlimited overtime, or draws allowed with overtime off). 0 with overtime
   * off means no draws.
   */
  overtimeSegments?: number;
  /** The map pool the maps were picked from, when they came from one. */
  mapPoolId?: number;
}

/** The map pool size a veto order is checked against when nothing else says (Active Duty). */
const DEFAULT_MAP_COUNT = 7;

const CREATE_REQUIRED = ['maps'];
const SHUFFLE_REQUIRED = ['mapSequence', 'maxRounds', 'overtimeMode'];

function lengthOf(value: unknown): number | undefined {
  return (value as { length?: number } | null | undefined)?.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `container[key]` when both are objects, else an empty object. */
function objectIn(container: unknown, key: string): Record<string, unknown> {
  if (!isRecord(container)) return {};
  const value = container[key];
  return isRecord(value) ? value : {};
}

/** The map pool a request sends: top-level `maps` (2.x), else `settings.cs2.maps`. */
function requestedMaps(body: Record<string, unknown> | undefined): unknown {
  if (body?.maps !== undefined) return body.maps;
  return objectIn(body?.settings, CS2_SETTINGS_KEY).maps;
}

/** CS2's object in a stored settings value (the JSON text, or already parsed). */
export function storedCs2Settings(settings: unknown): Cs2TournamentSettings | undefined {
  let parsed = settings;
  if (typeof settings === 'string') {
    try {
      parsed = JSON.parse(settings);
    } catch {
      return undefined;
    }
  }
  const value = isRecord(parsed) ? parsed[CS2_SETTINGS_KEY] : undefined;
  return isRecord(value) ? (value as Cs2TournamentSettings) : undefined;
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
  const maps = requestedMaps(input.body);
  if (!maps) {
    return done({ requiredFields: CREATE_REQUIRED, missingFields: ['maps'] });
  }
  const mapCount = lengthOf(maps);
  if (mapCount === 0) {
    return done({ requiredFields: CREATE_REQUIRED, fieldErrors: ['At least one map is required'] });
  }
  return done({
    requiredFields: CREATE_REQUIRED,
    errors: settingsErrors(input.settings, mapCount),
  });
}

/**
 * POST /api/tournament/shuffle: the map sequence, max rounds and overtime
 * mode are required; the sequence must not be empty and max rounds must be at
 * least 1. Shuffle tournaments have no veto, so `settings` is not checked.
 */
function validateShuffleCreate(input: TournamentSettingsInput): TournamentSettingsValidation {
  const body = { ...objectIn(input.body?.settings, CS2_SETTINGS_KEY), ...(input.body ?? {}) };
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
  let mapCount = lengthOf(requestedMaps(input.body));
  if (typeof mapCount !== 'number') {
    mapCount = lengthOf(storedCs2Settings(input.stored?.settings)?.maps);
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

// ---------------------------------------------------------------------------
// Storing: `settings.cs2` (GameIntegration.tournamentSettings)
// ---------------------------------------------------------------------------

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? [...(value as string[])]
    : undefined;
}

/**
 * Apply one layer of a request (CS2's object in `settings`, or the 2.x
 * top-level fields) onto `into`. Each field keeps the rule the old column
 * write had: an array replaces the pool, a number sets max rounds, overtime
 * mode is 'enabled' or 'disabled', and `overtimeSegments: null` clears the
 * segments back to the plugin's default. On a template `maps: null` and a
 * falsy `mapPoolId` clear them, as the template columns did.
 */
function applyLayer(
  into: Cs2TournamentSettings,
  layer: Record<string, unknown>,
  target: ModuleSettingsTarget
): void {
  if (layer.maps !== undefined) {
    const maps = stringArray(layer.maps);
    if (maps) into.maps = maps;
    else if (layer.maps === null && target === 'template') delete into.maps;
  }
  if (layer.mapSequence !== undefined) {
    const sequence = stringArray(layer.mapSequence);
    if (sequence) into.mapSequence = sequence;
    else if (layer.mapSequence === null) delete into.mapSequence;
  }
  if (typeof layer.maxRounds === 'number' && Number.isFinite(layer.maxRounds)) {
    into.maxRounds = layer.maxRounds;
  }
  if (layer.overtimeMode === 'enabled' || layer.overtimeMode === 'disabled') {
    into.overtimeMode = layer.overtimeMode;
  }
  if (layer.overtimeSegments !== undefined) {
    if (typeof layer.overtimeSegments === 'number' && Number.isFinite(layer.overtimeSegments)) {
      into.overtimeSegments = layer.overtimeSegments;
    } else {
      delete into.overtimeSegments;
    }
  }
  if (layer.mapPoolId !== undefined) {
    const id = Number(layer.mapPoolId);
    if (layer.mapPoolId !== null && Number.isInteger(id) && id > 0) into.mapPoolId = id;
    else delete into.mapPoolId;
  }
}

/** A new tournament's rules when the request leaves them out: 24 rounds, overtime on. */
const TOURNAMENT_DEFAULTS: Cs2TournamentSettings = { maxRounds: 24, overtimeMode: 'enabled' };

export const cs2TournamentSettings: ModuleTournamentSettings<Cs2TournamentSettings> = {
  key: CS2_SETTINGS_KEY,

  fromRequest(body, stored, target) {
    const next: Cs2TournamentSettings = stored
      ? { ...stored }
      : target === 'tournament'
        ? { ...TOURNAMENT_DEFAULTS }
        : {};
    applyLayer(next, objectIn(body.settings, CS2_SETTINGS_KEY), target);
    applyLayer(next, body, target);
    if (target === 'tournament' && !next.maps) next.maps = [];
    return next;
  },

  responseFields(value, target) {
    const maps = value?.maps ?? [];
    if (target === 'template') {
      return { maps, mapPoolId: value?.mapPoolId };
    }
    return {
      maps,
      mapSequence: value?.mapSequence,
      maxRounds: value?.maxRounds,
      overtimeMode: value?.overtimeMode,
      overtimeSegments: value?.overtimeSegments,
      ...(value?.mapPoolId !== undefined ? { mapPoolId: value.mapPoolId } : {}),
    };
  },

  changesBracket(before, after) {
    return (before?.maps?.length ?? 0) !== (after?.maps?.length ?? 0);
  },
};
