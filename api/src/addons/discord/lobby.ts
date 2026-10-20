/**
 * The waiting room (the Lobby that "Set up this server" makes): when a
 * tournament starts, each of its players gets one DM asking them to join the
 * Lobby, so the bot can move them into their team's voice channel when their
 * match is ready. Once per player and tournament (notify_deliveries).
 *
 * A sweep every minute: a tournament that started while the platform was down
 * is caught up.
 */
import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { discordIdOf } from '../../services/notifyChannels';
import { botToken, discordBot, pickedGuildId } from './bot';

const LOBBY_KEY = 'discord_lobby_channel';
const SWEEP_MS = 60_000;

export async function lobbyChannel(): Promise<string | null> {
  return (await db.getAppSettingAsync(LOBBY_KEY).catch(() => null)) ?? null;
}

export async function setLobbyChannel(channelId: string): Promise<void> {
  await db.setAppSettingAsync(LOBBY_KEY, channelId);
}

/** Who plays in a tournament: its teams' rosters, or a shuffle's players. */
async function playersOf(tournamentId: number, teamIds: string[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const teamId of teamIds) {
    const team = await db.queryOneAsync<{ players: string }>(
      'SELECT players FROM teams WHERE id = ?',
      [teamId]
    );
    try {
      for (const p of JSON.parse(team?.players ?? '[]') as Array<{
        steamId?: string;
        steamid?: string;
      }>) {
        const id = p.steamId ?? p.steamid;
        if (id) ids.add(id);
      }
    } catch {
      // A roster that does not parse has nobody to invite.
    }
  }
  const shuffle = await db.queryAsync<{ player_id: string }>(
    'SELECT player_id FROM shuffle_tournament_players WHERE tournament_id = ? AND left_at IS NULL',
    [tournamentId]
  );
  for (const p of shuffle) ids.add(p.player_id);
  return [...ids];
}

async function sweep(): Promise<void> {
  const lobbyId = await lobbyChannel();
  const guildId = await pickedGuildId();
  if (!lobbyId || !guildId || !(await botToken())) return;
  const running = await db.queryAsync<{ id: number; name: string; team_ids: string | null }>(
    "SELECT id, name, team_ids FROM tournament WHERE status = 'in_progress' AND archived_at IS NULL"
  );
  const link = `https://discord.com/channels/${guildId}/${lobbyId}`;
  for (const t of running) {
    const key = `discord:lobby:${t.id}`;
    for (const steamId of await playersOf(t.id, JSON.parse(t.team_ids ?? '[]') as string[])) {
      const discordId = await discordIdOf(steamId);
      if (!discordId) continue;
      // Claimed first, so each player gets it once.
      const claimed = await db.queryOneAsync<{ player_id: string }>(
        `INSERT INTO notify_deliveries (player_id, dedupe_key, channel, sent_at) VALUES (?, ?, 'discord', ?)
         ON CONFLICT DO NOTHING RETURNING player_id`,
        [steamId, key, Math.floor(Date.now() / 1000)]
      );
      if (!claimed) continue;
      const sent = await discordBot.sendDm(
        discordId,
        `**${t.name}** has started. Please join the Lobby voice channel and wait there: when your match is ready, you are moved into your team's voice channel automatically. ${link}`
      );
      if (!sent) log.info(`[Discord] Could not DM ${steamId} the lobby link (DMs closed?)`);
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startLobbyInvites(): void {
  if (timer) return;
  timer = setInterval(() => void sweep().catch(() => undefined), SWEEP_MS);
  timer.unref();
  void sweep().catch(() => undefined);
}

export function stopLobbyInvites(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
