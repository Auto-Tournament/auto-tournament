/**
 * Building blocks for `SettingDefinition`s (the core's `CORE_SETTINGS` in
 * `services/settingsService.ts`, and the ones integrations contribute). Two
 * halves:
 *
 * - `normalize*`: what the settings store does with a trimmed value before
 *   saving it (`settingsService.setSetting`);
 * - `*Request`: how a `PUT /api/settings` body field is type-checked and
 *   turned into the string handed to the store.
 *
 * The messages are part of the API: clients show them as they are.
 */

import type { SettingDefinition, SettingWriteContext } from '../integrations/types';

type Normalized = ReturnType<SettingDefinition['normalize']>;
type ApplyRequest = NonNullable<SettingDefinition['applyRequest']>;

// --- store -----------------------------------------------------------------

/** "1", "true", "yes", "on" and "enabled" (any case) are on; anything else is off. */
export function isTruthySetting(trimmed: string): boolean {
  const normalized = trimmed.toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on' ||
    normalized === 'enabled'
  );
}

/** Store as '1' / '0'; `describe` names the log line, e.g. `Player rating updates`. */
export function normalizeFlag(describe: string) {
  return (trimmed: string): Normalized => {
    const isEnabled = isTruthySetting(trimmed);
    return {
      value: isEnabled ? '1' : '0',
      message: `${describe} ${isEnabled ? 'enabled' : 'disabled'}`,
    };
  };
}

/** Store an integer within `[min, max]`. */
export function normalizeInteger(
  key: string,
  range: { min: number; max: number; message: string } | null
) {
  return (trimmed: string): Normalized => {
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      throw new Error(`${key} must be an integer`);
    }
    if (range && (parsed < range.min || parsed > range.max)) {
      throw new Error(range.message);
    }
    return { value: String(parsed), message: `${key} updated to ${parsed}` };
  };
}

/** Store the trimmed value as is. */
export function normalizeText(message: string) {
  return (trimmed: string): Normalized => ({ value: trimmed, message });
}

// --- PUT /api/settings -----------------------------------------------------

type Parsed = { value: string | null } | { error: string };

function applyParsed(parse: (value: unknown) => Parsed): ApplyRequest {
  return async (value: unknown, ctx: SettingWriteContext) => {
    const parsed = parse(value);
    if ('error' in parsed) return parsed.error;
    await ctx.set(parsed.value);
    return undefined;
  };
}

/** `true` / `false` / `null`, stored as '1' / '0' / cleared. */
export function booleanRequest(field: string): ApplyRequest {
  return applyParsed((value) => {
    if (typeof value !== 'boolean' && value !== null) {
      return { error: `${field} must be a boolean or null` };
    }
    return { value: value === null ? null : value === true ? '1' : '0' };
  });
}

/** `0` / `1` / a boolean / `null`: `true` and `1` are '1', any other number or `false` is '0'. */
export function binaryRequest(field: string): ApplyRequest {
  return applyParsed((value) => {
    if (typeof value !== 'number' && typeof value !== 'boolean' && value !== null) {
      return { error: `${field} must be 0, 1, boolean, or null` };
    }
    return { value: value === null ? null : value === true || value === 1 ? '1' : '0' };
  });
}

/** A string or `null`. */
export function stringRequest(field: string): ApplyRequest {
  return applyParsed((value) => {
    if (typeof value !== 'string' && value !== null) {
      return { error: `${field} must be a string or null` };
    }
    return { value: typeof value === 'string' ? value : null };
  });
}

/** A number or `null`; `expected` is how the error names the type, e.g. `a number (0-2)`. */
export function numberRequest(field: string, expected = 'a number'): ApplyRequest {
  return applyParsed((value) => {
    if (typeof value !== 'number' && value !== null) {
      return { error: `${field} must be ${expected} or null` };
    }
    return { value: value === null ? null : String(value) };
  });
}
