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
import type { MapGameMode } from '../cs2.types';
import { isMapMode } from '../maps/mapModes';
import type { Untrusted } from '../../types';

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
  /** Only maps of this type (a wingman tournament plays wingman maps); absent: any. */
  mapMode?: MapGameMode;
  /** False: the top three get no skin rewards. Absent: on. */
  skinRewards?: boolean;
  /** False: the tournament's matches get no clips or reels. Absent: on. */
  highlights?: boolean;
  /** This tournament's own prizes per place (0 = everyone else); absent: the site's. */
  rewards?: Array<{ place: number; mode: 'random' | 'none'; rarity?: string }> | null;
  /** Opt-in anonymous bots up to teamSize; humans keep normal ready-up. */
  fillTeamsWithBots?: boolean;
  /** Esports mode: Valve's rules, no skins in the server. */
  esportsMode?: boolean;
  /** Everyone plays the default agents; absent: on in esports mode. */
  defaultAgents?: boolean | null;
  /** A knife round picks open sides; absent: on, off in esports mode. */
  knifeRound?: boolean | null;
  /** One player's .ready readies the team; absent: the site's. */
  teamReady?: boolean | null;
  /** The give-up vote (.gg); absent: the site's. */
  giveUpVote?: boolean | null;
  /** The platform's skins in the server; absent: on, off in esports mode. */
  platformSkins?: boolean | null;
  /** Tactical timeouts per team and their length (s); absent: the preset's. */
  tacticalTimeouts?: number | null;
  tacticalTimeoutSeconds?: number | null;
  /** Technical pauses per team per map (0: unlimited) and auto-unpause (s, 0: never); absent: the preset's. */
  technicalPauses?: number | null;
  technicalPauseSeconds?: number | null;
  /** Minutes in warmup before a match goes live, ready or not; 0: never; absent: the site's. */
  autoStartMinutes?: number | null;
  /** The map veto (default on); off: each match draws its maps from the pool. */
  veto?: boolean;
  /** Which address players get: only LAN, only internet, or both ('auto', absent). */
  connectVia?: 'auto' | 'lan' | 'public';
  /** GOTV for this tournament's matches; a field left out is the site's (Settings › Spectators). */
  broadcast?: Cs2BroadcastSettings;
}

/** `settings.cs2.broadcast` (api cs2 tournamentSettings.ts). */
export interface Cs2BroadcastSettings {
  /** tv_delay, 0–120 s; 0 is live. */
  delay?: number;
  /** GOTV viewers per match (tv_maxclients). */
  seats?: number;
  /** HUD tools like LHM may connect (tv_secure_bypass). */
  insecureObservers?: boolean;
}

export const CS2_DEFAULTS: Cs2TournamentSettings = {
  maps: [],
  maxRounds: 24,
  overtimeMode: 'enabled',
  // One overtime, then team damage decides: a new tournament's default.
  overtimeSegments: 1,
};

function isRecord(value: Untrusted): value is Record<string, Untrusted> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: Untrusted): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? [...(value as string[])]
    : undefined;
}

/** One layer of stored or requested fields onto `into`, each field only when it is valid. */
function applyFields(into: Cs2TournamentSettings, source: Record<string, Untrusted>): void {
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
  if (typeof source.fillTeamsWithBots === 'boolean')
    into.fillTeamsWithBots = source.fillTeamsWithBots;
  if (typeof source.skinRewards === 'boolean') into.skinRewards = source.skinRewards;
  if (typeof source.highlights === 'boolean') into.highlights = source.highlights;
  if (Array.isArray(source.rewards))
    into.rewards = source.rewards as Cs2TournamentSettings['rewards'];
  if (typeof source.esportsMode === 'boolean') into.esportsMode = source.esportsMode;
  for (const key of RULE_FLAGS) if (typeof source[key] === 'boolean') into[key] = source[key];
  for (const key of RULE_COUNTS) if (typeof source[key] === 'number') into[key] = source[key];
  if (typeof source.autoStartMinutes === 'number') into.autoStartMinutes = source.autoStartMinutes;
  if (typeof source.veto === 'boolean') into.veto = source.veto;
  if (source.connectVia === 'lan' || source.connectVia === 'public' || source.connectVia === 'auto')
    into.connectVia = source.connectVia;
  if (isRecord(source.broadcast)) {
    const b = source.broadcast;
    into.broadcast = {
      ...(typeof b.delay === 'number' ? { delay: b.delay } : {}),
      ...(typeof b.seats === 'number' ? { seats: b.seats } : {}),
      ...(typeof b.insecureObservers === 'boolean'
        ? { insecureObservers: b.insecureObservers }
        : {}),
    };
  }
  if (isMapMode(source.mapMode)) into.mapMode = source.mapMode;
  else if (source.mapMode === null) delete into.mapMode;
}

/**
 * CS2's settings in a tournament's or template's settings object, with the
 * defaults for anything missing. A template saved before 3.0 kept the round
 * rules at the top of its settings (`settings.maxRounds`, ...): those are read
 * too, under anything in `settings.cs2`.
 */
const RULE_FLAGS = [
  'defaultAgents',
  'knifeRound',
  'teamReady',
  'giveUpVote',
  'platformSkins',
] as const;
const RULE_COUNTS = [
  'tacticalTimeouts',
  'tacticalTimeoutSeconds',
  'technicalPauses',
  'technicalPauseSeconds',
] as const;

/** What the site's Match rules page sets for every tournament (GET /api/settings). */
export interface SiteMatchDefaults {
  teamReady: boolean;
  giveUpVote: boolean;
  autoStartMinutes: number;
}

/** The settings a preset sets, and what each preset gives them (Ready Up's rulesets). */
export interface PresetRules {
  knifeRound: boolean;
  platformSkins: boolean;
  defaultAgents: boolean;
  tactical: string;
  /** "" = the server's own (Ready Up's default ruleset sets none). */
  technical: string;
  teamReady: boolean;
  giveUpVote: boolean;
  autoStartMinutes: number;
}
export type PresetKey = keyof PresetRules;

/** Tactical timeouts as one choice, "count×seconds" ("0" none). */
export function tacticalChoice(count: number, seconds: number): string {
  return count === 0 ? '0' : `${count}x${seconds}`;
}

/** The preset's own values: Standard is the site's, Esports is Valve's rules (Ready Up `valve`). */
export function presetRules(esports: boolean, site: SiteMatchDefaults): PresetRules {
  return esports
    ? {
        ...site,
        knifeRound: false,
        platformSkins: false,
        defaultAgents: true,
        tactical: '3x31',
        technical: '1x120',
      }
    : {
        ...site,
        knifeRound: true,
        platformSkins: true,
        defaultAgents: false,
        tactical: '3x30',
        technical: '',
      };
}

/** What a tournament ends up with: its own value, else its preset's (pure: tested on its own). */
export function effectiveRules(v: Cs2TournamentSettings, site: SiteMatchDefaults): PresetRules {
  const preset = presetRules(v.esportsMode === true, site);
  const own = <T>(x: T | null | undefined, fallback: T): T =>
    x === null || x === undefined ? fallback : x;
  const tactical =
    v.tacticalTimeouts === null || v.tacticalTimeouts === undefined
      ? preset.tactical
      : tacticalChoice(v.tacticalTimeouts, own(v.tacticalTimeoutSeconds, 30));
  const technical =
    v.technicalPauses === null || v.technicalPauses === undefined
      ? preset.technical
      : `${v.technicalPauses}x${own(v.technicalPauseSeconds, 0)}`;
  return {
    knifeRound: own(v.knifeRound, preset.knifeRound),
    platformSkins: own(v.platformSkins, preset.platformSkins),
    defaultAgents: own(v.defaultAgents, preset.defaultAgents),
    tactical,
    technical,
    teamReady: own(v.teamReady, site.teamReady),
    giveUpVote: own(v.giveUpVote, site.giveUpVote),
    autoStartMinutes: own(v.autoStartMinutes, site.autoStartMinutes),
  };
}

/** The settings that differ from the site's defaults (the Standard preset), in display order. */
export function changedFromSite(v: Cs2TournamentSettings, site: SiteMatchDefaults): PresetKey[] {
  const now = effectiveRules(v, site);
  const standard = presetRules(false, site);
  return (Object.keys(standard) as PresetKey[]).filter((k) => now[k] !== standard[k]);
}

/** The patch that sets one preset setting: null where it equals the preset (follows it again). */
export function presetPatch(
  v: Cs2TournamentSettings,
  site: SiteMatchDefaults,
  key: PresetKey,
  value: boolean | number | string
): Partial<Cs2TournamentSettings> {
  const preset = presetRules(v.esportsMode === true, site);
  const same = preset[key] === value;
  if (key === 'tactical') {
    if (same) return { tacticalTimeouts: null, tacticalTimeoutSeconds: null };
    const [count, seconds] = String(value).split('x').map(Number);
    return { tacticalTimeouts: count, tacticalTimeoutSeconds: count === 0 ? null : seconds };
  }
  if (key === 'technical') {
    if (same || value === '') return { technicalPauses: null, technicalPauseSeconds: null };
    const [count, seconds] = String(value).split('x').map(Number);
    return { technicalPauses: count, technicalPauseSeconds: seconds };
  }
  return { [key]: same ? null : value } as Partial<Cs2TournamentSettings>;
}

/** Switching the preset: everything it sets follows the new one, the site-wide ones stay. */
export function withPreset(esports: boolean): Partial<Cs2TournamentSettings> {
  return {
    esportsMode: esports,
    knifeRound: null,
    platformSkins: null,
    defaultAgents: null,
    tacticalTimeouts: null,
    tacticalTimeoutSeconds: null,
    technicalPauses: null,
    technicalPauseSeconds: null,
  };
}

/** Whether the matches use the default agents: the tournament's choice, else on in esports mode. */
export function defaultAgentsOn(
  cs2: Pick<Cs2TournamentSettings, 'defaultAgents' | 'esportsMode'>
): boolean {
  return cs2.defaultAgents ?? cs2.esportsMode === true;
}

export function cs2SettingsOf(
  settings: Record<string, Untrusted> | undefined
): Cs2TournamentSettings {
  const result: Cs2TournamentSettings = { ...CS2_DEFAULTS, maps: [] };
  if (!settings) return result;
  // Stored without a count means unlimited overtime (tournaments from before the default).
  result.overtimeSegments = null;
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
export function cs2Patch(next: Cs2TournamentSettings): Record<string, Untrusted> {
  const stored: Record<string, Untrusted> = {
    maps: next.maps,
    maxRounds: next.maxRounds,
    overtimeMode: next.overtimeMode,
    overtimeSegments: next.overtimeSegments,
  };
  if (next.mapSequence) stored.mapSequence = next.mapSequence;
  if (next.mapPoolId !== undefined) stored.mapPoolId = next.mapPoolId;
  stored.fillTeamsWithBots = next.fillTeamsWithBots === true;
  stored.esportsMode = next.esportsMode === true;
  // null goes back to the preset's (or the site's).
  for (const key of [...RULE_FLAGS, ...RULE_COUNTS])
    if (next[key] !== undefined) stored[key] = next[key];
  // null goes back to the site's.
  if (next.autoStartMinutes !== undefined) stored.autoStartMinutes = next.autoStartMinutes;
  stored.veto = next.veto !== false;
  if (next.broadcast !== undefined) stored.broadcast = next.broadcast;
  if (next.skinRewards !== undefined) stored.skinRewards = next.skinRewards;
  if (next.highlights !== undefined) stored.highlights = next.highlights;
  // null goes back to the site's prizes.
  if (next.rewards !== undefined) stored.rewards = next.rewards;
  // null clears a type set before (the API keeps a field a patch leaves out).
  stored.mapMode = next.mapMode ?? null;
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

/** The review's list of what differs from the site: the preset's own settings, and any set by hand. */
export function changedLabels(cs2: Cs2TournamentSettings, t: TFunction): string {
  const preset: PresetKey[] = [
    'knifeRound',
    'tactical',
    'technical',
    'platformSkins',
    'defaultAgents',
  ];
  // The site-wide ones only when the tournament sets them: the review has no site values to compare.
  const fallback = {
    teamReady: cs2.teamReady ?? true,
    giveUpVote: cs2.giveUpVote ?? false,
    autoStartMinutes: -1,
  };
  const keys = changedFromSite(cs2, fallback).filter((k) => preset.includes(k));
  if (cs2.teamReady !== null && cs2.teamReady !== undefined) keys.push('teamReady');
  if (cs2.giveUpVote !== null && cs2.giveUpVote !== undefined) keys.push('giveUpVote');
  if (cs2.autoStartMinutes !== null && cs2.autoStartMinutes !== undefined)
    keys.push('autoStartMinutes');
  const label = (k: PresetKey) =>
    k === 'defaultAgents'
      ? t('tournament.defaultAgents.label', { ns: 'cs2' })
      : k === 'autoStartMinutes'
        ? t('tournament.autoStart.label', { ns: 'cs2' })
        : t(`tournament.matchSettings.${k}.label`, { ns: 'cs2' });
  return keys.length
    ? keys.map(label).join(', ')
    : t('tournament.matchSettings.none', { ns: 'cs2' });
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
  const fill =
    // CS2's own strings: the caller's t is core's (the review step showed the raw key).
    (cs2.fillTeamsWithBots === true ? ` · ${t('tournament.botFill.label', { ns: 'cs2' })}` : '') +
    (cs2.esportsMode === true ? ` · ${t('tournament.esportsMode.label', { ns: 'cs2' })}` : '');
  return `${rounds} · ${overtime}${fill}`;
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
    const validation = validateMapCount(cs2.maps, ctx.type, ctx.format, cs2.veto !== false);
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
          label: requiresVeto(ctx.type, ctx.format, cs2.veto !== false)
            ? t('tournament.setup.checklist.mapsVeto')
            : t('tournament.setup.checklist.maps'),
          met: validateMapCount(cs2.maps, ctx.type, ctx.format, cs2.veto !== false).valid,
        },
      ],
      review: [
        {
          key: 'rules',
          label: t('tournament.labels.matchRules'),
          value: rulesLine(cs2, ctx, t),
        },
        {
          key: 'changedSettings',
          label: t('tournament.matchSettings.reviewLabel', { ns: 'cs2' }),
          value: changedLabels(cs2, t),
        },
      ],
    };
  },

  minutesPerMap(settings) {
    // As the API's "next round about" (utils/nextRoundEta.ts): 115 s a round, 5 min warmup.
    return (cs2SettingsOf(settings).maxRounds * 115) / 60 + 5;
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
      old.overtimeSegments !== next.overtimeSegments ||
      (old.fillTeamsWithBots === true) !== (next.fillTeamsWithBots === true) ||
      (old.esportsMode === true) !== (next.esportsMode === true) ||
      defaultAgentsOn(old) !== defaultAgentsOn(next) ||
      (old.autoStartMinutes ?? null) !== (next.autoStartMinutes ?? null) ||
      [...RULE_FLAGS, ...RULE_COUNTS].some((k) => (old[k] ?? null) !== (next[k] ?? null))
    ) {
      changes.push({
        field: 'matchRules',
        label: t('tournament.labels.matchRules'),
        oldValue: rulesLine(old, ctx, t),
        newValue: rulesLine(next, ctx, t),
        confirm: false,
      });
    }
    // GOTV: saved with the rest, no confirmation.
    if (JSON.stringify(old.broadcast ?? {}) !== JSON.stringify(next.broadcast ?? {})) {
      changes.push({
        field: 'broadcast',
        label: t('tournament.broadcast.title', { ns: 'cs2' }),
        oldValue: JSON.stringify(old.broadcast ?? {}),
        newValue: JSON.stringify(next.broadcast ?? {}),
        confirm: false,
      });
    }
    return changes;
  },
};
