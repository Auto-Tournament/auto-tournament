/**
 * The Discord bot add-on (addons/types.ts): the site's own Discord bot. Its
 * token and Discord server are set on Modules → Discord. While it is off, the
 * site sends no Discord DMs (botToken reads as unset).
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../../middleware/auth';
import { callToLobby, hasLobby, LobbyCallError } from './lobbyCall';
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
import { currentView, refreshView } from './view';
import { SetupError, setupServer, setupState } from './setup';
import { restartPresence, startPresence, stopPresence } from './presence';
import { startLobbyInvites, stopLobbyInvites } from './lobby';
import { startTournamentSpaces, stopTournamentSpaces } from './tournamentSpace';
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
 *       200: { description: "`set`, `name`, `guilds` ({ id, name }[]), `guildId`, `categories` ({ id, name }[] of the picked server), `matchVoice` ({ enabled, categoryId }), `textChannels` ({ id, name }[]), `announceChannelId`, `inviteUrl` (adds the bot to a server), `setup` ({ category, results, lobby }: which of what Set up makes are there), `stale` (answered from a snapshot that is being refreshed), `teamChannels` (on/off)" }
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // From the stored snapshot (view.ts): at once, refreshed behind the scenes.
    const { view, stale } = await currentView();
    const { channels } = view;
    return res.json({
      success: true,
      stale,
      set: view.set,
      name: view.name,
      guilds: view.guilds,
      guildId: view.guildId,
      categories: channels.filter((c) => c.type === 4),
      textChannels: channels.filter((c) => c.type === 0 || c.type === 5),
      setup: view.guildId ? await setupState(channels) : null,
      matchVoice: await voiceSettings(),
      inviteUrl: view.appId ? inviteUrl(view.appId) : null,
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
 *     summary: Set up the picked Discord server (an Auto Tournament category with #results) and use it
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: "`categoryId`, `resultsId`" }
 *       400: { description: No server picked, or Discord refused (the reason says why) }
 */
router.post('/setup', async (_req: Request, res: Response) => {
  try {
    const made = await setupServer();
    await refreshView().catch(() => undefined);
    return res.json({ success: true, ...made });
  } catch (error) {
    if (error instanceof SetupError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    log.error('Setting up the Discord server failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not set up the Discord server' });
  }
});

/**
 * @openapi
 * /api/addons/discord/tournaments/{id}/lobby:
 *   get:
 *     tags: [Add-ons]
 *     summary: Whether the tournament has a Lobby on Discord to call its players to
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: "`lobby` (boolean)" }
 *   post:
 *     tags: [Add-ons]
 *     summary: Call the tournament's players to its Lobby (move those in voice, DM the rest, post in #chat)
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { message: { type: string, maxLength: 500 }, includeLive: { type: boolean } } }
 *     responses:
 *       200: { description: "`moved`, `messaged`: how many players were moved, and DMed" }
 *       400: { description: No Lobby, or a bad message }
 */
router.get('/tournaments/:id/lobby', async (req: Request, res: Response) => {
  return res.json({ success: true, lobby: await hasLobby(Number(req.params.id)) });
});

router.post('/tournaments/:id/lobby', async (req: Request, res: Response) => {
  const body = (req.body as Record<string, Untrusted> | undefined) ?? {};
  const message = body.message === undefined ? '' : body.message;
  if (typeof message !== 'string' || message.length > 500) {
    return res
      .status(400)
      .json({ success: false, error: 'message must be text, at most 500 characters' });
  }
  try {
    const done = await callToLobby(Number(req.params.id), {
      message,
      includeLive: body.includeLive === true,
    });
    return res.json({ success: true, ...done });
  } catch (error) {
    if (error instanceof LobbyCallError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    log.error('Calling players to the Lobby failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not call the players' });
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
    void registerCommands();
  },
  stop() {
    stopTournamentSpaces();
    stopMatchVoice();
    stopAnnouncements();
    stopTeamChannels();
    stopLobbyInvites();
    stopPresence();
  },
  router,
};
