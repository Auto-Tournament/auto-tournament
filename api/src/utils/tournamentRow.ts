import type { DbTournamentRow } from '../types/database.types';
import type { TournamentResponse, TournamentSettings } from '../types/tournament.types';

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function nullToUndefined<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

/**
 * Settings as stored, with `matchFormat` pinned to the tournament's `format`
 * column. The two used to drift: editing the format only wrote `format`, so a
 * tournament switched from bo3 to bo1 kept `settings.matchFormat: 'bo3'`.
 * `format` is the canonical value; the settings copy is kept for templates and
 * clients that read it.
 */
export function normalizeTournamentSettings(
  settings: Partial<TournamentSettings> | null | undefined,
  format: string | null | undefined
): TournamentSettings {
  const base = { ...(settings ?? {}) } as TournamentSettings;
  if (format === 'bo1' || format === 'bo3' || format === 'bo5') {
    base.matchFormat = format;
  }
  return base;
}

/**
 * The tournament row as the object config generation expects.
 *
 * Several routes and services used to build this by hand. One of them (the
 * simulated veto) left out maxRounds, overtime and team size, so the config it
 * stored after an automated veto used MatchZy defaults (24 rounds) instead of
 * the tournament's rules. Every caller goes through here now, so a new column
 * only has to be added once.
 *
 * `teams` is left empty: config generation loads teams itself.
 */
export function tournamentRowToResponse(row: DbTournamentRow): TournamentResponse {
  return {
    id: row.id,
    name: row.name,
    type: row.type as TournamentResponse['type'],
    format: row.format as TournamentResponse['format'],
    status: row.status as TournamentResponse['status'],
    maps: parseJson<string[]>(row.maps, []),
    teamIds: parseJson<string[]>(row.team_ids, []),
    settings: normalizeTournamentSettings(
      parseJson<Partial<TournamentSettings>>(row.settings, {}),
      row.format
    ),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    teams: [],
    mapSequence: row.map_sequence ? parseJson<string[] | undefined>(row.map_sequence, undefined) : undefined,
    teamSize: nullToUndefined(row.team_size),
    maxRounds: nullToUndefined(row.max_rounds),
    overtimeMode: (row.overtime_mode as 'enabled' | 'disabled' | null) || undefined,
    overtimeSegments: nullToUndefined(row.overtime_segments),
    eloTemplateId: row.elo_template_id ?? undefined,
  };
}
