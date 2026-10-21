/**
 * The Discord server's invite link, made by the bot (Modules → Discord bot):
 * players who are not on the server are asked to join with it. One invite
 * that never expires, kept while Discord still knows it and made again if
 * someone deleted it. Needs the bot's Create Invite permission.
 */
import { db } from '../../config/database';
import type { Untrusted } from '../../utils/untrusted';
import { botToken, pickedGuildId } from './bot';
import { discordFetch } from './rest';

const KEY = 'discord_server_invite';
/** How long a checked invite is trusted before it is checked with Discord again. */
const CHECK_MS = 60 * 60 * 1000;

let checked: { code: string; at: number } | null = null;

/** The server's invite link, made now if there is none; null when the bot cannot make one. */
export async function serverInvite(): Promise<string | null> {
  const token = await botToken();
  const guildId = await pickedGuildId();
  if (!token || !guildId) return null;
  const stored = await db.getAppSettingAsync(KEY).catch(() => null);
  if (stored && checked?.code === stored && Date.now() - checked.at < CHECK_MS) {
    return `https://discord.gg/${stored}`;
  }
  if (stored) {
    const known = await discordFetch(token, `/invites/${stored}`);
    if (known.ok && (known.body.guild as { id?: string } | undefined)?.id === guildId) {
      checked = { code: stored, at: Date.now() };
      return `https://discord.gg/${stored}`;
    }
  }
  // The server's welcome channel, else its first text channel.
  const guild = await discordFetch(token, `/guilds/${guildId}`);
  const listed = await discordFetch(token, `/guilds/${guildId}/channels`);
  const text = Array.isArray(listed.body)
    ? (listed.body as Array<Record<string, Untrusted>>)
        .filter((c) => c.type === 0 && typeof c.id === 'string')
        .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    : [];
  const channelId =
    typeof guild.body.system_channel_id === 'string'
      ? guild.body.system_channel_id
      : (text[0]?.id as string | undefined);
  if (!channelId) return null;
  const made = await discordFetch(token, `/channels/${channelId}/invites`, {
    method: 'POST',
    body: { max_age: 0, max_uses: 0, unique: false },
  });
  const code = made.ok && typeof made.body.code === 'string' ? made.body.code : null;
  if (!code) return null;
  await db.setAppSettingAsync(KEY, code);
  checked = { code, at: Date.now() };
  return `https://discord.gg/${code}`;
}
