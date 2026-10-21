/**
 * Who may use the bot's channels (teamChannels.ts, tournamentSpace.ts), kept
 * apart from the database so it can be checked on its own.
 */

// Discord permission bits.
const VIEW = 1n << 10n;
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
const SEND = 1n << 11n;
const HISTORY = 1n << 16n;
const MOVE = 1n << 24n;
const MANAGE_CHANNELS = 1n << 4n;

// A type, not an interface: it goes into a JSON request body (JsonValue).
type Overwrite = {
  id: string;
  type: 0 | 1;
  allow: string;
  deny: string;
};

/** What a team's players may do in its voice channel, and in its text channel. */
export const VOICE_MEMBER = VIEW | CONNECT | SPEAK;
export const TEXT_MEMBER = VIEW | SEND | HISTORY;

/** What a tournament's players may not do in its Lobby: they wait and listen. */
export const LISTEN_ONLY = SPEAK;
/** What they may not do in #matches and #results, which the bot writes. */
export const SEND_MESSAGES = SEND;

/**
 * A tournament's category (tournamentSpace.ts): only its players' role sees it,
 * and the bot, which makes and moves in it. Without a role (Discord refused it)
 * nobody but the bot and the server's admins sees it.
 */
export function spaceOverwrites(
  guildId: string,
  botId: string,
  roleId: string | null
): Overwrite[] {
  return [
    { id: guildId, type: 0, allow: '0', deny: String(VIEW | CONNECT) },
    {
      id: botId,
      type: 1,
      allow: String(VIEW | CONNECT | MOVE | MANAGE_CHANNELS | SEND | HISTORY),
      deny: '0',
    },
    ...(roleId
      ? [{ id: roleId, type: 0 as const, allow: String(VOICE_MEMBER | TEXT_MEMBER), deny: '0' }]
      : []),
  ];
}

/** A team-only channel: nobody else sees or joins it (@everyone's id is the server's). */
export function teamOverwrites(
  guildId: string,
  botId: string,
  memberIds: string[],
  memberAllow: bigint = VOICE_MEMBER
): Overwrite[] {
  return [
    { id: guildId, type: 0, allow: '0', deny: String(VIEW | CONNECT) },
    { id: botId, type: 1, allow: String(VIEW | CONNECT | MOVE | MANAGE_CHANNELS), deny: '0' },
    ...[...new Set(memberIds)].map((id) => ({
      id,
      type: 1 as const,
      allow: String(memberAllow),
      deny: '0',
    })),
  ];
}
