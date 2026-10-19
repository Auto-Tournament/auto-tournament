/**
 * Discord user IDs are snowflakes: 17–20 digit strings. They must stay strings —
 * as JSON numbers they exceed Number.MAX_SAFE_INTEGER and silently lose digits.
 * This is the only place in the client that defines what a valid one looks like.
 */
import type { Untrusted } from './untrusted';
export const DISCORD_ID_PATTERN = /^\d{17,20}$/;

export function isValidDiscordId(value: Untrusted): value is string {
  return typeof value === 'string' && DISCORD_ID_PATTERN.test(value);
}

/**
 * Trim a user-entered Discord ID. Returns `undefined` for blank input so the
 * key can be omitted entirely for players without one.
 */
export function normalizeDiscordId(value: Untrusted): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * True when the user typed something that is not a valid Discord ID. Blank input
 * is not an error: the field is optional.
 */
export function isInvalidDiscordIdInput(value: Untrusted): boolean {
  const normalized = normalizeDiscordId(value);
  return normalized !== undefined && !isValidDiscordId(normalized);
}
