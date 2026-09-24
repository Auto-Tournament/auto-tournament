/**
 * CS2's own tournament settings on the client: its object inside the
 * tournament's `settings` (`settings.cs2`), the same object the API stores
 * (api/src/integrations/cs2/tournamentSettings.ts). The setup wizard holds the
 * whole settings object and hands it to CS2's steps; CS2 reads and writes only
 * this key, and answers the wizard's questions about it through
 * `cs2TournamentSetup` (`ClientGameIntegration.tournamentSetup`).
 */

import type { TFunction } from 'i18next';
import type {
  TournamentSettingChange,
  TournamentSetupContext,
  TournamentSetupModel,
  TournamentSetupSummary,
} from '../../types';
import { requiresVeto, validateMapCount } from './mapRules';

/** The key of CS2's object in `settings`. */
export const CS2_SETTINGS_KEY = 'cs2';

export type OvertimeMode = 'enabled' | 'disabled';

/** `settings.cs2`, as the wizard edits it. */
export interface Cs2TournamentSettings {
  /** The map pool (map ids). A shuffle tournament plays them in this order. */
  maps: string[];
  /** Shuffle: the maps in play order, one per round (kept equal to `maps`). */
  mapSequence?: string[];
  /** mp_maxrounds, 1–30. */
  maxRounds: number;
  overtimeMode: OvertimeMode;
  /**
   * Overtime segments before the tiebreak; null is the plugin's default
   * (unlimited overtime, or draws allowed with overtime off). 0 with overtime
   * off means no draws.
   */
  overtimeSegments: number | null;
  /**
   * The map pool the maps came from. Null: the organizer chose a custom list
   * (the API stores that as no pool). Absent: nothing picked yet, so the maps
   * step fills in the default pool.
   */
  mapPoolId?: number | null;
}

export const CS2_DEFAULTS: Cs2TournamentSettings = {
  maps: [],
  maxRounds: 24,
  overtimeMode: 'enabled',
  overtimeSegments: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? [...(value as string[])]
    : undefined;
}

/** One layer of stored or requested fields onto `into`, each field only when it is valid. */
function applyFields(into: Cs2TournamentSettings, source: Record<string, unknown>): void {
  const maps = stringArray(source.maps);
  if (maps) into.maps = maps;
  const sequence = stringArray(source.mapSequence);
  if (sequence) into.mapSequence = sequence;
  if (typeof source.maxRounds === 'number' && Number.isFinite(source.maxRounds)) {
    into.maxRounds = source.maxRounds;
  }
  if (source.overtimeMode === 'enabled' || source.overtimeMode === 'disabled') {
    into.overtimeMode = source.overtimeMode;
  }
  if ('overtimeSegments' in source) {
    into.overtimeSegments =
      typeof source.overtimeSegments === 'number' && Number.isFinite(source.overtimeSegments)
        ? source.overtimeSegments
        : null;
  }
  if (typeof source.mapPoolId === 'number' && source.mapPoolId > 0) {
    into.mapPoolId = source.mapPoolId;
  } else if (source.mapPoolId === null) {
    into.mapPoolId = null;
  }
}

/**
 * CS2's settings in a tournament's or template's settings object, with the
 * defaults for anything missing. A template saved before 3.0 kept the round
 * rules at the top of its settings (`settings.maxRounds`, ...): those are read
 * too, under anything in `settings.cs2`.
 */
export function cs2SettingsOf(
  settings: Record<string, unknown> | undefined
): Cs2TournamentSettings {
  const result: Cs2TournamentSettings = { ...CS2_DEFAULTS, maps: [] };
  if (!settings) return result;
  applyFields(result, {
    ...(typeof settings.maxRounds === 'number' ? { maxRounds: settings.maxRounds } : {}),
    ...(settings.overtimeMode ? { overtimeMode: settings.overtimeMode } : {}),
    ...(typeof settings.overtimeSegments === 'number'
      ? { overtimeSegments: settings.overtimeSegments }
      : {}),
  });
  const own = settings[CS2_SETTINGS_KEY];
  if (isRecord(own)) applyFields(result, own);
  return result;
}

/** The patch that stores `next` as CS2's object. */
export function cs2Patch(next: Cs2TournamentSettings): Record<string, unknown> {
  const stored: Record<string, unknown> = {
    maps: next.maps,
    maxRounds: next.maxRounds,
    overtimeMode: next.overtimeMode,
    overtimeSegments: next.overtimeSegments,
  };
  if (next.mapSequence) stored.mapSequence = next.mapSequence;
  if (next.mapPoolId !== undefined) stored.mapPoolId = next.mapPoolId;
  return { [CS2_SETTINGS_KEY]: stored };
}

/**
 * The maps changed: a shuffle tournament plays them in order, so its
 * sequence follows; any other type has none.
 */
export function withMaps(
  current: Cs2TournamentSettings,
  maps: string[],
  type: string,
  mapPoolId: number | null | undefined
): Cs2TournamentSettings {
  const next: Cs2TournamentSettings = { ...current, maps };
  if (type === 'shuffle') next.mapSequence = maps;
  else delete next.mapSequence;
  if (mapPoolId === undefined) delete next.mapPoolId;
  else next.mapPoolId = mapPoolId;
  return next;
}

/** The overtime choice the three meaningful (mode, segments) pairs make. */
export type OvertimeOption = 'enabled' | 'disabledDraws' | 'disabledNoDraws';

export function overtimeOptionOf(
  settings: Pick<Cs2TournamentSettings, 'overtimeMode' | 'overtimeSegments'>
): OvertimeOption {
  if (settings.overtimeMode === 'enabled') return 'enabled';
  return settings.overtimeSegments === 0 ? 'disabledNoDraws' : 'disabledDraws';
}

function rulesLine(cs2: Cs2TournamentSettings, ctx: TournamentSetupContext, t: TFunction): string {
  const option = overtimeOptionOf(cs2);
  const overtime =
    option === 'enabled'
      ? t('tournament.matchRules.overtimeEnabled')
      : option === 'disabledNoDraws'
        ? t('tournament.matchRules.overtimeDisabledNoDraws')
        : t('tournament.matchRules.overtimeDisabled');
  const rounds =
    ctx.type === 'shuffle'
      ? t('tournament.wizard.roundLimitValue', { count: cs2.maxRounds })
      : t('tournament.matchRules.value', {
          maxRounds: cs2.maxRounds,
          winRounds: Math.floor(cs2.maxRounds / 2) + 1,
        });
  return `${rounds} · ${overtime}`;
}

const sameSet = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export const cs2TournamentSetup: TournamentSetupModel = {
  initialSettings(_ctx, from) {
    return cs2Patch(cs2SettingsOf(from));
  },

  onTypeChange(settings, from, to) {
    const cs2 = cs2SettingsOf(settings);
    // A bracket's pool is not a play order: a new shuffle starts from an
    // empty, custom sequence rather than inheriting it.
    if (to === 'shuffle' && from !== 'shuffle') {
      return cs2Patch(withMaps(cs2, [], to, null));
    }
    if (from === 'shuffle' && to !== 'shuffle') {
      return cs2Patch(withMaps(cs2, cs2.maps, to, cs2.mapPoolId));
    }
    return {};
  },

  stepError(step, settings, ctx, t) {
    const cs2 = cs2SettingsOf(settings);
    if (step === 'rules') {
      return cs2.maxRounds < 1 || cs2.maxRounds > 30 ? t('tournament.toasts.maxRoundsRange') : null;
    }
    const validation = validateMapCount(cs2.maps, ctx.type, ctx.format);
    return validation.valid
      ? null
      : (validation.message ?? t('tournament.toasts.invalidMapSelection'));
  },

  summary(settings, ctx, t): TournamentSetupSummary {
    const cs2 = cs2SettingsOf(settings);
    const count = cs2.maps.length;
    const isShuffle = ctx.type === 'shuffle';
    return {
      rows: [
        count > 0
          ? {
              key: 'maps',
              label: t('tournament.setup.summary.maps'),
              value: isShuffle
                ? t('tournament.setup.summary.mapsRounds', {
                    maps: t('tournament.counts.maps', { count }),
                    rounds: t('tournament.counts.rounds', { count }),
                  })
                : t('tournament.counts.maps', { count }),
            }
          : {
              key: 'maps',
              label: t('tournament.setup.summary.maps'),
              value: t('tournament.setup.summary.notSet'),
              pending: true,
            },
      ],
      checklist: [
        {
          key: 'maps',
          label: requiresVeto(ctx.type, ctx.format)
            ? t('tournament.setup.checklist.mapsVeto')
            : t('tournament.setup.checklist.maps'),
          met: validateMapCount(cs2.maps, ctx.type, ctx.format).valid,
        },
      ],
      review: [
        {
          key: 'rules',
          label: t('tournament.labels.matchRules'),
          value: rulesLine(cs2, ctx, t),
        },
      ],
    };
  },

  roundCount(settings, ctx) {
    if (ctx.type !== 'shuffle') return null;
    const cs2 = cs2SettingsOf(settings);
    return (cs2.mapSequence ?? cs2.maps).length;
  },

  changes(before, after, ctx, t): TournamentSettingChange[] {
    const old = cs2SettingsOf(before);
    const next = cs2SettingsOf(after);
    const changes: TournamentSettingChange[] = [];
    // Shuffle plays the maps in order, so the order is part of the change.
    const mapsChanged =
      ctx.type === 'shuffle'
        ? JSON.stringify(old.maps) !== JSON.stringify(next.maps)
        : !sameSet(old.maps, next.maps);
    if (mapsChanged) {
      changes.push({
        field: 'maps',
        label: t('tournament.labels.mapPool'),
        oldValue: old.maps,
        newValue: next.maps,
      });
    }
    // The round rules have never asked for a confirmation; they count as a
    // change all the same.
    if (
      old.maxRounds !== next.maxRounds ||
      old.overtimeMode !== next.overtimeMode ||
      old.overtimeSegments !== next.overtimeSegments
    ) {
      changes.push({
        field: 'matchRules',
        label: t('tournament.labels.matchRules'),
        oldValue: rulesLine(old, ctx, t),
        newValue: rulesLine(next, ctx, t),
        confirm: false,
      });
    }
    return changes;
  },
};
