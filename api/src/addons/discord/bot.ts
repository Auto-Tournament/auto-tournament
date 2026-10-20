/**
 * The site's Discord bot (Settings → Integrations): its token, stored
 * encrypted, and the REST calls it makes. Player DMs (notifyChannels) use it.
 */
import { db } from '../../config/database';
import { decryptSecret, encryptSecret } from '../../utils/secretBox';
import type { Untrusted } from '../../utils/untrusted';
import { discordFetch, type DiscordAnswer } from './rest';
import { isAddonRunning } from '../registry';

const BOT_TOKEN_KEY = 'discord_bot_token';
const GUILD_KEY = 'discord_guild_id';

export class ChannelError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** The stored bot token, whether the add-on is on or not. */
async function botTokenStored(): Promise<string | null> {
  const stored = await db.getAppSettingAsync(BOT_TOKEN_KEY).catch(() => null);
  return decryptSecret(stored);
}

/** The bot token, while the Discord add-on is on; null while it is off. */
export async function botToken(): Promise<string | null> {
  return isAddonRunning('discord') ? botTokenStored() : null;
}

/** The Discord server the site uses, without asking Discord. */
export async function pickedGuildId(): Promise<string | null> {
  return (await db.getAppSettingAsync(GUILD_KEY).catch(() => null)) ?? null;
}

export const discordBot = {
  /** Whether a token is stored, and the bot's name when it answers. */
  async status(): Promise<{ set: boolean; name: string | null }> {
    const token = await botToken();
    if (!token) return { set: false, name: null };
    try {
      const me = await discordFetch(token, '/users/@me');
      return { set: true, name: me.ok ? String(me.body.username ?? '') || null : null };
    } catch {
      return { set: true, name: null };
    }
  },

  /** Check the token with Discord, then store it encrypted. Null clears it. */
  async setToken(token: string | null): Promise<{ set: boolean; name: string | null }> {
    if (token === null || token.trim() === '') {
      await db.setAppSettingAsync(BOT_TOKEN_KEY, null);
      return { set: false, name: null };
    }
    const value = token.trim();
    let me: DiscordAnswer;
    try {
      me = await discordFetch(value, '/users/@me');
    } catch {
      throw new ChannelError(502, 'Discord did not answer; try again');
    }
    if (!me.ok) throw new ChannelError(400, 'Discord refused that token (is it a bot token?)');
    await db.setAppSettingAsync(BOT_TOKEN_KEY, encryptSecret(value));
    return { set: true, name: String(me.body.username ?? '') || null };
  },

  /** The Discord servers the bot is in, and the one the site uses (null: none picked). */
  async guilds(): Promise<{ guilds: Array<{ id: string; name: string }>; guildId: string | null }> {
    const token = await botToken();
    const guildId = await pickedGuildId();
    if (!token) return { guilds: [], guildId };
    const r = await discordFetch(token, '/users/@me/guilds');
    const list = r.ok && Array.isArray(r.body) ? (r.body as Array<Record<string, Untrusted>>) : [];
    return {
      guilds: list
        .filter((g) => typeof g.id === 'string')
        .map((g) => ({ id: String(g.id), name: String(g.name ?? g.id) })),
      guildId,
    };
  },

  /** The picked server's channels of these types (0 text, 4 category, 5 announcement). */
  async channels(types: number[]): Promise<Array<{ id: string; name: string }>> {
    const token = await botToken();
    const guildId = await pickedGuildId();
    if (!token || !guildId) return [];
    const r = await discordFetch(token, `/guilds/${guildId}/channels`);
    const list = r.ok && Array.isArray(r.body) ? (r.body as Array<Record<string, Untrusted>>) : [];
    return list
      .filter(
        (c) => typeof c.type === 'number' && types.includes(c.type) && typeof c.id === 'string'
      )
      .map((c) => ({ id: String(c.id), name: String(c.name ?? c.id) }));
  },

  /** Use this Discord server (one the bot is in). Null clears it. */
  async setGuild(guildId: string | null): Promise<string | null> {
    if (!guildId) {
      await db.setAppSettingAsync(GUILD_KEY, null);
      return null;
    }
    const { guilds } = await this.guilds();
    if (!guilds.some((g) => g.id === guildId)) {
      throw new ChannelError(400, 'The bot is not in that Discord server');
    }
    await db.setAppSettingAsync(GUILD_KEY, guildId);
    return guildId;
  },

  /** A DM to one Discord user. False when Discord refuses (no shared server, DMs closed). */
  async sendDm(discordUserId: string, content: string): Promise<boolean> {
    const token = await botToken();
    if (!token) return false;
    const channel = await discordFetch(token, '/users/@me/channels', {
      method: 'POST',
      body: { recipient_id: discordUserId },
    });
    const channelId = typeof channel.body.id === 'string' ? channel.body.id : null;
    if (!channel.ok || !channelId) return false;
    const sent = await discordFetch(token, `/channels/${channelId}/messages`, {
      method: 'POST',
      body: { content: content.slice(0, 2000), allowed_mentions: { parse: [] } },
    });
    return sent.ok;
  },
};
