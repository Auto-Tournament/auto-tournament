/**
 * The site's Discord bot (Settings → Integrations): its token, stored
 * encrypted, and the REST calls it makes. Player DMs (notifyChannels) use it.
 */
import { db } from '../../config/database';
import { decryptSecret, encryptSecret } from '../../utils/secretBox';
import type { JsonValue } from '../../utils/json';
import type { Untrusted } from '../../utils/untrusted';

const BOT_TOKEN_KEY = 'discord_bot_token';
const DISCORD_API = 'https://discord.com/api/v10';

export class ChannelError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function botToken(): Promise<string | null> {
  const stored = await db.getAppSettingAsync(BOT_TOKEN_KEY).catch(() => null);
  return decryptSecret(stored);
}

export async function discordFetch(
  token: string,
  path: string,
  init: { method?: string; body?: JsonValue } = {}
): Promise<{ ok: boolean; status: number; body: Record<string, Untrusted> }> {
  const res = await globalThis.fetch(`${DISCORD_API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'AutoTournament (https://autotournament.gg, 3)',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: globalThis.AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, Untrusted>;
  return { ok: res.ok, status: res.status, body };
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
    let me: Awaited<ReturnType<typeof discordFetch>>;
    try {
      me = await discordFetch(value, '/users/@me');
    } catch {
      throw new ChannelError(502, 'Discord did not answer; try again');
    }
    if (!me.ok) throw new ChannelError(400, 'Discord refused that token (is it a bot token?)');
    await db.setAppSettingAsync(BOT_TOKEN_KEY, encryptSecret(value));
    return { set: true, name: String(me.body.username ?? '') || null };
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
