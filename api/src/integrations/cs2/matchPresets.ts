/**
 * Match setting presets (the setup's Match settings dropdown): an admin saves a tournament's
 * match settings under a name, and every admin's setup offers it next to the built-in Standard
 * and Valve official. Only match settings: no format, maps or teams (that is a template).
 */
import { db } from '../../config/database';
import type { Untrusted } from '../../utils/untrusted';
import { ruleFieldErrors } from './tournamentRules';

export interface MatchPreset {
  id: string;
  name: string;
  settings: Record<string, Untrusted>;
  updatedAt: number;
}

/** At most this many: a dropdown, not a library. */
export const MAX_PRESETS = 20;
const BOOLEANS = ['esportsMode', 'fillTeamsWithBots', 'highlights', 'skinRewards'] as const;
const RULES = [
  'defaultAgents',
  'knifeRound',
  'teamReady',
  'giveUpVote',
  'platformSkins',
  'tacticalTimeouts',
  'tacticalTimeoutSeconds',
  'technicalPauses',
  'technicalPauseSeconds',
] as const;

/**
 * A preset's settings from a request (pure: tested on its own): only the match setting fields,
 * each checked; anything else is dropped. An error names the first bad field.
 */
export function presetSettingsOf(raw: Untrusted): {
  settings: Record<string, Untrusted>;
  error?: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { settings: {}, error: 'settings must be an object' };
  const input = raw as Record<string, Untrusted>;
  const out: Record<string, Untrusted> = {};
  const ruleError = ruleFieldErrors(input)[0];
  if (ruleError) return { settings: {}, error: ruleError };
  for (const key of RULES)
    if (input[key] !== undefined && input[key] !== null) out[key] = input[key];
  for (const key of BOOLEANS) {
    if (input[key] === undefined || input[key] === null) continue;
    if (typeof input[key] !== 'boolean') return { settings: {}, error: `${key} must be a boolean` };
    out[key] = input[key];
  }
  const whole = (key: string, min: number, max: number) => {
    const v = input[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      return `${key} must be a whole number, ${min} to ${max}`;
    out[key] = v;
    return null;
  };
  const numberError =
    whole('maxRounds', 1, 30) ??
    whole('overtimeSegments', 0, 10) ??
    whole('autoStartMinutes', 0, 120);
  if (numberError) return { settings: {}, error: numberError };
  if (input.overtimeMode !== undefined && input.overtimeMode !== null) {
    if (input.overtimeMode !== 'enabled' && input.overtimeMode !== 'disabled')
      return { settings: {}, error: 'overtimeMode must be enabled or disabled' };
    out.overtimeMode = input.overtimeMode;
  }
  if (input.connectVia !== undefined && input.connectVia !== null) {
    if (input.connectVia !== 'auto' && input.connectVia !== 'lan' && input.connectVia !== 'public')
      return { settings: {}, error: 'connectVia must be auto, lan or public' };
    out.connectVia = input.connectVia;
  }
  return { settings: out };
}

/** A preset's id from its name: lower case, dashes ("LAN night" -> "lan-night"). */
export function presetIdOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

interface Row {
  id: string;
  name: string;
  settings: string;
  updated_at: number;
}

export async function listPresets(): Promise<MatchPreset[]> {
  const rows = await db.queryAsync<Row>(
    'SELECT id, name, settings, updated_at FROM cs2_match_presets ORDER BY name'
  );
  return rows.map((r) => {
    let settings: Record<string, Untrusted> = {};
    try {
      settings = presetSettingsOf(JSON.parse(r.settings)).settings;
    } catch {
      // A row that no longer parses keeps its name; its settings are empty.
    }
    return { id: r.id, name: r.name, settings, updatedAt: Number(r.updated_at) };
  });
}

/** Saves (or replaces, same name) a preset; null when the list is full. */
export async function savePreset(
  name: string,
  settings: Record<string, Untrusted>
): Promise<MatchPreset | null> {
  const id = presetIdOf(name);
  const now = Math.floor(Date.now() / 1000);
  const existing = await db.queryOneAsync<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM cs2_match_presets WHERE id <> ?',
    [id]
  );
  if ((existing?.n ?? 0) >= MAX_PRESETS) return null;
  await db.runAsync(
    `INSERT INTO cs2_match_presets (id, name, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at`,
    [id, name, JSON.stringify(settings), now, now]
  );
  return { id, name, settings, updatedAt: now };
}

export async function deletePreset(id: string): Promise<boolean> {
  const r = await db.runAsync('DELETE FROM cs2_match_presets WHERE id = ?', [id]);
  return r.changes > 0;
}
