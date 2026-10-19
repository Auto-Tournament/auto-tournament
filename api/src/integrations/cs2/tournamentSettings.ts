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
 *
 * `mapMode` (a map type, maps/mapModes.ts) restricts the maps: a wingman
 * tournament's pool or sequence may only hold wingman maps. A map whose type
 * is not known passes.
 */

import type {
  ModuleSettingsTarget,
  ModuleTournamentSettings,
  TournamentSettingsInput,
  TournamentSettingsValidation,
} from '../types';
import { validateCustomVetoOrderSetting } from './veto/config';
import { isOneOf, type Untrusted } from '../../utils/untrusted';
import type { TournamentSettings } from '../../types/tournament.types';
/** One place's prize as a tournament stores it: a rarity to pick from, or none. */
export interface TournamentRewardSetting {
  place: 0 | 1 | 2 | 3 | 4;
  mode: 'random' | 'none';
  rarity?: string;
  /** 'one': one skin of the rarity at random. Absent: pick 1 of 3. */
  pick?: 'one';
}

/** The tournament's MVP prize (skins/skinService awardMvp). */
export interface MvpSetting {
  enabled: boolean;
  /** Most commended, best rating, or the organizer picks after the final. */
  by: 'commends' | 'rating' | 'admin';
  rarity: string;
  /** 'one': one skin at random. Absent: pick 1 of 3. */
  pick?: 'one';
}

const MVP_BY = ['commends', 'rating', 'admin'] as const;

/** An MVP setting as stored; null when it is not one. */
function mvpSetting(raw: Untrusted): MvpSetting | null {
  if (!isRecord(raw)) return null;
  const r = raw;
  return {
    enabled: r.enabled === true,
    by: isOneOf(MVP_BY, r.by) ? r.by : 'commends',
    rarity:
      typeof r.rarity === 'string' && REWARD_RARITIES.includes(r.rarity) ? r.rarity : 'legendary',
    ...(r.pick === 'one' ? { pick: 'one' as const } : {}),
  };
}

const REWARD_RARITIES = [
  'common',
  'uncommon',
  'rare',
  'mythical',
  'legendary',
  'ancient',
  'immortal',
];

/** Places 1–4 and 0 (everyone else), each a rarity or none; anything else dropped. */
function rewardSettings(raw: Untrusted[]): TournamentRewardSetting[] {
  const out: TournamentRewardSetting[] = [];
  for (const item of raw) {
    const r = isRecord(item) ? item : null;
    const place = Number(r?.place);
    if (![0, 1, 2, 3, 4].includes(place) || out.some((o) => o.place === place)) continue;
    if (r?.mode === 'none')
      out.push({ place: place as TournamentRewardSetting['place'], mode: 'none' });
    else if (typeof r?.rarity === 'string' && REWARD_RARITIES.includes(r.rarity))
      out.push({
        place: place as TournamentRewardSetting['place'],
        mode: 'random',
        rarity: r.rarity,
        ...(r.pick === 'one' ? { pick: 'one' as const } : {}),
      });
  }
  return out;
}

import { MAP_MODES, isMapMode, mapsOfOtherModes, unknownMaps, type MapMode } from './maps/mapModes';

/** The key of CS2's object inside `tournament.settings` and a template's `settings`. */
export const CS2_SETTINGS_KEY = 'cs2';

declare module '../../types/tournament.types' {
  interface ModuleTournamentObjects {
    /** CS2's own tournament settings (this file). */
    cs2?: Cs2TournamentSettings;
    /** Before 3.0: `cs2.skinRewards` at the top level (read as a fallback). */
    skinRewards?: boolean;
  }
}

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
  /** Only maps of this type (wingman, hostage, …); absent: any. */
  mapMode?: MapMode;
  /** False: the top three get no skin rewards (skins/skinService). Absent: on. */
  skinRewards?: boolean;
  /** This tournament's own prizes per place (skinService.parseRewards); absent: the site's. */
  rewards?: TournamentRewardSetting[];
  /** False: its matches drop no skins (the placings still get prizes). Absent: on. */
  matchDrops?: boolean;
  /** A prize for the tournament's MVP; absent: none. */
  mvp?: MvpSetting;
  /** Opt-in anonymous bots up to teamSize; humans keep normal ready-up. */
  fillTeamsWithBots?: boolean;
  /**
   * Esports mode: Ready Up's `valve` ruleset (docs/ESPORTS-MODE.md): Valve's
   * competitive rules, no skins in the server. Off: normal rules, skins on.
   */
  esportsMode?: boolean;
  /**
   * The map veto (default on). Off: no veto, each match plays maps drawn
   * from the pool (matchConfig.ts), and the pool needs only one map.
   */
  veto?: boolean;
  /** GOTV for this tournament's matches (gotv.ts); a field left out is the site's. */
  broadcast?: Cs2BroadcastSettings;
}

/** `settings.cs2.broadcast`: the tournament's own GOTV settings. */
export interface Cs2BroadcastSettings {
  /** tv_delay, 0–120 s (0: live). */
  delay?: number;
  /** tv_maxclients, 1–100. */
  seats?: number;
  /** HUD tools like LHM may connect (tv_secure_bypass 1, sv_deltaticks_enforce 0). */
  insecureObservers?: boolean;
}

/** A requested `broadcast`, with only its valid fields; null when it is not an object. */
export function broadcastSetting(value: Untrusted): Cs2BroadcastSettings | null {
  if (!isRecord(value)) return null;
  const out: Cs2BroadcastSettings = {};
  const delay = value.delay;
  if (typeof delay === 'number' && Number.isInteger(delay) && delay >= 0 && delay <= 120)
    out.delay = delay;
  const seats = value.seats;
  if (typeof seats === 'number' && Number.isInteger(seats) && seats >= 1 && seats <= 100)
    out.seats = seats;
  if (typeof value.insecureObservers === 'boolean') out.insecureObservers = value.insecureObservers;
  return out;
}

/** The map pool size a veto order is checked against when nothing else says (Active Duty). */
const DEFAULT_MAP_COUNT = 7;

const CREATE_REQUIRED = ['maps'];
const SHUFFLE_REQUIRED = ['mapSequence', 'maxRounds', 'overtimeMode'];

function lengthOf(value: Untrusted): number | undefined {
  return Array.isArray(value) || typeof value === 'string' ? value.length : undefined;
}

function isRecord(value: Untrusted): value is Record<string, Untrusted> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `container[key]` when both are objects, else an empty object. */
function objectIn(container: Untrusted, key: string): Record<string, Untrusted> {
  if (!isRecord(container)) return {};
  const value = container[key];
  return isRecord(value) ? value : {};
}

/** The map pool a request sends: top-level `maps` (2.x), else `settings.cs2.maps`. */
function requestedMaps(body: Record<string, Untrusted> | undefined): Untrusted {
  if (body?.maps !== undefined) return body.maps;
  return objectIn(body?.settings, CS2_SETTINGS_KEY).maps;
}

/** CS2's object in a stored settings value (the JSON text, or already parsed). */
export function storedCs2Settings(
  settings: Partial<TournamentSettings> | string | null | undefined
): Cs2TournamentSettings | undefined {
  if (typeof settings !== 'string') return settings?.cs2;
  try {
    // The platform wrote it (tournament.settings).
    return (JSON.parse(settings) as Partial<TournamentSettings>).cs2;
  } catch {
    return undefined;
  }
}

/**
 * The map type a request asks for: `mapMode` at the top level or in
 * `settings.cs2`. undefined: not sent; null: cleared; a string that is no
 * type is returned as it is, for the error.
 */
function requestedMapMode(body: Record<string, Untrusted> | undefined): Untrusted {
  if (body?.mapMode !== undefined) return body.mapMode;
  return objectIn(body?.settings, CS2_SETTINGS_KEY).mapMode;
}

/**
 * Errors for `maps`: a map the site does not have, or (with a map type `mode`)
 * one of another type. An unset mode is fine; one that is not a type is an error.
 */
function mapModeErrors(mode: Untrusted, maps: Untrusted): string[] {
  const ids = Array.isArray(maps) ? maps.filter((id): id is string => typeof id === 'string') : [];
  const errors = unknownMaps(ids).map((id) => `Map ${id} is not in this site's map list`);
  if (mode === undefined || mode === null || mode === '') return errors;
  if (!isMapMode(mode)) return [`mapMode must be one of ${MAP_MODES.join(', ')}`];
  for (const m of mapsOfOtherModes(ids, mode)) {
    errors.push(`Map ${m.id} is a ${m.mode} map; this tournament only plays ${mode} maps`);
  }
  return errors;
}

function settingsErrors(settings: Untrusted, mapCount: number | undefined): string[] {
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
    fieldErrors: mapModeErrors(requestedMapMode(input.body), maps),
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
  return done({
    requiredFields: SHUFFLE_REQUIRED,
    fieldErrors: mapModeErrors(requestedMapMode(input.body), mapSequence),
  });
}

/**
 * PUT /api/tournament: only the veto order, against the pool the tournament
 * will run on: the request's `maps` when it sends them, else the stored pool,
 * else 7.
 */
function validateUpdate(input: TournamentSettingsInput): TournamentSettingsValidation {
  const stored = storedCs2Settings(input.stored?.settings);
  const maps = requestedMaps(input.body) ?? stored?.maps;
  let mapCount = lengthOf(requestedMaps(input.body));
  if (typeof mapCount !== 'number') {
    mapCount = lengthOf(stored?.maps);
  }
  const mode = requestedMapMode(input.body);
  return done({
    fieldErrors: mapModeErrors(mode === undefined ? stored?.mapMode : mode, maps),
    errors: settingsErrors(input.settings, mapCount ?? DEFAULT_MAP_COUNT),
  });
}

/** Errors for a requested `broadcast` (absent and null are fine: the site's settings). */
function broadcastFieldErrors(value: Untrusted): string[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) return ['broadcast must be an object'];
  const errors: string[] = [];
  const int = (v: Untrusted, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  if (value.delay !== undefined && value.delay !== null && !int(value.delay, 0, 120))
    errors.push('broadcast.delay must be 0-120 seconds');
  if (value.seats !== undefined && value.seats !== null && !int(value.seats, 1, 100))
    errors.push('broadcast.seats must be 1-100');
  if (value.insecureObservers !== undefined && typeof value.insecureObservers !== 'boolean')
    errors.push('broadcast.insecureObservers must be a boolean');
  return errors;
}

export function validateCs2TournamentSettings(
  input: TournamentSettingsInput
): TournamentSettingsValidation {
  const fill =
    input.body?.fillTeamsWithBots !== undefined
      ? input.body.fillTeamsWithBots
      : objectIn(input.body?.settings ?? input.settings, CS2_SETTINGS_KEY).fillTeamsWithBots;
  if (fill !== undefined && typeof fill !== 'boolean')
    return done({ fieldErrors: ['fillTeamsWithBots must be a boolean'] });
  const esports = objectIn(input.body?.settings ?? input.settings, CS2_SETTINGS_KEY).esportsMode;
  if (esports !== undefined && typeof esports !== 'boolean')
    return done({ fieldErrors: ['esportsMode must be a boolean'] });
  const broadcastErrors = broadcastFieldErrors(
    objectIn(input.body?.settings ?? input.settings, CS2_SETTINGS_KEY).broadcast
  );
  if (broadcastErrors.length) return done({ fieldErrors: broadcastErrors });
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

function stringArray(value: Untrusted): string[] | undefined {
  return Array.isArray(value) && value.every((v): v is string => typeof v === 'string')
    ? [...value]
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
  layer: Record<string, Untrusted>,
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
  if (layer.mapMode !== undefined) {
    if (isMapMode(layer.mapMode)) into.mapMode = layer.mapMode;
    else if (layer.mapMode === null || layer.mapMode === '') delete into.mapMode;
  }
  if (typeof layer.fillTeamsWithBots === 'boolean')
    into.fillTeamsWithBots = layer.fillTeamsWithBots;
  if (typeof layer.skinRewards === 'boolean') into.skinRewards = layer.skinRewards;
  if (Array.isArray(layer.rewards)) into.rewards = rewardSettings(layer.rewards);
  else if (layer.rewards === null) delete into.rewards;
  if (typeof layer.matchDrops === 'boolean') into.matchDrops = layer.matchDrops;
  if (layer.mvp === null) delete into.mvp;
  else if (layer.mvp !== undefined) {
    const mvp = mvpSetting(layer.mvp);
    if (mvp) into.mvp = mvp;
  }
  if (typeof layer.esportsMode === 'boolean') into.esportsMode = layer.esportsMode;
  if (typeof layer.veto === 'boolean') into.veto = layer.veto;
  if (layer.broadcast === null) delete into.broadcast;
  else if (layer.broadcast !== undefined) {
    const broadcast = broadcastSetting(layer.broadcast);
    if (broadcast && Object.keys(broadcast).length) into.broadcast = broadcast;
    else if (broadcast) delete into.broadcast;
  }
  if (layer.mapPoolId !== undefined) {
    const id = Number(layer.mapPoolId);
    if (layer.mapPoolId !== null && Number.isInteger(id) && id > 0) into.mapPoolId = id;
    else delete into.mapPoolId;
  }
}

/**
 * A new tournament's rules when the request leaves them out: 24 rounds, one
 * overtime, then total team damage decides (a LAN schedule cannot take endless
 * overtimes).
 */
const TOURNAMENT_DEFAULTS: Cs2TournamentSettings = {
  maxRounds: 24,
  overtimeMode: 'enabled',
  overtimeSegments: 1,
};

export const cs2TournamentSettings: ModuleTournamentSettings<Cs2TournamentSettings> = {
  key: CS2_SETTINGS_KEY,

  fromRequest(body, stored, target) {
    const next: Cs2TournamentSettings = stored
      ? { ...stored }
      : target === 'tournament'
        ? { ...TOURNAMENT_DEFAULTS }
        : {};
    const layer = objectIn(body.settings, CS2_SETTINGS_KEY);
    applyLayer(next, layer, target);
    applyLayer(next, body, target);
    // The default segment count goes with the default overtime: a new tournament
    // that turns overtime off and names no segments has none.
    if (
      !stored &&
      target === 'tournament' &&
      next.overtimeMode === 'disabled' &&
      layer.overtimeSegments === undefined &&
      body.overtimeSegments === undefined
    ) {
      delete next.overtimeSegments;
    }
    if (target === 'tournament' && !next.maps) next.maps = [];
    return next;
  },

  responseFields(value, target) {
    const maps = value?.maps ?? [];
    if (target === 'template') {
      return {
        maps,
        mapPoolId: value?.mapPoolId,
        ...(value?.mapMode ? { mapMode: value.mapMode } : {}),
      };
    }
    return {
      maps,
      mapSequence: value?.mapSequence,
      maxRounds: value?.maxRounds,
      overtimeMode: value?.overtimeMode,
      overtimeSegments: value?.overtimeSegments,
      ...(value?.fillTeamsWithBots !== undefined
        ? { fillTeamsWithBots: value.fillTeamsWithBots }
        : {}),
      ...(value?.skinRewards !== undefined ? { skinRewards: value.skinRewards } : {}),
      ...(value?.rewards ? { rewards: value.rewards } : {}),
      ...(value?.matchDrops !== undefined ? { matchDrops: value.matchDrops } : {}),
      ...(value?.mvp ? { mvp: value.mvp } : {}),
      ...(value?.esportsMode !== undefined ? { esportsMode: value.esportsMode } : {}),
      ...(value?.veto !== undefined ? { veto: value.veto } : {}),
      ...(value?.mapPoolId !== undefined ? { mapPoolId: value.mapPoolId } : {}),
      ...(value?.mapMode ? { mapMode: value.mapMode } : {}),
    };
  },

  changesBracket(before, after) {
    return (before?.maps?.length ?? 0) !== (after?.maps?.length ?? 0);
  },
};
