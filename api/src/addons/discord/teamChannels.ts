/**
 * Team channels and roles (the Discord add-on, Modules → Discord; GitHub
 * #112): while a tournament runs, each of its teams has a role in its colour,
 * given to its players on the Discord server (announcements ping it), and a
 * private text channel only that role sees, in the bot's category. The team
 * page links to the channel for the team's own players. When the tournament
 * is over (or the feature is turned off) both go.
 *
 * A sweep every minute keeps them in step; no listener.
 * shortcut: members are set when the channel is made, so a roster change mid-tournament is not reflected; sync overwrites on roster changes if teams ask for it.
 */
import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { adminNoticeService } from '../../services/adminNoticeService';
import { discordIdOf } from '../../services/notifyChannels';
import { botToken, pickedGuildId } from './bot';
import { discordFetch } from './rest';
import { TEXT_MEMBER, teamOverwrites } from './voiceChannel';
import { KEEP_AFTER_S, spaceOf } from './tournamentSpace';

const ON_KEY = 'discord_team_channels';

// The 16 team colours (client theme tokens.ts teamColors), by a team's color_index.
const TEAM_COLORS = [
  0xf4928a, 0x3ecab7, 0xe492c9, 0x8bc376, 0xb7a1f5, 0xccaf4e, 0x73b6fa, 0xef996c, 0x31c7d5,
  0xf090aa, 0x64c897, 0xd098e3, 0xafba5c, 0x97acfd, 0xe2a355, 0x4dc0ec,
];

const SWEEP_MS = 60_000;

export async function teamChannelsOn(): Promise<boolean> {
  return (await db.getAppSettingAsync(ON_KEY).catch(() => null)) === '1';
}

export async function setTeamChannelsOn(on: boolean): Promise<boolean> {
  await db.setAppSettingAsync(ON_KEY, on ? '1' : null);
  void sweep().catch(() => undefined);
  return on;
}

/** A team's channel for the running tournament, for one of its own players. */
export async function teamChannelUrl(teamId: string, steamId: string): Promise<string | null> {
  const guildId = await pickedGuildId();
  const row = await db.queryOneAsync<{ channel_id: string; players: string }>(
    `SELECT c.channel_id, t.players FROM discord_team_channels c JOIN teams t ON t.id = c.team_id
      WHERE c.team_id = ? ORDER BY c.tournament_id DESC LIMIT 1`,
    [teamId]
  );
  if (!guildId || !row || !rosterIds(row.players).includes(steamId)) return null;
  return `https://discord.com/channels/${guildId}/${row.channel_id}`;
}

function rosterIds(players: string): string[] {
  try {
    const list = JSON.parse(players) as Array<{ steamId?: string; steamid?: string }>;
    return list.map((p) => p.steamId ?? p.steamid ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

async function sweep(): Promise<void> {
  const token = await botToken();
  const guildId = await pickedGuildId();
  const on = (await teamChannelsOn()) && !!token && !!guildId;
  const running = on
    ? await db.queryAsync<{ id: number; team_ids: string | null }>(
        // Running, or finished in the last few days: they go with the tournament's space.
        `SELECT id, team_ids FROM tournament WHERE archived_at IS NULL
           AND (status = 'in_progress' OR (status = 'completed' AND completed_at > ?))`,
        [Math.floor(Date.now() / 1000) - KEEP_AFTER_S]
      )
    : [];
  const want = new Set<string>();
  for (const t of running) {
    for (const teamId of JSON.parse(t.team_ids ?? '[]') as string[]) want.add(`${t.id}:${teamId}`);
  }
  const rows = await db.queryAsync<{
    tournament_id: number;
    team_id: string;
    channel_id: string;
    role_id: string | null;
  }>('SELECT tournament_id, team_id, channel_id, role_id FROM discord_team_channels');
  // Gone: the tournament is over, the team left, or the feature is off.
  for (const row of rows) {
    if (want.has(`${row.tournament_id}:${row.team_id}`) || !token) continue;
    const gone = await discordFetch(token, `/channels/${row.channel_id}`, { method: 'DELETE' });
    if (row.role_id && guildId) {
      await discordFetch(token, `/guilds/${guildId}/roles/${row.role_id}`, { method: 'DELETE' });
    }
    if (gone.ok || gone.status === 404) {
      await db.runAsync(
        'DELETE FROM discord_team_channels WHERE tournament_id = ? AND team_id = ?',
        [row.tournament_id, row.team_id]
      );
    }
  }
  if (!on || !token || !guildId) return;
  const have = new Set(rows.map((r) => `${r.tournament_id}:${r.team_id}`));
  const me = await discordFetch(token, '/users/@me');
  const botId = typeof me.body.id === 'string' ? me.body.id : null;
  if (!botId) return;
  for (const key of want) {
    if (have.has(key)) continue;
    const [tournamentId, teamId] = key.split(':');
    // In the tournament's own category: wait for it (tournamentSpace.ts makes it on its sweep).
    const space = await spaceOf(Number(tournamentId));
    if (!space) continue;
    const team = await db.queryOneAsync<{
      name: string;
      players: string;
      color_index: number | null;
    }>('SELECT name, players, color_index FROM teams WHERE id = ?', [teamId]);
    if (!team) continue;
    const members: string[] = [];
    for (const steamId of rosterIds(team.players)) {
      const discordId = await discordIdOf(steamId);
      if (discordId && (await discordFetch(token, `/guilds/${guildId}/members/${discordId}`)).ok) {
        members.push(discordId);
      }
    }
    // The team's role, in its colour, for its players on the server.
    const role = await discordFetch(token, `/guilds/${guildId}/roles`, {
      method: 'POST',
      body: {
        name: team.name.slice(0, 100),
        color: TEAM_COLORS[(team.color_index ?? 0) % TEAM_COLORS.length],
        mentionable: true,
        permissions: '0',
      },
    });
    const roleId = typeof role.body.id === 'string' ? role.body.id : null;
    if (roleId) {
      for (const member of members) {
        await discordFetch(token, `/guilds/${guildId}/members/${member}/roles/${roleId}`, {
          method: 'PUT',
        });
      }
    }
    // Only the team (its role, else its players one by one) sees the channel.
    const overwrites = roleId
      ? [
          ...teamOverwrites(guildId, botId, [], TEXT_MEMBER),
          { id: roleId, type: 0 as const, allow: String(TEXT_MEMBER), deny: '0' },
        ]
      : teamOverwrites(guildId, botId, members, TEXT_MEMBER);
    const created = await discordFetch(token, `/guilds/${guildId}/channels`, {
      method: 'POST',
      body: {
        name: team.name.slice(0, 100),
        type: 0,
        parent_id: space.categoryId,
        permission_overwrites: overwrites,
      },
    });
    const channelId = typeof created.body.id === 'string' ? created.body.id : null;
    if (!created.ok || !channelId) {
      log.warn(`[Discord] Team channel for ${team.name} failed: ${created.status}`);
      await adminNoticeService.raise(
        'discord_failed',
        { what: `Team channel for ${team.name}`, detail: `Discord answered ${created.status}` },
        `discord_failed:team:${teamId}`
      );
      continue;
    }
    await db.runAsync(
      `INSERT INTO discord_team_channels (tournament_id, team_id, channel_id, role_id)
       VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [Number(tournamentId), teamId, channelId, roleId]
    );
  }
}

let timer: NodeJS.Timeout | null = null;

export function startTeamChannels(): void {
  if (timer) return;
  timer = setInterval(() => void sweep().catch(() => undefined), SWEEP_MS);
  timer.unref();
  void sweep().catch(() => undefined);
}

export function stopTeamChannels(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
