/**
 * Redaction for the per-query database logs (LOG_DB_VERBOSE / LOG_DB_VALUES,
 * both switched on by LOG_LEVEL=debug).
 *
 * Those logs print query parameters and sample rows, which is exactly what makes
 * them useful and exactly what makes them dangerous: they would otherwise write
 * secrets, and every player's Discord ID, to the log file. Some players are
 * children, and the Discord ID is admin-only contact data (see discordId.ts), so
 * a debug session must not turn the log into a directory of them.
 *
 * Kept pure and free of database imports so it can be unit-tested, and cheap,
 * because it runs on every query while verbose logging is on. It only ever runs
 * inside those verbose-logging guards: normal logging is unaffected.
 */

import { abbreviateId } from './discordId';

/**
 * Object keys whose values are never logged. Matched against the lowercased
 * key, so `discord_id`, `discordId` and `discord_id_edited_at` are all caught
 * (the last one is harmless, but "this ID was removed by hand" is still about
 * the ID, and a false positive in a debug log costs nothing).
 */
const REDACTED_KEY = /(password|secret|token|key|discord)/;

/** JSON for a log line, with sensitive keys masked and long strings cut. */
export function safeLogJson(value: unknown): string {
  try {
    return JSON.stringify(value, (k, v) => {
      const key = k.toLowerCase?.() ?? '';
      if (REDACTED_KEY.test(key)) return '***';
      if (typeof v === 'string' && v.length > 500) return v.slice(0, 500) + '…';
      return v;
    });
  } catch {
    return String(value);
  }
}

const MENTIONS_DISCORD_ID = /discord_id/i;
const ID_SHAPED = /^\d{17,20}$/;

/**
 * Positional parameters, safe to log for this statement.
 *
 * Positional params have no key for `safeLogJson` to recognise, so the SQL is
 * the only clue. In a statement that mentions `discord_id`, every 17–20 digit
 * string is abbreviated. That includes the Steam IDs in the same statement:
 * both are 17+ digit strings, and a snowflake can begin with Steam's 7656…
 * prefix, so there is no reliable way to tell them apart. Losing the tail of a
 * Steam ID in the handful of Discord-ID statements is the price.
 *
 * Deliberately NOT applied to every statement: Steam IDs are 17 digits too, and
 * they have to stay readable in the rest of the debug log to be of any use.
 */
export function redactParamsForLog(sql: string, params: unknown[] | undefined): unknown[] | undefined {
  if (!params || params.length === 0 || !MENTIONS_DISCORD_ID.test(sql)) return params;
  return params.map((param) =>
    typeof param === 'string' && ID_SHAPED.test(param) ? abbreviateId(param) : param
  );
}

/**
 * Values of an INSERT, safe to log: the column list is known, so a value is
 * masked by its column name exactly as `safeLogJson` masks an object key.
 */
export function redactInsertValuesForLog(columns: string[], values: unknown[]): unknown[] {
  if (!columns.some((column) => REDACTED_KEY.test(column.toLowerCase()))) return values;
  return values.map((value, i) =>
    REDACTED_KEY.test((columns[i] ?? '').toLowerCase()) ? '***' : value
  );
}
