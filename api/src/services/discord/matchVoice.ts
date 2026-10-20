/**
 * Team voice channels per match (Settings → Integrations → Discord bot).
 *
 * When a match is on its server, each team gets a private voice channel in the
 * picked category: only its players (by the Discord ID on their profile), the
 * bot and the server's admins see it. Players already in a voice channel on
 * the server are moved there; the rest get a DM with a link. Once the match
 * is over (or cancelled, reset, deleted) the channels go, a few minutes later
 * so a team can talk through the result. Shuffle works the same way: the
 * teams are the match's own.
 *
 * Listens on the match change bus (core/matchChangeBus), like the webhooks;
 * a sweep catches what a restart missed. A failure raises a `discord_failed`
 * admin notice.
 */
import { db } from '../../config/database';
import { onMatchChanged } from '../../core/matchChangeBus';
import { log } from '../../utils/logger';
import { adminNoticeService } from '../adminNoticeService';
import { matchRow, sidePlayers } from '../matchNotices';
import { discordIdOf } from '../notifyChannels';
import { botToken, discordBot, pickedGuildId } from './bot';
import { discordFetch } from './rest';
import { teamOverwrites, voiceChannelName } from './voiceChannel';

const ON_KEY = 'discord_match_voice';
const CATEGORY_KEY = 'discord_voice_category';
/** How long after the match the channels stay. */
const CLEANUP_AFTER_S = 3 * 60;
const SWEEP_MS = 60_000;

const SIDES = ['team1', 'team2'] as const;
type Side = (typeof SIDES)[number];

export interface VoiceSettings {
  enabled: boolean;
  /** The category the channels go in; null: at the top of the server. */
  categoryId: string | null;
}

export async function voiceSettings(): Promise<VoiceSettings> {
  const [on, category] = await Promise.all([
    db.getAppSettingAsync(ON_KEY).catch(() => null),
    db.getAppSettingAsync(CATEGORY_KEY).catch(() => null),
  ]);
  return { enabled: on === '1', categoryId: category ?? null };
}

export async function setVoiceSettings(input: Partial<VoiceSettings>): Promise<VoiceSettings> {
  if (input.enabled !== undefined) await db.setAppSettingAsync(ON_KEY, input.enabled ? '1' : null);
  if (input.categoryId !== undefined) await db.setAppSettingAsync(CATEGORY_KEY, input.categoryId);
  return voiceSettings();
}

interface ChannelRow {
  side: Side;
  channel_id: string;
  ended_at: number | null;
}

interface MatchState {
  status: string;
  round: number;
  match_number: number;
}

const now = () => Math.floor(Date.now() / 1000);
const chains = new Map<string, Promise<void>>();
/** When a match's missing channels were last tried: a failing one is tried again at most once a minute. */
const lastTry = new Map<string, number>();
let botIdCache: string | null = null;

async function botId(token: string): Promise<string | null> {
  if (botIdCache) return botIdCache;
  const me = await discordFetch(token, '/users/@me');
  botIdCache = me.ok && typeof me.body.id === 'string' ? me.body.id : null;
  return botIdCache;
}

async function failed(slug: string, what: string, detail: string): Promise<void> {
  log.warn(`[Discord] ${what} for ${slug}: ${detail}`);
  await adminNoticeService.raise(
    'discord_failed',
    { matchSlug: slug, what, detail },
    `discord_failed:${slug}`
  );
}

/** The Discord IDs of one side's players who are on the Discord server. */
async function membersOf(token: string, guildId: string, steamIds: string[]): Promise<string[]> {
  const inServer: string[] = [];
  for (const steamId of steamIds) {
    const discordId = await discordIdOf(steamId);
    if (!discordId) continue;
    const member = await discordFetch(token, `/guilds/${guildId}/members/${discordId}`);
    if (member.ok) inServer.push(discordId);
  }
  return inServer;
}

async function createChannels(
  slug: string,
  sides: Side[],
  token: string,
  guildId: string,
  settings: VoiceSettings
): Promise<void> {
  const match = await matchRow(slug);
  const state = await db.queryOneAsync<MatchState>(
    'SELECT status, round, match_number FROM matches WHERE slug = ?',
    [slug]
  );
  if (!match || !state) return;
  const bot = await botId(token);
  if (!bot) return failed(slug, 'Team voice channels', 'Discord did not say who the bot is');
  for (const side of sides) {
    const team = side === 'team1' ? match.t1 : match.t2;
    const inServer = await membersOf(token, guildId, await sidePlayers(match, side));
    const created = await discordFetch(token, `/guilds/${guildId}/channels`, {
      method: 'POST',
      body: {
        name: voiceChannelName(
          team ?? (side === 'team1' ? 'Team 1' : 'Team 2'),
          state.round,
          state.match_number
        ),
        type: 2,
        ...(settings.categoryId ? { parent_id: settings.categoryId } : {}),
        permission_overwrites: teamOverwrites(guildId, bot, inServer),
      },
    });
    const channelId = typeof created.body.id === 'string' ? created.body.id : null;
    if (!created.ok || !channelId) {
      await failed(
        slug,
        'Team voice channel',
        `Discord answered ${created.status}: ${String(created.body.message ?? 'no reason given')}`
      );
      continue;
    }
    await db.runAsync(
      `INSERT INTO discord_match_channels (match_slug, side, channel_id, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT (match_slug, side) DO NOTHING`,
      [slug, side, channelId, now()]
    );
    const link = `https://discord.com/channels/${guildId}/${channelId}`;
    for (const discordId of inServer) {
      // Moved when they are in a voice channel; Discord refuses (40032) when not.
      const moved = await discordFetch(token, `/guilds/${guildId}/members/${discordId}`, {
        method: 'PATCH',
        body: { channel_id: channelId },
      });
      if (!moved.ok) {
        await discordBot.sendDm(
          discordId,
          `Your team's voice channel for ${team ?? 'your match'}: ${link}`
        );
      }
    }
  }
}

async function deleteChannels(slug: string, token: string, rows: ChannelRow[]): Promise<void> {
  for (const row of rows) {
    const gone = await discordFetch(token, `/channels/${row.channel_id}`, { method: 'DELETE' });
    // 404: someone deleted it already.
    if (gone.ok || gone.status === 404) {
      await db.runAsync('DELETE FROM discord_match_channels WHERE match_slug = ? AND side = ?', [
        slug,
        row.side,
      ]);
    } else {
      await failed(slug, 'Removing a team voice channel', `Discord answered ${gone.status}`);
    }
  }
}

/** Make or remove the match's channels to fit where it is now. */
async function syncNow(slug: string): Promise<void> {
  // Runs on every match change (each live score too): cheap when there is nothing to do.
  const settings = await voiceSettings();
  const rows = await db.queryAsync<ChannelRow>(
    'SELECT side, channel_id, ended_at FROM discord_match_channels WHERE match_slug = ?',
    [slug]
  );
  if (!settings.enabled && rows.length === 0) return;
  const token = await botToken();
  const guildId = await pickedGuildId();
  const state = await db.queryOneAsync<{ status: string }>(
    'SELECT status FROM matches WHERE slug = ?',
    [slug]
  );
  const onServer = !!state && (state.status === 'loaded' || state.status === 'live');

  if (onServer && settings.enabled && token && guildId) {
    if (rows.some((r) => r.ended_at !== null)) {
      // Back on a server (a restart, a failover): the same channels again.
      await db.runAsync('UPDATE discord_match_channels SET ended_at = NULL WHERE match_slug = ?', [
        slug,
      ]);
    }
    const missing = SIDES.filter((side) => !rows.some((r) => r.side === side));
    if (missing.length && Date.now() - (lastTry.get(slug) ?? 0) >= SWEEP_MS) {
      lastTry.set(slug, Date.now());
      await createChannels(slug, missing, token, guildId, settings);
    }
    return;
  }
  lastTry.delete(slug);
  if (rows.length === 0 || !token) return;
  const ended = rows.find((r) => r.ended_at !== null)?.ended_at ?? null;
  if (ended === null) {
    await db.runAsync('UPDATE discord_match_channels SET ended_at = ? WHERE match_slug = ?', [
      now(),
      slug,
    ]);
    return;
  }
  if (now() - ended >= CLEANUP_AFTER_S) await deleteChannels(slug, token, rows);
}

/** One sync of a match at a time. */
export function syncMatchVoice(slug: string): Promise<void> {
  const next = (chains.get(slug) ?? Promise.resolve())
    .then(() => syncNow(slug))
    .catch((error) => {
      log.warn('[Discord] Team voice channels failed', {
        matchSlug: slug,
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      if (chains.get(slug) === next) chains.delete(slug);
    });
  chains.set(slug, next);
  return next;
}

/** Matches with channels, and live matches without: each synced. */
async function sweep(): Promise<void> {
  const { enabled } = await voiceSettings();
  const slugs = await db.queryAsync<{ slug: string }>(
    enabled
      ? `SELECT DISTINCT match_slug AS slug FROM discord_match_channels
         UNION SELECT slug FROM matches WHERE status IN ('loaded', 'live')`
      : 'SELECT DISTINCT match_slug AS slug FROM discord_match_channels'
  );
  for (const { slug } of slugs) await syncMatchVoice(slug);
}

let unsubscribe: (() => void) | null = null;
let sweepTimer: NodeJS.Timeout | null = null;

export function startMatchVoice(): void {
  if (unsubscribe) return;
  unsubscribe = onMatchChanged((ref) => {
    if (ref.slug) void syncMatchVoice(ref.slug);
  });
  sweepTimer = setInterval(() => void sweep().catch(() => undefined), SWEEP_MS);
  sweepTimer.unref();
}

export function stopMatchVoice(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}
