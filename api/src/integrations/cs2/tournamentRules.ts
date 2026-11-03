/**
 * A tournament's own match rules (settings.cs2: knife round, team ready, .gg, skins, agents,
 * timeouts and pauses): their checks, how a stored layer applies, and what Ready Up gets.
 */
import type { Untrusted } from '../../utils/untrusted';
import type { Cs2TournamentSettings } from './tournamentSettings';

const RULE_FLAGS = [
  'defaultAgents',
  'knifeRound',
  'teamReady',
  'giveUpVote',
  'platformSkins',
] as const;

/** The whole-number rule settings and their largest value (Ready Up's ruleset.cpp RuleTable). */
const RULE_NUMBERS = [
  ['tacticalTimeouts', 10],
  ['tacticalTimeoutSeconds', 300],
  ['technicalPauses', 20],
  ['technicalPauseSeconds', 3600],
] as const;

/**
 * The tournament's own match rules for Ready Up (pure: tested on its own). `overrides` are
 * Ready Up ruleset keys, sent in either ruleset; `teamReady` / `giveUpVote` replace the site's
 * when set; no knife round in esports unless the tournament asks (Valve's rules refuse it).
 */
export function tournamentMatchRules(cs2: Cs2TournamentSettings | null | undefined): {
  knifeRound: boolean;
  teamReady?: boolean;
  giveUpVote?: boolean;
  overrides: Record<string, number | string | boolean>;
} {
  const esports = cs2?.esportsMode === true;
  const overrides: Record<string, number | string | boolean> = {};
  if (defaultAgentsOn(cs2)) overrides.default_models = true;
  const skins = cs2?.platformSkins ?? !esports;
  if (skins === esports) overrides.cosmetics = skins ? 'plugin' : 'inventory';
  if (cs2?.tacticalTimeouts !== undefined) overrides.tac_timeouts = cs2.tacticalTimeouts;
  if (cs2?.tacticalTimeoutSeconds !== undefined)
    overrides.tac_timeout_seconds = Math.max(1, cs2.tacticalTimeoutSeconds);
  if (cs2?.technicalPauses !== undefined) overrides.tech_pauses_per_team = cs2.technicalPauses;
  if (cs2?.technicalPauseSeconds !== undefined)
    overrides.tech_pause_seconds = cs2.technicalPauseSeconds;
  const knifeRound = cs2?.knifeRound ?? !esports;
  if (esports && knifeRound) overrides.allow_knife = true;
  return {
    knifeRound,
    ...(cs2?.teamReady !== undefined ? { teamReady: cs2.teamReady } : {}),
    ...(cs2?.giveUpVote !== undefined ? { giveUpVote: cs2.giveUpVote } : {}),
    overrides,
  };
}

/** Whether a tournament's matches use the default agents: its own choice, else on in esports mode. */
export function defaultAgentsOn(
  cs2: Pick<Cs2TournamentSettings, 'defaultAgents' | 'esportsMode'> | null | undefined
): boolean {
  return cs2?.defaultAgents ?? cs2?.esportsMode === true;
}

/** The rule fields' errors, empty when they are valid (null: back to the site's or preset's). */
export function ruleFieldErrors(cs2: Record<string, Untrusted>): string[] {
  for (const key of RULE_FLAGS) {
    const v = cs2[key];
    if (v !== undefined && v !== null && typeof v !== 'boolean')
      return [`${key} must be a boolean`];
  }
  for (const [key, max] of RULE_NUMBERS) {
    const v = cs2[key];
    if (
      v !== undefined &&
      v !== null &&
      !(typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max)
    )
      return [`${key} must be a whole number, 0 to ${max}`];
  }
  return [];
}

/** A stored or requested layer's rule fields onto `into`; null removes one. */
export function applyRuleFields(
  into: Cs2TournamentSettings,
  layer: Record<string, Untrusted>
): void {
  for (const key of RULE_FLAGS) {
    const v = layer[key];
    if (typeof v === 'boolean') into[key] = v;
    else if (v === null) delete into[key];
  }
  for (const [key] of RULE_NUMBERS) {
    const v = layer[key];
    if (typeof v === 'number') into[key] = v;
    else if (v === null) delete into[key];
  }
}

/** The rule fields a tournament has set, for its stored settings. */
export function ruleFieldsOf(
  value: Cs2TournamentSettings | undefined
): Partial<Cs2TournamentSettings> {
  const out: Partial<Cs2TournamentSettings> = {};
  for (const key of RULE_FLAGS) if (value?.[key] !== undefined) out[key] = value[key];
  for (const [key] of RULE_NUMBERS) if (value?.[key] !== undefined) out[key] = value[key];
  return out;
}
