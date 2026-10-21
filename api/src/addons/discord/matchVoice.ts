/**
 * Match voice (the Discord add-on, Modules → Discord).
 *
 * When a match is on its server, each team's players (by the Discord ID on
 * their profile) already in a voice channel on the server are moved into
 * their team's voice channel (teamChannels.ts). Each side once per match.
 * Shuffle works the same way: the teams are the match's own.
 *
 * Listens on the match change bus (core/matchChangeBus), like the webhooks;
 * a sweep catches what a restart missed. A failure raises a `discord_failed`
 * admin notice.
 */
import { db } from '../../config/database';
import { onMatchChanged } from '../../core/matchChangeBus';
import { log } from '../../utils/logger';
import { adminNoticeService } from '../../services/adminNoticeService';
import { matchRow, sidePlayers } from '../../services/matchNotices';
import { discordIdOf } from '../../services/notifyChannels';
import { botToken, pickedGuildId } from './bot';
import { discordFetch } from './rest';

const ON_KEY = 'discord_match_voice';
/** How long after the match it is forgotten (moved again if it comes back on a server). */
const CLEANUP_AFTER_S = 3 * 60;
const SWEEP_MS = 60_000;

const SIDES = ['team1', 'team2'] as const;
type Side = (typeof SIDES)[number];

export interface VoiceSettings {
  enabled: boolean;
}

export async function voiceSettings(): Promise<VoiceSettings> {
  return { enabled: (await db.getAppSettingAsync(ON_KEY).catch(() => null)) === '1' };
}

export async function setVoiceSettings(input: Partial<VoiceSettings>): Promise<VoiceSettings> {
  if (input.enabled !== undefined) await db.setAppSettingAsync(ON_KEY, input.enabled ? '1' : null);
  return voiceSettings();
}

interface ChannelRow {
  side: Side;
  channel_id: string;
  ended_at: number | null;
}

const now = () => Math.floor(Date.now() / 1000);
const chains = new Map<string, Promise<void>>();
/** When a match's sides were last tried: one whose team voice is not made yet is tried again a minute later. */
const lastTry = new Map<string, number>();

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

async function moveIn(slug: string, sides: Side[], token: string, guildId: string): Promise<void> {
  const match = await matchRow(slug);
  const ids = await db.queryOneAsync<{ team1_id: string | null; team2_id: string | null }>(
    'SELECT team1_id, team2_id FROM matches WHERE slug = ?',
    [slug]
  );
  if (!match || !ids) return;
  for (const side of sides) {
    // The team's voice channel for the tournament (teamChannels.ts); not made yet: the next try.
    const own = await db.queryOneAsync<{ voice_id: string | null }>(
      'SELECT voice_id FROM discord_team_channels WHERE tournament_id = ? AND team_id = ?',
      [match.tournament_id, side === 'team1' ? ids.team1_id : ids.team2_id]
    );
    const channelId = own?.voice_id;
    if (!channelId) continue;
    await db.runAsync(
      `INSERT INTO discord_match_channels (match_slug, side, channel_id, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT (match_slug, side) DO NOTHING`,
      [slug, side, channelId, now()]
    );
    for (const discordId of await membersOf(token, guildId, await sidePlayers(match, side))) {
      // Moved when they are in a voice channel; Discord refuses (40032) when not. No DM:
      // the match-ready one reaches them when they are away, the team channel's ping otherwise.
      await discordFetch(token, `/guilds/${guildId}/members/${discordId}`, {
        method: 'PATCH',
        body: { channel_id: channelId },
      });
    }
  }
}

async function forget(slug: string, token: string, rows: ChannelRow[]): Promise<void> {
  for (const row of rows) {
    // A match channel from before team voice (one per match) goes; a team's stays with the team.
    const team = await db.queryOneAsync<{ voice_id: string }>(
      'SELECT voice_id FROM discord_team_channels WHERE voice_id = ?',
      [row.channel_id]
    );
    const gone = team
      ? { ok: true, status: 200 }
      : await discordFetch(token, `/channels/${row.channel_id}`, { method: 'DELETE' });
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
      await moveIn(slug, missing, token, guildId);
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
  if (now() - ended >= CLEANUP_AFTER_S) await forget(slug, token, rows);
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
