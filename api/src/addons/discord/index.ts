/**
 * The Discord bot add-on (addons/types.ts): the site's own Discord bot. Its
 * token and Discord server are set on Modules → Discord. While it is off, the
 * site sends no Discord DMs (botToken reads as unset).
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { log } from '../../utils/logger';
import type { Untrusted } from '../../utils/untrusted';
import type { AddonModule } from '../types';
import { ChannelError, discordBot } from './bot';
import {
  setTeamChannelsOn,
  startTeamChannels,
  stopTeamChannels,
  teamChannelUrl,
  teamChannelsOn,
} from './teamChannels';
import { resolveViewerAccount } from '../../utils/viewerIdentity';
import { handleInteraction, inviteUrl, registerCommands } from './interactions';
import { currentView, refreshView, startPermissionCheck, stopPermissionCheck } from './view';
import { serverInvite } from './serverInvite';
import { noticeFor } from './playerNotice';
import { restartPresence, startPresence, stopPresence } from './presence';
import { startLobbyInvites, stopLobbyInvites } from './lobby';
import { startTournamentSpaces, stopTournamentSpaces } from './tournamentSpace';
import { setVoiceSettings, startMatchVoice, stopMatchVoice, voiceSettings } from './matchVoice';
import { startAnnouncements, stopAnnouncements } from './announce';

const router = Router();

/**
 * @openapi
 * /api/addons/discord/team-channel/{teamId}:
 *   get:
 *     tags: [Add-ons]
 *     summary: The team's Discord channel for the running tournament, for one of its own players
 *     parameters:
 *       - { in: path, name: teamId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "`url`: the channel's link, or null" }
 */
router.get('/team-channel/:teamId', async (req: Request, res: Response) => {
  try {
    const viewer = await resolveViewerAccount(req);
    const url = viewer.playerId
      ? await teamChannelUrl(String(req.params.teamId), viewer.playerId)
      : null;
    return res.json({ success: true, url });
  } catch (error) {
    log.error('Reading a team channel failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not read the team channel' });
  }
});

/**
 * @openapi
 * /api/addons/discord/interactions:
 *   post:
 *     tags: [Add-ons]
 *     summary: Discord's Interactions Endpoint (slash commands); signed by Discord, not for other callers
 *     responses:
 *       200: { description: The answer Discord shows }
 *       401: { description: Not signed by this app's Discord key }
 */
router.post('/interactions', (req: Request, res: Response) => void handleInteraction(req, res));

/**
 * @openapi
 * /api/addons/discord/notice:
 *   get:
 *     tags: [Add-ons]
 *     summary: What the Discord notice asks the signed-in player to do, if anything
 *     responses:
 *       200: { description: "`notice`: 'link' (link a Discord account), 'join' (join the server with `inviteUrl`) or null" }
 */
router.get('/notice', async (req: Request, res: Response) => {
  try {
    const viewer = await resolveViewerAccount(req);
    return res.json({ success: true, ...(await noticeFor(viewer.playerId ?? null)) });
  } catch (error) {
    log.warn('[Discord] Reading the player notice failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.json({ success: true, notice: null, inviteUrl: null });
  }
});

// Everything below is the admin's.
router.use(requireAuth);

/**
 * @openapi
 * /api/addons/discord:
 *   get:
 *     tags: [Add-ons]
 *     summary: Whether a Discord bot token is set, the bot's name, its Discord servers and the one in use
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: "`set`, `name`, `guilds` ({ id, name }[]), `guildId`, `matchVoice` ({ enabled }), `inviteUrl` (adds the bot to a server), `appId` (the bot's Discord application), `missingPermissions` (what the bot lacks on the server), `serverInvite` (the server's invite link the bot made for players, or null), `stale` (answered from a snapshot that is being refreshed), `teamChannels` (on/off)" }
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // From the stored snapshot (view.ts): at once, refreshed behind the scenes.
    const { view, stale } = await currentView();
    return res.json({
      success: true,
      stale,
      set: view.set,
      name: view.name,
      guilds: view.guilds,
      guildId: view.guildId,
      matchVoice: await voiceSettings(),
      inviteUrl: view.appId ? inviteUrl(view.appId) : null,
      appId: view.appId,
      missingPermissions: view.missing ?? [],
      serverInvite: await serverInvite().catch(() => null),
      teamChannels: await teamChannelsOn(),
    });
  } catch (error) {
    log.error('Reading the Discord bot failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not read the Discord bot' });
  }
});

/**
 * @openapi
 * /api/addons/discord/token:
 *   put:
 *     tags: [Add-ons]
 *     summary: Set (checked with Discord, stored encrypted) or clear the bot token
 *     description: A signed-in admin only. `token` empty or null clears it.
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { token: { type: string, nullable: true } } }
 *     responses:
 *       200: { description: "`set`, `name`" }
 *       400: { description: Discord refused the token }
 *       403: { description: Called with an API token }
 */
router.put('/token', async (req: Request, res: Response) => {
  if ((req as AuthedRequest).serviceToken) {
    return res.status(403).json({ success: false, error: 'Only a signed-in admin can set it' });
  }
  try {
    const raw = (req.body as Record<string, Untrusted> | undefined)?.token;
    const token = typeof raw === 'string' ? raw : null;
    try {
      const saved = await discordBot.setToken(token);
      restartPresence();
      await refreshView().catch(() => undefined);
      return res.json({ success: true, ...saved });
    } catch (error) {
      if (error instanceof ChannelError) {
        return res.status(error.status).json({ success: false, error: error.message });
      }
      throw error;
    }
  } catch (error) {
    log.error('Setting the Discord bot failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not save the Discord bot' });
  }
});

/**
 * @openapi
 * /api/addons/discord/guild:
 *   put:
 *     tags: [Add-ons]
 *     summary: Pick the Discord server the bot works in (one it is in); null clears it
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { guildId: { type: string, nullable: true } } }
 *     responses:
 *       200: { description: "`guildId`" }
 *       400: { description: The bot is not in that server }
 *       403: { description: Called with an API token }
 */
router.put('/guild', async (req: Request, res: Response) => {
  if ((req as AuthedRequest).serviceToken) {
    return res.status(403).json({ success: false, error: 'Only a signed-in admin can set it' });
  }
  try {
    const raw = (req.body as Record<string, Untrusted> | undefined)?.guildId;
    try {
      const guildId = await discordBot.setGuild(typeof raw === 'string' && raw ? raw : null);
      void registerCommands();
      await refreshView().catch(() => undefined);
      return res.json({ success: true, guildId });
    } catch (error) {
      if (error instanceof ChannelError) {
        return res.status(error.status).json({ success: false, error: error.message });
      }
      throw error;
    }
  } catch (error) {
    log.error('Setting the Discord server failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not save the Discord server' });
  }
});

/**
 * @openapi
 * /api/addons/discord/match-voice:
 *   put:
 *     tags: [Add-ons]
 *     summary: Match voice (on/off): a ready match's players are moved into their team's voice channel
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *     responses:
 *       200: { description: "`matchVoice` ({ enabled })" }
 */
router.put('/match-voice', async (req: Request, res: Response) => {
  try {
    const body = (req.body as Record<string, Untrusted> | undefined) ?? {};
    const patch = typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {};
    return res.json({ success: true, matchVoice: await setVoiceSettings(patch) });
  } catch (error) {
    log.error('Setting the Discord voice channels failed', error as Error);
    return res
      .status(500)
      .json({ success: false, error: 'Could not save the voice channel settings' });
  }
});

/**
 * @openapi
 * /api/addons/discord/team-channels:
 *   put:
 *     tags: [Add-ons]
 *     summary: A private text channel per team while its tournament runs (on/off)
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [enabled], properties: { enabled: { type: boolean } } }
 *     responses:
 *       200: { description: "`teamChannels`" }
 *       400: { description: enabled is not a boolean }
 */
router.put('/team-channels', async (req: Request, res: Response) => {
  const enabled = (req.body as Record<string, Untrusted> | undefined)?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'enabled must be true or false' });
  }
  try {
    return res.json({ success: true, teamChannels: await setTeamChannelsOn(enabled) });
  } catch (error) {
    log.error('Setting the Discord team channels failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not save the team channels' });
  }
});

export const discordAddon: AddonModule = {
  id: 'discord',
  name: 'Discord bot',
  description:
    'Your own Discord bot: DMs players about their matches, and works in your Discord server.',
  // On: without a token it does nothing, and its page is where the token goes.
  defaultOn: true,
  start() {
    startTournamentSpaces();
    startMatchVoice();
    startAnnouncements();
    startTeamChannels();
    startLobbyInvites();
    startPresence();
    startPermissionCheck();
    void registerCommands();
  },
  stop() {
    stopTournamentSpaces();
    stopMatchVoice();
    stopAnnouncements();
    stopTeamChannels();
    stopLobbyInvites();
    stopPresence();
    stopPermissionCheck();
  },
  router,
};
