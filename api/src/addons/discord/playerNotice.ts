/**
 * What the Discord notice at the top of the site asks a signed-in player to
 * do (the Discord add-on): link their Discord account (when players can, see
 * the Discord sign-in), or join the server with the bot's invite. Nothing
 * when the bot is not set up, or the player is linked and on the server.
 */
import { authProviderSettingsService } from '../../services/authProviderSettingsService';
import { discordIdOf } from '../../services/notifyChannels';
import { botToken, pickedGuildId } from './bot';
import { discordFetch } from './rest';
import { serverInvite } from './serverInvite';

export type DiscordNotice =
  | { notice: 'link'; inviteUrl: null }
  | { notice: 'join'; inviteUrl: string }
  | { notice: null; inviteUrl: null };

const NONE: DiscordNotice = { notice: null, inviteUrl: null };
/** How long "on the server" is trusted before Discord is asked again (a page view each time otherwise). */
const MEMBER_MS = 5 * 60 * 1000;
const members = new Map<string, { inServer: boolean; at: number }>();

export async function noticeFor(playerId: string | null): Promise<DiscordNotice> {
  const token = await botToken();
  const guildId = await pickedGuildId();
  if (!playerId || !token || !guildId) return NONE;
  const discordId = await discordIdOf(playerId);
  if (!discordId) {
    const discord = authProviderSettingsService.getEffective('discord');
    return discord.enabled && discord.configured ? { notice: 'link', inviteUrl: null } : NONE;
  }
  const known = members.get(discordId);
  let inServer = known && Date.now() - known.at < MEMBER_MS ? known.inServer : null;
  if (inServer === null) {
    const member = await discordFetch(token, `/guilds/${guildId}/members/${discordId}`);
    // Only a clear "not a member" counts: an outage asks nobody to join.
    inServer = member.ok || member.status !== 404;
    members.set(discordId, { inServer, at: Date.now() });
  }
  if (inServer) return NONE;
  const inviteUrl = await serverInvite();
  return inviteUrl ? { notice: 'join', inviteUrl } : NONE;
}
