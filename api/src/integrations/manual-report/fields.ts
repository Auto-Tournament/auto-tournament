/**
 * The extra numbers a tournament asks reporters for (3.0 phase D, PR D5).
 *
 * A game MAT cannot watch produces no statistics of its own, so anything
 * beyond the score has to be typed in: goals and saves in Rocket League, laps
 * in Trackmania, a rating in chess. Which of those a tournament wants is a
 * decision about *that tournament*, not about the game — two Rocket League
 * cups on one instance can disagree — so `custom_stat_fields` is keyed on the
 * tournament (D1's schema) and an admin edits it here.
 *
 * `key` is the stable name within a tournament, and what a value is stored
 * against; `label` is what a reporter reads. Renaming a label keeps the
 * recorded values, renaming a key does not — see `replaceFields`.
 *
 * The values themselves are `./statValues` (PR D6): a report carries them,
 * they are checked against these fields, and they are read back on the match
 * and summed over the tournament. Nothing here or there feeds ratings — the
 * rating maths stays on the CS2 metrics path, and a custom field is display
 * only.
 */

import { db } from '../../config/database';
import type {
  CustomStatScope,
  CustomStatValueType,
  DbCustomStatFieldRow,
} from '../../types/matchReport.types';

export interface CustomStatField {
  id: number;
  key: string;
  label: string;
  valueType: CustomStatValueType;
  scope: CustomStatScope;
  required: boolean;
  displayOrder: number;
}

/** What an admin sends: the same thing without the id the database assigns. */
export interface CustomStatFieldInput {
  key: string;
  label: string;
  valueType?: CustomStatValueType;
  scope?: CustomStatScope;
  required?: boolean;
}

/**
 * What a field may hold. `integer` is separate from `number` so a goal count
 * refuses 1.5 while a possession percentage does not (3.0 phase D, PR D6);
 * both are stored in `match_stat_values.value_number`, so it needed no
 * migration.
 */
const VALUE_TYPES: readonly string[] = ['number', 'integer', 'text'];
const SCOPES: readonly string[] = ['player', 'team'];

/** Keys are typed into a URL and matched against stored values, so keep them plain. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function toField(row: DbCustomStatFieldRow): CustomStatField {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    valueType:
      row.value_type === 'text' ? 'text' : row.value_type === 'integer' ? 'integer' : 'number',
    scope: row.scope === 'team' ? 'team' : 'player',
    required: Number(row.required) === 1,
    displayOrder: Number(row.display_order),
  };
}

/** A tournament's fields, in the order a report form should show them. */
export async function listFields(tournamentId: number): Promise<CustomStatField[]> {
  const rows = await db.queryAsync<DbCustomStatFieldRow>(
    `SELECT * FROM custom_stat_fields
      WHERE tournament_id = ?
      ORDER BY display_order, id`,
    [tournamentId]
  );
  return rows.map(toField);
}

export type FieldsCheck =
  | { ok: true; fields: CustomStatFieldInput[] }
  | { ok: false; error: string };

/**
 * Check a whole set of fields before any of it is written.
 *
 * All or nothing on purpose: a half-applied set would leave a tournament
 * asking for fields an admin had already replaced.
 */
export function validateFields(input: unknown): FieldsCheck {
  if (!Array.isArray(input)) return { ok: false, error: 'fields must be an array' };
  if (input.length > 50) {
    return { ok: false, error: 'A tournament may ask for at most 50 extra fields' };
  }

  const fields: CustomStatFieldInput[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of input.entries()) {
    const where = `Field ${index + 1}`;
    const entry = (raw ?? {}) as Partial<CustomStatFieldInput>;
    const key = typeof entry.key === 'string' ? entry.key.trim().toLowerCase() : '';
    if (!KEY_PATTERN.test(key)) {
      return {
        ok: false,
        error: `${where}: key must be 1-40 characters of a-z, 0-9, '_' or '-', starting with a letter or digit`,
      };
    }
    if (seen.has(key)) return { ok: false, error: `${where}: '${key}' is listed twice` };
    seen.add(key);

    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) return { ok: false, error: `${where}: label is required` };
    if (label.length > 80) return { ok: false, error: `${where}: label is longer than 80 characters` };

    const valueType = entry.valueType ?? 'number';
    if (!VALUE_TYPES.includes(valueType)) {
      return { ok: false, error: `${where}: valueType must be 'number', 'integer' or 'text'` };
    }
    const scope = entry.scope ?? 'player';
    if (!SCOPES.includes(scope)) {
      return { ok: false, error: `${where}: scope must be 'player' or 'team'` };
    }

    fields.push({ key, label, valueType, scope, required: entry.required === true });
  }

  return { ok: true, fields };
}

/**
 * Make a tournament's fields exactly the given list.
 *
 * Matched on `key`, so a field that stays keeps its row — and therefore every
 * value already recorded against it — while its label, type, scope and place
 * in the form can all change. A key that is not in the list is **deleted**,
 * and `match_stat_values.field_id` cascades, so the values recorded for it go
 * with it. That is the honest behaviour for "these are the fields now", and it
 * is why the route that calls this is admin-only.
 */
export async function replaceFields(
  tournamentId: number,
  fields: CustomStatFieldInput[]
): Promise<CustomStatField[]> {
  const keys = fields.map((f) => f.key);

  await db.runAsync(
    keys.length > 0
      ? 'DELETE FROM custom_stat_fields WHERE tournament_id = ? AND NOT (key = ANY(?::text[]))'
      : 'DELETE FROM custom_stat_fields WHERE tournament_id = ?',
    keys.length > 0 ? [tournamentId, keys] : [tournamentId]
  );

  for (const [index, field] of fields.entries()) {
    await db.runAsync(
      `INSERT INTO custom_stat_fields
         (tournament_id, key, label, value_type, scope, required, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tournament_id, key) DO UPDATE SET
         label = EXCLUDED.label,
         value_type = EXCLUDED.value_type,
         scope = EXCLUDED.scope,
         required = EXCLUDED.required,
         display_order = EXCLUDED.display_order,
         updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
      [
        tournamentId,
        field.key,
        field.label,
        field.valueType ?? 'number',
        field.scope ?? 'player',
        field.required ? 1 : 0,
        index,
      ]
    );
  }

  return listFields(tournamentId);
}
