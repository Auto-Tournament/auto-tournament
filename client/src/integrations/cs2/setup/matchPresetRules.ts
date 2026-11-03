/**
 * The Match settings presets (pure: tested on their own): what Standard and Valve official set,
 * what a tournament ends up with, and what differs from the site's defaults (the orange marks).
 */
import type { TFunction } from 'i18next';
import type { Cs2TournamentSettings } from './cs2TournamentSettings';

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
  const patch: Partial<Cs2TournamentSettings> = { [key]: same ? null : value };
  return patch;
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
  const label = (k: PresetKey) => {
    if (k === 'defaultAgents') return t('tournament.defaultAgents.label', { ns: 'cs2' });
    if (k === 'autoStartMinutes') return t('tournament.autoStart.label', { ns: 'cs2' });
    return t(`tournament.matchSettings.${k}.label`, { ns: 'cs2' });
  };
  return keys.length
    ? keys.map(label).join(', ')
    : t('tournament.matchSettings.none', { ns: 'cs2' });
}
