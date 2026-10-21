/**
 * A tournament's own place on the Discord server (Modules → Discord): when it
 * starts, a category named after it that only its players see, through a
 * "<tournament> players" role. In it: #chat (the start, announcements, the
 * players' talk) and a Lobby Stage (join and listen, not talk). Each team's
 * channels, with a card per match, are in "Your team" (teamChannels.ts).
 *
 * Three days after the tournament ends (time to say gg and find clips), the
 * category, its channels and the role go. A sweep every minute keeps it in step.
 */
import { db } from '../../config/database';
import type { Untrusted } from '../../utils/untrusted';
import { log } from '../../utils/logger';
import { discordIdOf } from '../../services/notifyChannels';
import { botToken, pickedGuildId } from './bot';
import { discordFetch } from './rest';
import { voiceSettings } from './matchVoice';
import { playersOf } from './lobby';
import { spaceOverwrites, LISTEN_ONLY } from './voiceChannel';
import { KEEP_AFTER_S, spacePlan } from './tournamentSpacePlan';

export { KEEP_AFTER_S };

const SWEEP_MS = 60_000;
export interface TournamentSpace {
  categoryId: string;
  roleId: string | null;
  /** #chat: the start, the schedule, announcements. */
  channelId: string | null;
  lobbyId: string | null;
}

/** The tournament's category, role, channel and Lobby on the server, or null. */
export async function spaceOf(tournamentId: number | null): Promise<TournamentSpace | null> {
  if (!tournamentId) return null;
  const row = await db.queryOneAsync<{
    category_id: string;
    role_id: string | null;
    channel_id: string | null;
    lobby_id: string | null;
  }>(
    'SELECT category_id, role_id, channel_id, lobby_id FROM discord_tournament_spaces WHERE tournament_id = ?',
    [tournamentId]
  );
  return row
    ? {
        categoryId: row.category_id,
        roleId: row.role_id,
        channelId: row.channel_id,
        lobbyId: row.lobby_id,
      }
    : null;
}

async function make(
  token: string,
  guildId: string,
  botId: string,
  t: { id: number; name: string; team_ids: string | null }
): Promise<void> {
  const role = await discordFetch(token, `/guilds/${guildId}/roles`, {
    method: 'POST',
    body: { name: `${t.name} players`.slice(0, 100), mentionable: true, permissions: '0' },
  });
  const roleId = typeof role.body.id === 'string' ? role.body.id : null;
  const category = await discordFetch(token, `/guilds/${guildId}/channels`, {
    method: 'POST',
    body: {
      name: t.name.slice(0, 100),
      type: 4,
      permission_overwrites: spaceOverwrites(guildId, botId, roleId),
    },
  });
  if (!category.ok || typeof category.body.id !== 'string') {
    log.warn(`[Discord] Could not make the category for ${t.name}: ${category.status}`);
    if (roleId)
      await discordFetch(token, `/guilds/${guildId}/roles/${roleId}`, { method: 'DELETE' });
    return;
  }
  const categoryId = category.body.id;
  const overwrites = spaceOverwrites(guildId, botId, roleId);
  const channel = async (name: string, type: number, permission_overwrites = overwrites) => {
    const made = await discordFetch(token, `/guilds/${guildId}/channels`, {
      method: 'POST',
      body: { name, type, parent_id: categoryId, permission_overwrites },
    });
    return made.ok && typeof made.body.id === 'string' ? made.body.id : null;
  };
  const chatId = await channel('chat', 0);
  // A Stage: everyone listens, the admins speak. Only Community servers have Stages;
  // elsewhere a voice channel the players cannot talk in.
  const listenOnly = [
    ...overwrites,
    ...(roleId ? [{ id: roleId, type: 0 as const, allow: '0', deny: String(LISTEN_ONLY) }] : []),
  ];
  const lobbyId =
    (await channel('Lobby', 13, overwrites)) ?? (await channel('Lobby', 2, listenOnly));
  await db.runAsync(
    `INSERT INTO discord_tournament_spaces
       (tournament_id, category_id, role_id, channel_id, lobby_id)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT (tournament_id) DO NOTHING`,
    [t.id, categoryId, roleId, chatId, lobbyId]
  );
  // The players with a Discord account on this server get the role.
  if (!roleId) return;
  for (const steamId of await playersOf(t.id, JSON.parse(t.team_ids ?? '[]') as string[])) {
    const discordId = await discordIdOf(steamId);
    if (discordId) {
      await discordFetch(token, `/guilds/${guildId}/members/${discordId}/roles/${roleId}`, {
        method: 'PUT',
      });
    }
  }
}

async function remove(token: string, guildId: string, tournamentId: number): Promise<void> {
  const space = await spaceOf(tournamentId);
  if (!space) return;
  // Everything in the category (team channels and match voice too), then the category and the role.
  const listed = await discordFetch(token, `/guilds/${guildId}/channels`);
  const inside = Array.isArray(listed.body)
    ? (listed.body as Array<Record<string, Untrusted>>)
        .filter((c) => c.parent_id === space.categoryId && typeof c.id === 'string')
        .map((c) => c.id as string)
    : [];
  for (const id of inside) await discordFetch(token, `/channels/${id}`, { method: 'DELETE' });
  const gone = await discordFetch(token, `/channels/${space.categoryId}`, { method: 'DELETE' });
  if (space.roleId) {
    await discordFetch(token, `/guilds/${guildId}/roles/${space.roleId}`, { method: 'DELETE' });
  }
  if (gone.ok || gone.status === 404) {
    await db.runAsync('DELETE FROM discord_tournament_spaces WHERE tournament_id = ?', [
      tournamentId,
    ]);
  }
}

async function sweep(): Promise<void> {
  const token = await botToken();
  const guildId = await pickedGuildId();
  if (!token || !guildId || !(await voiceSettings()).enabled) return;
  const tournaments = await db.queryAsync<{
    id: number;
    name: string;
    status: string;
    team_ids: string | null;
    completed_at: number | null;
    archived_at: number | null;
  }>('SELECT id, name, status, team_ids, completed_at, archived_at FROM tournament');
  const spaces = (
    await db.queryAsync<{ tournament_id: number }>(
      'SELECT tournament_id FROM discord_tournament_spaces'
    )
  ).map((r) => Number(r.tournament_id));
  const plan = spacePlan(
    tournaments
      .filter((t) => t.archived_at === null)
      .map((t) => ({ id: Number(t.id), status: t.status, completedAt: t.completed_at })),
    spaces,
    Math.floor(Date.now() / 1000)
  );
  for (const id of plan.remove) await remove(token, guildId, id);
  for (const id of plan.make) await ensureSpace(id);
}

const making = new Map<number, Promise<TournamentSpace | null>>();

/**
 * The tournament's space, made now if it runs and has none: a match can be
 * ready seconds after the start, and its voice and team channels go in it.
 * One at a time per tournament.
 */
export function ensureSpace(tournamentId: number | null): Promise<TournamentSpace | null> {
  if (!tournamentId) return Promise.resolve(null);
  const pending = making.get(tournamentId);
  if (pending) return pending;
  const run = (async () => {
    const have = await spaceOf(tournamentId);
    if (have) return have;
    const token = await botToken();
    const guildId = await pickedGuildId();
    if (!token || !guildId || !(await voiceSettings()).enabled) return null;
    const t = await db.queryOneAsync<{ id: number; name: string; team_ids: string | null }>(
      "SELECT id, name, team_ids FROM tournament WHERE id = ? AND status = 'in_progress' AND archived_at IS NULL",
      [tournamentId]
    );
    if (!t) return null;
    const me = await discordFetch(token, '/users/@me');
    const botId = typeof me.body.id === 'string' ? me.body.id : null;
    if (!botId) return null;
    await make(token, guildId, botId, { ...t, id: Number(t.id) });
    return spaceOf(tournamentId);
  })().finally(() => making.delete(tournamentId));
  making.set(tournamentId, run);
  return run;
}

let timer: NodeJS.Timeout | null = null;

export function startTournamentSpaces(): void {
  if (timer) return;
  timer = setInterval(() => void sweep().catch(() => undefined), SWEEP_MS);
  timer.unref();
  void sweep().catch(() => undefined);
}

export function stopTournamentSpaces(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
