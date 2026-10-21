/**
 * Linking Discord puts the player on the server (the Discord add-on): when
 * the Discord sign-in uses the bot's own app, it also asks for `guilds.join`,
 * and with that token the bot adds the player to its server. Discord only
 * allows this for a bot of the same app, and the bot needs Create Invite.
 */
import { log } from '../../utils/logger';
import { authProviderSettingsService } from '../../services/authProviderSettingsService';
import { botToken, pickedGuildId } from './bot';
import { discordFetch } from './rest';
import { currentView } from './view';

/** Whether a Discord sign-in now can put the player on the bot's server. */
export async function joinReady(): Promise<boolean> {
  if (!(await botToken()) || !(await pickedGuildId())) return false;
  const { view } = await currentView();
  return (
    !!view.appId && view.appId === authProviderSettingsService.getEffective('discord').clientId
  );
}

/** Add the player to the server with their sign-in token; nothing when they are on it already. */
export async function joinServer(discordId: string, accessToken: string): Promise<void> {
  if (!(await joinReady())) return;
  const token = await botToken();
  const guildId = await pickedGuildId();
  if (!token || !guildId) return;
  const joined = await discordFetch(token, `/guilds/${guildId}/members/${discordId}`, {
    method: 'PUT',
    body: { access_token: accessToken },
  });
  // 201: added; 204: already a member.
  if (joined.status === 201) log.info('[Discord] A player joined the server by linking Discord');
  else if (!joined.ok) {
    log.warn(`[Discord] Adding a player to the server failed: ${joined.status}`, {
      message: String(joined.body.message ?? ''),
    });
  }
}
