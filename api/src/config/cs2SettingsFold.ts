/**
 * Folds the CS2 columns of core's tournament tables into CS2's own settings
 * object (DESIGN-modules §6 item 10, the rest after #343):
 *
 *   tournament.maps, map_sequence, max_rounds, overtime_mode, overtime_segments
 *     → tournament.settings.cs2 { maps, mapSequence, maxRounds, overtimeMode, overtimeSegments }
 *   tournament_templates.map_pool_id, maps
 *     → tournament_templates.settings.cs2 { mapPoolId, maps }
 *
 * and then drops those columns, so core's schema holds no CS2 data. From 3.0
 * the CS2 module reads and writes that object itself
 * (`GameIntegration.tournamentSettings`); the core stores it without reading
 * it. This is the one place in core that still knows the 2.x column names,
 * the way config/cs2TableHandover.ts is for CS2's 2.x tables.
 *
 * Runs as a core schema migration (schemaMigrations.ts), so it is one
 * transaction together with its ledger row: the rows are rewritten and the
 * columns dropped, or nothing is. It does not depend on the CS2 module being
 * installed: the data stays in a core row, under the key CS2 reads.
 *
 * - A NULL column becomes an absent field, which every reader already
 *   treated the same (the response left it out, config generation used its
 *   default). Nothing else is rewritten: a stored `overtime_mode` outside
 *   'enabled'/'disabled' is kept as it is.
 * - A CS2 row (game 'cs2' or NULL) is always folded. Another game's row
 *   (manual reporting, a game pack) is folded only when a column holds
 *   something other than its default (`maps` '[]', 24 rounds, overtime
 *   'enabled', the rest NULL): those columns meant nothing to that game, but
 *   a value someone set is kept rather than dropped.
 * - When a row already has a `cs2` object (a database that ran 3.0, went
 *   back to 2.4 without its backup and came forward again), the columns win
 *   field by field: they are what 2.4 wrote last.
 * - A settings value or a `maps` column that is not the JSON it must be
 *   stops the migration and names the row, and the transaction rolls back:
 *   folding it would lose it. Nothing is dropped, and the next start tries
 *   again after the row is fixed.
 * - Every step checks before it acts, so a database whose columns are
 *   already gone (a fresh one, or this run done) is left alone.
 */

import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

/** The key CS2's object lives under in `settings` (CS2's `CS2_SETTINGS_KEY`). */
export const CS2_SETTINGS_KEY = 'cs2';

/** The 2.x tournament columns, in the order they are folded and dropped. */
export const LEGACY_TOURNAMENT_COLUMNS = [
  'maps',
  'map_sequence',
  'max_rounds',
  'overtime_mode',
  'overtime_segments',
] as const;

/** The 2.x tournament template columns. */
export const LEGACY_TEMPLATE_COLUMNS = ['map_pool_id', 'maps'] as const;

export interface Cs2SettingsFoldResult {
  /** Tournament rows whose settings got a `cs2` object from the columns. */
  tournaments: number;
  /** Template rows whose settings got a `cs2` object from the columns. */
  templates: number;
  /** Rows of another game whose columns held only defaults, left without one. */
  skipped: number;
  /** `table.column` dropped by this run. */
  dropped: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCs2Game(game: unknown): boolean {
  if (game === null || game === undefined) return true;
  const id = String(game).trim().toLowerCase();
  return id === '' || id === 'cs2';
}

/** The columns of `table` that are still there, out of `candidates`. */
async function presentColumns(
  client: Queryable,
  table: string,
  candidates: readonly string[]
): Promise<string[]> {
  const { rows } = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  const have = new Set(rows.map((r) => r.column_name));
  return candidates.filter((c) => have.has(c));
}

/** `settings` as an object: NULL is `{}`; anything but a JSON object refuses the row. */
function settingsObject(raw: unknown, where: string): Record<string, unknown> {
  if (raw === null || raw === undefined || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error(
      `${where}: settings is not valid JSON, so the CS2 fields cannot be folded into it`
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(
      `${where}: settings is not a JSON object, so the CS2 fields cannot be folded into it`
    );
  }
  return parsed;
}

/** A JSON array of strings from a 2.x maps column; anything else refuses the row. */
function mapList(raw: unknown, column: string, where: string): string[] {
  let parsed: unknown;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error(`${where}: ${column} is not valid JSON`);
  }
  if (!Array.isArray(parsed) || !parsed.every((m) => typeof m === 'string')) {
    throw new Error(`${where}: ${column} is not a JSON array of map ids`);
  }
  return parsed as string[];
}

/** The CS2 fields a tournament row's columns hold. NULL columns are left out. */
function tournamentFields(row: Record<string, unknown>, columns: readonly string[], where: string) {
  const fields: Record<string, unknown> = {};
  const has = (c: string) => columns.includes(c) && row[c] !== null && row[c] !== undefined;
  if (has('maps')) fields.maps = mapList(row.maps, 'maps', where);
  if (has('map_sequence')) fields.mapSequence = mapList(row.map_sequence, 'map_sequence', where);
  if (has('max_rounds')) fields.maxRounds = Number(row.max_rounds);
  if (has('overtime_mode')) fields.overtimeMode = row.overtime_mode;
  if (has('overtime_segments')) fields.overtimeSegments = Number(row.overtime_segments);
  return fields;
}

/** Whether a tournament row's CS2 columns hold only what every row got by default. */
function onlyTournamentDefaults(fields: Record<string, unknown>): boolean {
  const maps = fields.maps as string[] | undefined;
  return (
    (maps === undefined || maps.length === 0) &&
    fields.mapSequence === undefined &&
    (fields.maxRounds === undefined || fields.maxRounds === 24) &&
    (fields.overtimeMode === undefined || fields.overtimeMode === 'enabled') &&
    fields.overtimeSegments === undefined
  );
}

function templateFields(row: Record<string, unknown>, columns: readonly string[], where: string) {
  const fields: Record<string, unknown> = {};
  const has = (c: string) => columns.includes(c) && row[c] !== null && row[c] !== undefined;
  if (has('map_pool_id')) fields.mapPoolId = Number(row.map_pool_id);
  if (has('maps')) fields.maps = mapList(row.maps, 'maps', where);
  return fields;
}

/** Fold one table's CS2 columns into its rows' settings, then drop them. */
async function foldTable(
  client: Queryable,
  table: 'tournament' | 'tournament_templates',
  candidates: readonly string[],
  fieldsOf: (
    row: Record<string, unknown>,
    columns: readonly string[],
    where: string
  ) => Record<string, unknown>,
  result: Cs2SettingsFoldResult
): Promise<number> {
  const columns = await presentColumns(client, table, candidates);
  if (columns.length === 0) return 0;
  const hasGame = (await presentColumns(client, table, ['game'])).length > 0;

  const select = ['id', 'settings', ...(hasGame ? ['game'] : []), ...columns].join(', ');
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT ${select} FROM ${table} ORDER BY id`
  );

  let folded = 0;
  for (const row of rows) {
    const where = `${table} row ${String(row.id)}`;
    const fields = fieldsOf(row, columns, where);
    const cs2 = isCs2Game(hasGame ? row.game : null);
    const empty =
      table === 'tournament' ? onlyTournamentDefaults(fields) : Object.keys(fields).length === 0;
    if (!cs2 && empty) {
      result.skipped++;
      continue;
    }
    if (cs2 && Object.keys(fields).length === 0 && table === 'tournament_templates') {
      // A template that never had a pool or maps: nothing to keep.
      continue;
    }
    const settings = settingsObject(row.settings, where);
    const existing = isRecord(settings[CS2_SETTINGS_KEY]) ? settings[CS2_SETTINGS_KEY] : {};
    settings[CS2_SETTINGS_KEY] = { ...(existing as Record<string, unknown>), ...fields };
    await client.query(`UPDATE ${table} SET settings = $1 WHERE id = $2`, [
      JSON.stringify(settings),
      row.id,
    ]);
    folded++;
  }

  for (const column of columns) {
    // Dropping map_pool_id drops its key onto cs2_map_pools with it.
    await client.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column}`);
    result.dropped.push(`${table}.${column}`);
  }
  return folded;
}

/** See the top of this file. Idempotent; throws (to roll back) on a row it cannot fold. */
export async function foldCs2TournamentColumns(client: Queryable): Promise<Cs2SettingsFoldResult> {
  const result: Cs2SettingsFoldResult = { tournaments: 0, templates: 0, skipped: 0, dropped: [] };
  result.tournaments = await foldTable(
    client,
    'tournament',
    LEGACY_TOURNAMENT_COLUMNS,
    tournamentFields,
    result
  );
  result.templates = await foldTable(
    client,
    'tournament_templates',
    LEGACY_TEMPLATE_COLUMNS,
    templateFields,
    result
  );
  return result;
}
