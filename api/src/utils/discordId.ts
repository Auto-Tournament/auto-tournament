/**
 * Validating a player's Discord user ID.
 *
 * The Discord ID is contact data, nothing more: it lets an admin (and the
 * Discord bot, through a service token) find and reach a player on Discord. It
 * is NOT a login and is never linked to an auth identity. Nothing here or
 * anywhere else lets a Discord account sign in as the player it is stored on,
 * which is why a value typed in by the player, or by whoever filled in a signup
 * sheet, is acceptable to store at all.
 *
 * Some players are children, so the ID is treated as private: it only ever
 * appears in admin-guarded responses, and full IDs are not written to logs.
 *
 * Two kinds of writes arrive here, and they get different treatment:
 * - an explicit edit (admin form, player self-service) must be exactly right,
 *   so a bad value is a 400 — see `parseDiscordIdEdit`;
 * - an import (team roster, bulk player import) must never fail because of one
 *   bad cell, so a bad value is dropped with a warning — see
 *   `normalisePlayerDiscordIds`.
 *
 * Kept free of database imports so it can be tested as the pure function it
 * is — importing the services pulls in a connection pool.
 */

/**
 * A Discord user ID is a snowflake: a 64-bit integer, written as 17–20 decimal
 * digits. A username ("ola#1234", "ola.gamer") is not an ID, and cannot be
 * resolved to one without calling Discord, so it is refused rather than
 * guessed at.
 */
const DISCORD_ID_PATTERN = /^\d{17,20}$/;

export function isValidDiscordId(value: unknown): value is string {
  return typeof value === 'string' && DISCORD_ID_PATTERN.test(value);
}

/**
 * Shorten an ID for a warning or a log line. The admin already has the full
 * value in the file they uploaded; the message only has to say which one it was
 * about, and a log file should not become a directory of children's Discord IDs.
 */
export function abbreviateId(value: string): string {
  return value.length <= 4 ? value : `${value.slice(0, 4)}…`;
}

/**
 * Abbreviate Discord IDs that appear as path segments, for request logging.
 *
 * `GET /api/players/by-discord-id/:discordId` carries the ID in the URL, and
 * every request path is logged at info level (and failed auth at warn). Without
 * this, the bot's lookups would write a log line per child's Discord ID.
 *
 * Two ways the full ID could slip past a naive pattern, both of which Express
 * still routes to the lookup:
 * - case: Express matches routes case-insensitively, so `/By-Discord-Id/...`
 *   is the same request;
 * - percent-encoding: `req.path` is not decoded, but route params are, so
 *   `%31%32...` arrives at the handler as a valid ID.
 *
 * So the segment after `by-discord-id` (and after `/me/discord-id`, in case a
 * value is ever appended there) is matched case-insensitively, and any run of
 * digits, plain or `%3X`-encoded, that decodes to 5 or more digits is
 * abbreviated. That covers every 17–20 digit ID and near-misses a client got
 * wrong. Only these segments are touched: Steam IDs elsewhere in a path stay
 * readable for debugging.
 */
const DISCORD_ID_PATH_SEGMENT = /(\/(?:by-)?discord-id\/)([^/?#]+)/gi;
const PATH_DIGIT_RUN = /(?:\d|%3\d)+/gi;

export function redactDiscordIdsInPath(path: string): string {
  return path.replace(DISCORD_ID_PATH_SEGMENT, (_match, prefix: string, segment: string) => {
    const masked = segment.replace(PATH_DIGIT_RUN, (run) => {
      const decoded = run.replace(/%3(\d)/gi, '$1');
      return decoded.length >= 5 ? abbreviateId(decoded) : run;
    });
    return `${prefix}${masked}`;
  });
}

/** How a player is named in a warning — the name and Steam ID the admin sent. */
export function describePlayer(player: { name?: unknown; steamId?: unknown }): string {
  const name = typeof player.name === 'string' && player.name.length > 0 ? player.name : 'Unknown';
  const steamId = typeof player.steamId === 'string' ? player.steamId : 'unknown';
  return `Player "${name}" (${steamId})`;
}

const NUMBER_EXPLANATION =
  'Discord IDs are larger than a JSON number can hold exactly, so a number has already lost ' +
  'its last digits by the time it arrives. Send it as a string.';

/**
 * The result of reading a `discordId` field from an explicit edit.
 *
 * `absent` and `clear` are different on purpose: on an update, a missing key
 * means "leave it alone" while `null` means "remove it".
 */
export type DiscordIdEdit =
  | { kind: 'absent' }
  | { kind: 'clear' }
  | { kind: 'set'; value: string }
  | { kind: 'invalid'; error: string };

/**
 * Read `discordId` from an explicit edit (admin create/update, self-service).
 *
 * - `undefined` → absent;
 * - `null`, `""` or whitespace → clear;
 * - a 17–20 digit string (trimmed) → set;
 * - a JSON number → invalid, by name. Coercing it back to a string would store
 *   a *different, valid-looking* ID — possibly someone else's — which is the
 *   worst thing this function could do;
 * - anything else → invalid.
 */
export function parseDiscordIdEdit(raw: unknown): DiscordIdEdit {
  if (raw === undefined) return { kind: 'absent' };
  if (raw === null) return { kind: 'clear' };

  if (typeof raw === 'number') {
    return { kind: 'invalid', error: `discordId must be a string, not a number. ${NUMBER_EXPLANATION}` };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { kind: 'clear' };
    if (isValidDiscordId(trimmed)) return { kind: 'set', value: trimmed };
  }

  return {
    kind: 'invalid',
    error:
      'discordId must be a Discord user ID: 17–20 digits, as a string. ' +
      'A username is not an ID; in Discord, enable Developer Mode and use "Copy User ID".',
  };
}

/** A valid Discord ID that arrived with an import, waiting to be applied. */
export interface ImportedDiscordId {
  steamId: string;
  name: string;
  discordId: string;
}

/**
 * Split the `discordId`s out of an imported roster.
 *
 * Returns the players with the `discordId` key removed — the roster JSON a team
 * stores is visible in places a Discord ID must not be, so it never goes there —
 * plus the valid IDs to apply to the players table, plus a warning for every
 * value that was dropped.
 *
 * - a valid ID is kept, trimmed;
 * - `undefined`, `null`, and empty or whitespace-only strings mean "this player
 *   has no Discord ID" and are dropped without comment, because that is exactly
 *   what an export for a player without one looks like. They do NOT clear a
 *   stored value: an import never overwrites (see
 *   `playerService.applyImportedDiscordIds`);
 * - a JSON number, or anything else, is dropped *with* a warning.
 *
 * Never throws: a bad Discord ID must not stop a team from being imported.
 */
export function normalisePlayerDiscordIds<P extends { steamId: string; name: string }>(
  players: P[]
): {
  players: P[];
  discordIds: ImportedDiscordId[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const discordIds: ImportedDiscordId[] = [];

  const stripped = players.map((player) => {
    if (!player || typeof player !== 'object' || !('discordId' in player)) {
      return player;
    }

    const { discordId: raw, ...rest } = player as P & { discordId?: unknown };
    const parsed = parseDiscordIdEdit(raw);

    if (parsed.kind === 'set') {
      discordIds.push({ steamId: player.steamId, name: player.name, discordId: parsed.value });
    } else if (parsed.kind === 'invalid') {
      warnings.push(
        typeof raw === 'number'
          ? `${describePlayer(player)}: Discord ID was sent as a number, which loses precision for Discord IDs; it was not stored. Send it as a string.`
          : `${describePlayer(player)}: Discord ID is not a valid Discord user ID (17–20 digits); it was not stored.`
      );
    }

    return rest as unknown as P;
  });

  return { players: stripped, discordIds, warnings };
}
