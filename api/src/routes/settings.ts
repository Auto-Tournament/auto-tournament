import { readHighlightSettings } from '../services/highlights/settings';
import { Router, Request, Response } from 'express';
import { requireAuth, requestActorId, type AuthedRequest } from '../middleware/auth';
import { apiTokenService, ApiTokenError, type StoredTokenScope } from '../services/apiTokenService';
import { settingsService } from '../services/settingsService';
import { resolveTournamentId } from '../utils/tournamentRow';
import { log } from '../utils/logger';
import { db } from '../config/database';
import { integrationForMatch, listIntegrations } from '../integrations/registry';
import packageJson from '../../package.json';
import { runningTournamentIds } from '../services/currentTournament';

const router = Router();

// Public version endpoint
router.get('/version', async (_req: Request, res: Response) => {
  return res.json({
    success: true,
    version: packageJson.version,
  });
});

router.use(requireAuth);

/**
 * Kick off automated veto for the in-progress tournament's waiting matches.
 * Runs in the background; a failure here must not fail the settings save.
 */
async function startAutoVetoForRunningTournament(tournamentId: number): Promise<void> {
  try {
    const tournament = await db.queryOneAsync<{ id: number; status: string; game: string | null }>(
      'SELECT id, status, game FROM tournament WHERE id = ?',
      [tournamentId]
    );
    if (!tournament || tournament.status !== 'in_progress') return;

    const started =
      (await integrationForMatch(tournament).startPendingPreMatchPhases?.(tournament.id)) ?? [];
    if (started.length > 0) {
      log.info(
        `[VETO-SIM] Simulation enabled mid-tournament; auto-vetoing ${started.length} waiting match(es)`,
        { matches: started }
      );
    }
  } catch (error) {
    log.error('[VETO-SIM] Failed to start auto veto after enabling simulation', error);
  }
}

/**
 * The settings response: the core's fields, then each integration's
 * (`readInstanceSettings`, CS2: the simulation and `at_*` defaults).
 */
const mapSettingsResponse = async () => {
  const webhookUrl = await settingsService.getWebhookUrl();
  const steamApiKey = await settingsService.getSteamApiKey();
  const defaultPlayerElo = null;
  const ratingsEnabled = await settingsService.areRatingsEnabled();
  const allowSelfRegister = await settingsService.isSelfRegistrationAllowed();
  const siteName = await settingsService.getSiteName();
  const webhooksAllowPrivateTargets = await settingsService.areWebhookPrivateTargetsAllowed();
  const highlights = await readHighlightSettings((key) => settingsService.getSetting(key));

  const integrationFields: Record<string, unknown> = {};
  for (const integration of listIntegrations()) {
    Object.assign(integrationFields, await integration.readInstanceSettings?.());
  }

  return {
    siteName,
    webhookUrl,
    steamApiKey: null,
    steamApiKeySet: Boolean(steamApiKey),
    webhookConfigured: Boolean(webhookUrl),
    defaultPlayerElo,
    ratingsEnabled,
    allowSelfRegister,
    ...highlights,
    webhooksAllowPrivateTargets,
    ...integrationFields,
  };
};

/**
 * @openapi
 * /api/settings/discord-bot:
 *   get:
 *     tags: [Settings]
 *     summary: Whether a Discord bot token is set (for players' DMs), and the bot's name
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: "`set`, `name`" }
 *   put:
 *     tags: [Settings]
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
router.get('/discord-bot', async (_req: Request, res: Response) => {
  try {
    const { discordBot } = await import('../services/notifyChannels');
    return res.json({ success: true, ...(await discordBot.status()) });
  } catch (error) {
    log.error('Reading the Discord bot failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not read the Discord bot' });
  }
});

router.put('/discord-bot', async (req: Request, res: Response) => {
  if ((req as AuthedRequest).serviceToken) {
    return res.status(403).json({ success: false, error: 'Only a signed-in admin can set it' });
  }
  try {
    const { discordBot, ChannelError } = await import('../services/notifyChannels');
    const raw = (req.body ?? {}).token;
    const token = typeof raw === 'string' ? raw : null;
    try {
      return res.json({ success: true, ...(await discordBot.setToken(token)) });
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
 * /api/settings/api-tokens:
 *   get:
 *     tags: [Settings]
 *     summary: API tokens made in Settings (never their secrets)
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: The active tokens }
 *   post:
 *     tags: [Settings]
 *     summary: Make an API token; the secret is in this answer only
 *     description: A signed-in admin only; an API token cannot make tokens.
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label: { type: string, description: '1-32 letters, digits, - or _' }
 *               scope: { type: string, enum: [admin, readonly] }
 *     responses:
 *       201: { description: The token and its secret }
 *       400: { description: Not a valid name or scope }
 *       403: { description: Called with an API token }
 */
router.get('/api-tokens', async (_req: Request, res: Response) => {
  return res.json({ success: true, tokens: await apiTokenService.list() });
});

router.post('/api-tokens', async (req: Request, res: Response) => {
  // A leaked token must not be able to make more of itself.
  if ((req as AuthedRequest).serviceToken) {
    return res
      .status(403)
      .json({ success: false, error: 'Sign in as an admin to make API tokens.' });
  }
  try {
    const { label, scope } = (req.body ?? {}) as { label?: unknown; scope?: unknown };
    const made = await apiTokenService.create(
      typeof label === 'string' ? label : '',
      String(scope ?? '') as StoredTokenScope,
      requestActorId(req)
    );
    return res.status(201).json({ success: true, ...made });
  } catch (error) {
    if (error instanceof ApiTokenError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    log.error('Making an API token failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not make the token' });
  }
});

/**
 * @openapi
 * /api/settings/api-tokens/{id}:
 *   delete:
 *     tags: [Settings]
 *     summary: Revoke an API token made in Settings
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Revoked }
 *       404: { description: No such active token }
 */
router.delete('/api-tokens/:id', async (req: Request, res: Response) => {
  const ok = await apiTokenService.revoke(Number(req.params.id), requestActorId(req));
  if (!ok) return res.status(404).json({ success: false, error: 'No such token' });
  return res.json({ success: true });
});

router.get('/', async (_req: Request, res: Response) => {
  return res.json({
    success: true,
    settings: await mapSettingsResponse(),
  });
});

/**
 * Update settings. Each field is optional; `null` clears it. The fields are
 * the core's and the integrations' (`settingsService.applyUpdate`); a
 * rejected one returns 400, and the fields applied before it stay saved.
 */
router.put('/', async (req: Request, res: Response) => {
  const tournamentId = resolveTournamentId(req);
  const body = req.body as Record<string, unknown>;

  try {
    const error = await settingsService.applyUpdate(body, {
      tournamentId,
      // Instance settings: every running tournament's pending pre-match phases.
      startPendingPreMatchPhases: async () => {
        for (const id of new Set([tournamentId, ...(await runningTournamentIds())])) {
          await startAutoVetoForRunningTournament(id);
        }
      },
    });
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    return res.json({
      success: true,
      settings: await mapSettingsResponse(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update settings';
    log.error('Failed to update settings', error);
    return res.status(400).json({
      success: false,
      error: message,
    });
  }
});

export default router;
