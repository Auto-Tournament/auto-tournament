/**
 * Call to the Lobby (the Discord add-on; Manage, on a running tournament):
 * the tournament's players who are in voice on the server are moved into its
 * Lobby, those who are not get a DM with the link, and #chat gets one post
 * that pings the "<tournament> players" role. Players in a live match are
 * left where they are unless the admin asks for them too.
 */
import { db } from '../../config/database';
import { discordIdOf } from '../../services/notifyChannels';
import { botToken, discordBot, pickedGuildId } from './bot';
import { discordFetch } from './rest';
import { playersOf } from './lobby';
import { ensureSpace, spaceOf } from './tournamentSpace';

export class LobbyCallError extends Error {}

/** Whether the tournament has a Lobby to call players to. */
export async function hasLobby(tournamentId: number): Promise<boolean> {
  return !!(await spaceOf(tournamentId))?.lobbyId;
}

export async function callToLobby(
  tournamentId: number,
  input: { message: string; includeLive: boolean }
): Promise<{ moved: number; messaged: number }> {
  const token = await botToken();
  const guildId = await pickedGuildId();
  const space = await ensureSpace(tournamentId);
  if (!token || !guildId || !space?.lobbyId) {
    throw new LobbyCallError('This tournament has no Lobby on Discord');
  }
  const t = await db.queryOneAsync<{ name: string; team_ids: string | null }>(
    'SELECT name, team_ids FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (!t) throw new LobbyCallError('No such tournament');
  const live = await db.queryAsync<{ team1_id: string | null; team2_id: string | null }>(
    "SELECT team1_id, team2_id FROM matches WHERE tournament_id = ? AND status = 'live'",
    [tournamentId]
  );
  const liveTeams = live
    .flatMap((m) => [m.team1_id, m.team2_id])
    .filter((id): id is string => !!id);
  // Tournament 0 has no shuffle players: the live teams' rosters only.
  const playing = input.includeLive ? new Set<string>() : new Set(await playersOf(0, liveTeams));
  const say = input.message.trim() || 'Everyone to the Lobby, please.';
  const link = `https://discord.com/channels/${guildId}/${space.lobbyId}`;
  let moved = 0;
  let messaged = 0;
  for (const steamId of await playersOf(tournamentId, JSON.parse(t.team_ids ?? '[]') as string[])) {
    if (playing.has(steamId)) continue;
    const discordId = await discordIdOf(steamId);
    if (!discordId) continue;
    const voice = await discordFetch(token, `/guilds/${guildId}/voice-states/${discordId}`);
    if (voice.ok && typeof voice.body.channel_id === 'string') {
      if (voice.body.channel_id === space.lobbyId) continue;
      const ok = await discordFetch(token, `/guilds/${guildId}/members/${discordId}`, {
        method: 'PATCH',
        body: { channel_id: space.lobbyId },
      });
      if (ok.ok) moved += 1;
      continue;
    }
    if (await discordBot.sendDm(discordId, `**${t.name}**: ${say} Join the Lobby: ${link}`)) {
      messaged += 1;
    }
  }
  if (space.channelId) {
    const ping = space.roleId ? `<@&${space.roleId}> ` : '';
    await discordFetch(token, `/channels/${space.channelId}/messages`, {
      method: 'POST',
      body: {
        content: `${ping}${say} Join <#${space.lobbyId}>.`,
        allowed_mentions: { parse: [], roles: space.roleId ? [space.roleId] : [] },
      },
    });
  }
  return { moved, messaged };
}
