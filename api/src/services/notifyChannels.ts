/**
 * Notifications outside the site (the Connections draft's "Notifications"):
 * for each event that needs a player, a Discord DM and an email, each on or
 * off per player. The bell (notificationService) shows them too; this sends
 * them where the player is when the site is closed.
 *
 * - Events: their own match is ready, their turn in the veto (captains),
 *   check-in opens, a new tournament takes sign-ups. "Off by default except
 *   your own matches."
 * - Email goes to the player's verified address (playerEmailService), when
 *   the site can send email. A new tournament's email is the existing
 *   "tournament emails" switch (player_emails.notify_tournaments), sent by
 *   playerEmailService.notifySignupOpen.
 * - Discord: a DM from the site's bot (Settings → Integrations, its token
 *   stored encrypted) to the player's Discord account (Discord sign-in, else
 *   the Discord ID an admin entered). The bot must share a server with them.
 * - Push: a browser or phone notification (webPush.ts) in every browser the player turned
 *   them on in; they reach a player whose tab is closed.
 * - Each (player, event key, channel) is sent once (notify_deliveries).
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { decryptSecret, encryptSecret } from '../utils/secretBox';
import { emailService } from './emailService';
import { webPush } from './webPush';

export type ChannelEvent =
  'match_ready' | 'veto_turn' | 'checkin_open' | 'new_tournament' | 'tournament_starting';
export type Channel = 'email' | 'discord' | 'push';

export const CHANNEL_EVENTS: ChannelEvent[] = [
  'match_ready',
  'veto_turn',
  'checkin_open',
  'new_tournament',
  'tournament_starting',
];
export const CHANNELS: Channel[] = ['discord', 'email', 'push'];

/** On for a player who chose nothing: their own matches only. */
const DEFAULT_ON: Record<ChannelEvent, boolean> = {
  match_ready: true,
  veto_turn: true,
  checkin_open: false,
  new_tournament: false,
  // A tournament they signed up for is about to start (tournamentSchedule.ts).
  tournament_starting: true,
};

const BOT_TOKEN_KEY = 'discord_bot_token';
const DISCORD_API = 'https://discord.com/api/v10';

export interface ChannelMessage {
  /** The email subject; the DM's first line. */
  subject: string;
  /** One or two sentences. */
  text: string;
  /** Where to go: an absolute URL, or a path on this site. */
  url?: string;
  /** The link's label in the email. */
  action?: string;
}

export interface ChannelState {
  /** Usable for this player now. */
  available: boolean;
  /** Why not: 'no_email', 'email_unverified', 'email_off' (site cannot send), 'no_bot', 'no_discord', 'no_push'. */
  reason?: string;
}

export interface ChannelPrefs {
  events: Record<ChannelEvent, Record<Channel, boolean>>;
  channels: Record<Channel, ChannelState>;
}

const now = () => Math.floor(Date.now() / 1000);

export class ChannelError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// ---- Discord bot ----------------------------------------------------------------

async function botToken(): Promise<string | null> {
  const stored = await db.getAppSettingAsync(BOT_TOKEN_KEY).catch(() => null);
  return decryptSecret(stored);
}

async function discordFetch(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
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
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
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

// ---- per player ----------------------------------------------------------------

async function discordIdOf(playerId: string): Promise<string | null> {
  const row = await db.queryOneAsync<{ id: string | null }>(
    `SELECT COALESCE(
        (SELECT provider_user_id FROM auth_identities WHERE provider = 'discord' AND steam_id = ? ORDER BY id DESC LIMIT 1),
        (SELECT discord_id FROM players WHERE id = ?)
      ) AS id`,
    [playerId, playerId]
  );
  const id = row?.id?.trim();
  return id && /^\d{15,22}$/.test(id) ? id : null;
}

async function emailOf(
  playerId: string
): Promise<{ email: string | null; verified: boolean; tournaments: boolean }> {
  const row = await db.queryOneAsync<{
    email: string;
    verified_at: number | null;
    notify_tournaments: number;
  }>('SELECT email, verified_at, notify_tournaments FROM player_emails WHERE player_id = ?', [
    playerId,
  ]);
  return {
    email: row?.email ?? null,
    verified: row?.verified_at !== null && row?.verified_at !== undefined,
    tournaments: row?.notify_tournaments === 1,
  };
}

function isEvent(v: unknown): v is ChannelEvent {
  return typeof v === 'string' && (CHANNEL_EVENTS as string[]).includes(v);
}
function isChannel(v: unknown): v is Channel {
  return typeof v === 'string' && (CHANNELS as string[]).includes(v);
}

export const notifyChannels = {
  /** A player's switches, and which channels can reach them now. */
  async prefs(playerId: string): Promise<ChannelPrefs> {
    const rows = await db.queryAsync<{ event: string; channel: string; enabled: number }>(
      'SELECT event, channel, enabled FROM player_notify_channels WHERE player_id = ?',
      [playerId]
    );
    const mail = await emailOf(playerId);
    const events = Object.fromEntries(
      CHANNEL_EVENTS.map((event) => [
        event,
        Object.fromEntries(
          CHANNELS.map((channel) => {
            if (event === 'new_tournament' && channel === 'email')
              return [channel, mail.tournaments];
            const row = rows.find((r) => r.event === event && r.channel === channel);
            return [channel, row ? row.enabled === 1 : DEFAULT_ON[event]];
          })
        ),
      ])
    ) as ChannelPrefs['events'];

    const emailReady = await emailService.isReady().catch(() => false);
    const email: ChannelState = !emailReady
      ? { available: false, reason: 'email_off' }
      : !mail.email
        ? { available: false, reason: 'no_email' }
        : !mail.verified
          ? { available: false, reason: 'email_unverified' }
          : { available: true };
    const bot = await botToken();
    const discord: ChannelState = !bot
      ? { available: false, reason: 'no_bot' }
      : !(await discordIdOf(playerId))
        ? { available: false, reason: 'no_discord' }
        : { available: true };
    // Browser and phone notifications: on in at least one browser (webPush.ts).
    const push: ChannelState =
      (await webPush.count(playerId).catch(() => 0)) > 0
        ? { available: true }
        : { available: false, reason: 'no_push' };
    return { events, channels: { email, discord, push } };
  },

  /** Turn one event's channel on or off for a player. */
  async set(
    playerId: string,
    event: unknown,
    channel: unknown,
    on: unknown
  ): Promise<ChannelPrefs> {
    if (!isEvent(event))
      throw new ChannelError(400, `event must be one of ${CHANNEL_EVENTS.join(', ')}`);
    if (!isChannel(channel))
      throw new ChannelError(400, `channel must be one of ${CHANNELS.join(', ')}`);
    if (typeof on !== 'boolean') throw new ChannelError(400, 'on must be true or false');
    if (event === 'new_tournament' && channel === 'email') {
      // The existing "tournament emails" switch.
      await db.runAsync(
        'UPDATE player_emails SET notify_tournaments = ?, updated_at = ? WHERE player_id = ?',
        [on ? 1 : 0, now(), playerId]
      );
    } else {
      await db.runAsync(
        `INSERT INTO player_notify_channels (player_id, event, channel, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (player_id, event, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
        [playerId, event, channel, on ? 1 : 0, now()]
      );
    }
    return this.prefs(playerId);
  },

  /**
   * Send an event's message to these players on every channel they have on
   * and that reaches them, once per (player, key, channel). Runs in the
   * background of the caller; failures are logged, never thrown.
   */
  async deliver(
    playerIds: string[],
    event: ChannelEvent,
    key: string,
    message: ChannelMessage
  ): Promise<{ email: number; discord: number; push: number }> {
    const sent = { email: 0, discord: 0, push: 0 };
    const base = await emailService.siteUrl().catch(() => null);
    const url = message.url
      ? /^https?:\/\//.test(message.url)
        ? message.url
        : base
          ? `${base}${message.url}`
          : null
      : null;
    for (const playerId of new Set(playerIds)) {
      try {
        const prefs = await this.prefs(playerId);
        for (const channel of CHANNELS) {
          // A new tournament's email goes out with the sign-up email itself.
          if (event === 'new_tournament' && channel === 'email') continue;
          if (!prefs.events[event][channel] || !prefs.channels[channel].available) continue;
          const claimed = await db.queryAsync<{ player_id: string }>(
            `INSERT INTO notify_deliveries (player_id, dedupe_key, channel, sent_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (player_id, dedupe_key, channel) DO NOTHING RETURNING player_id`,
            [playerId, key, channel, now()]
          );
          if (claimed.length === 0) continue;
          if (channel === 'push') {
            const n = await webPush.send(playerId, {
              title: message.subject,
              body: message.text,
              url: message.url,
              tag: key,
            });
            if (n > 0) sent.push += 1;
          } else if (channel === 'discord') {
            const id = await discordIdOf(playerId);
            const ok =
              !!id &&
              (await discordBot.sendDm(
                id,
                [`**${message.subject}**`, message.text, url ?? ''].filter(Boolean).join('\n')
              ));
            if (ok) sent.discord += 1;
          } else {
            const mail = await emailOf(playerId);
            if (!mail.email) continue;
            await emailService.send({
              to: mail.email,
              subject: message.subject,
              paragraphs: [message.text],
              action: url ? { label: message.action ?? 'Open', url } : undefined,
              footer: base
                ? {
                    text: 'You get these because they are on for your account.',
                    url: `${base}/me/connections`,
                    linkLabel: 'Change what you get',
                  }
                : { text: 'Change what you get on your account page.' },
            });
            sent.email += 1;
          }
        }
      } catch (error) {
        log.warn(`[NOTIFY] Could not send ${event} outside the site`, { error });
      }
    }
    return sent;
  },
};
