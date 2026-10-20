/**
 * A team voice channel's name and who may use it (matchVoice.ts), kept apart
 * from the database so they can be checked on their own.
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

/** "Granite · R4 M2": the team and the match, as Discord allows (1–100 characters). */
export function voiceChannelName(team: string, round: number, matchNumber: number): string {
  const name = `${team.trim() || 'Team'} · R${round} M${matchNumber}`;
  return name.slice(0, 100);
}
