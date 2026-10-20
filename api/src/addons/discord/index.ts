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
import { appInfo, handleInteraction, inviteUrl, registerCommands } from './interactions';
import { botToken } from './bot';
import { SetupError, setupServer } from './setup';
import { restartPresence, startPresence, stopPresence } from './presence';
import { startLobbyInvites, stopLobbyInvites } from './lobby';
import { setVoiceSettings, startMatchVoice, stopMatchVoice, voiceSettings } from './matchVoice';
import {
  announceChannel,
  setAnnounceChannel,
  startAnnouncements,
  stopAnnouncements,
} from './announce';

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
 *       200: { description: "`set`, `name`, `guilds` ({ id, name }[]), `guildId`, `categories` ({ id, name }[] of the picked server), `matchVoice` ({ enabled, categoryId }), `textChannels` ({ id, name }[]), `announceChannelId`, `inviteUrl` (adds the bot to a server), `teamChannels` (on/off)" }
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const status = await discordBot.status();
    const token = status.set ? await botToken() : null;
    const app = token ? await appInfo(token) : null;
    const guilds = status.set ? await discordBot.guilds() : { guilds: [], guildId: null };
    return res.json({
      success: true,
      ...status,
      ...guilds,
      categories: guilds.guildId ? await discordBot.channels([4]) : [],
      textChannels: guilds.guildId ? await discordBot.channels([0, 5]) : [],
      matchVoice: await voiceSettings(),
      inviteUrl: app ? inviteUrl(app.id) : null,
      announceChannelId: await announceChannel(),
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
 *     summary: Team voice channels per match (on/off, and the category they go in)
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               categoryId: { type: string, nullable: true }
 *     responses:
 *       200: { description: "`matchVoice` ({ enabled, categoryId })" }
 *       400: { description: Not a category of the picked server }
 */
router.put('/match-voice', async (req: Request, res: Response) => {
  try {
    const body = (req.body as Record<string, Untrusted> | undefined) ?? {};
    const patch: { enabled?: boolean; categoryId?: string | null } = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (body.categoryId === null || body.categoryId === '') patch.categoryId = null;
    else if (typeof body.categoryId === 'string') {
      const categories = await discordBot.channels([4]);
      if (!categories.some((c) => c.id === body.categoryId)) {
        return res
          .status(400)
          .json({ success: false, error: 'Not a category of the picked Discord server' });
      }
      patch.categoryId = body.categoryId;
    }
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
 * /api/addons/discord/announce:
 *   put:
 *     tags: [Add-ons]
 *     summary: The channel match announcements go to (one of the picked server's); null turns them off
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { channelId: { type: string, nullable: true } } }
 *     responses:
 *       200: { description: "`announceChannelId`" }
 *       400: { description: Not a text channel of the picked server }
 */
router.put('/announce', async (req: Request, res: Response) => {
  try {
    const raw = (req.body as Record<string, Untrusted> | undefined)?.channelId;
    if (raw === null || raw === '' || raw === undefined) {
      return res.json({ success: true, announceChannelId: await setAnnounceChannel(null) });
    }
    if (typeof raw !== 'string' || !(await discordBot.channels([0, 5])).some((c) => c.id === raw)) {
      return res
        .status(400)
        .json({ success: false, error: 'Not a text channel of the picked Discord server' });
    }
    return res.json({ success: true, announceChannelId: await setAnnounceChannel(raw) });
  } catch (error) {
    log.error('Setting the Discord announcement channel failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not save the channel' });
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

/**
 * @openapi
 * /api/addons/discord/setup:
 *   post:
 *     tags: [Add-ons]
 *     summary: Set up the picked Discord server (category, #results, a Lobby nobody talks in) and use it
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: "`categoryId`, `resultsId`, `lobbyId`" }
 *       400: { description: No server picked, or Discord refused (the reason says why) }
 */
router.post('/setup', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, ...(await setupServer()) });
  } catch (error) {
    if (error instanceof SetupError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    log.error('Setting up the Discord server failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not set up the Discord server' });
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
    startMatchVoice();
    startAnnouncements();
    startTeamChannels();
    startLobbyInvites();
    startPresence();
    void registerCommands();
  },
  stop() {
    stopMatchVoice();
    stopAnnouncements();
    stopTeamChannels();
    stopLobbyInvites();
    stopPresence();
  },
  router,
};
