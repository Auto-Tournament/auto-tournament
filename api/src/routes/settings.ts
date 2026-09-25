import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { settingsService } from '../services/settingsService';
import { resolveTournamentId } from '../utils/tournamentRow';
import { log } from '../utils/logger';
import { db } from '../config/database';
import { integrationForMatch, listIntegrations } from '../integrations/registry';
import packageJson from '../../package.json';
import { clearIgdbTokenCache, testIgdbConnection } from '../services/igdbService';
import { clearGameSearchCache } from '../services/gameCatalogService';
import { resolveStoredGamesAgainstIgdb } from '../services/gameEnrichmentService';
import { forgetGameIconChecks, refreshGameIcons } from '../services/gameIconService';

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
    ...integrationFields,
  };
};

/**
 * @openapi
 * /api/settings/igdb:
 *   get:
 *     tags: [Settings]
 *     summary: IGDB credential status (admin)
 *     description: |
 *       Whether IGDB (the game catalogue source) is configured, and from where.
 *       The client secret is write-only and never returned; `clientSecretSet`
 *       says whether one is stored. IGDB_CLIENT_ID / IGDB_CLIENT_SECRET in the
 *       environment win over saved settings (`envOverride`).
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Credential status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 igdb:
 *                   $ref: '#/components/schemas/IgdbCredentialStatus'
 */
router.get('/igdb', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, igdb: await settingsService.getIgdbCredentialStatus() });
  } catch (error) {
    log.error('Error reading IGDB settings', error);
    return res.status(500).json({ success: false, error: 'Failed to load IGDB settings' });
  }
});

/**
 * @openapi
 * /api/settings/igdb:
 *   put:
 *     tags: [Settings]
 *     summary: Save IGDB credentials (admin)
 *     description: |
 *       Omit a field to keep it. `clientSecret` is write-only: send a new one to
 *       replace it, or null to remove it. An empty `clientId` removes both.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               clientId: { type: string, nullable: true }
 *               clientSecret: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Saved; the new status (never the secret)
 *       400:
 *         description: Invalid body
 */
router.put('/igdb', async (req: Request, res: Response) => {
  const { clientId, clientSecret } = (req.body ?? {}) as {
    clientId?: unknown;
    clientSecret?: unknown;
  };
  const validField = (v: unknown) => v === undefined || v === null || typeof v === 'string';
  if (!validField(clientId) || !validField(clientSecret)) {
    return res
      .status(400)
      .json({ success: false, error: 'clientId and clientSecret must be strings or null' });
  }
  if (
    (typeof clientId === 'string' && clientId.length > 200) ||
    (typeof clientSecret === 'string' && clientSecret.length > 200)
  ) {
    return res.status(400).json({ success: false, error: 'Credential too long' });
  }

  try {
    const clearAll = clientId === null || (typeof clientId === 'string' && clientId.trim() === '');
    if (clearAll) {
      await settingsService.setSetting('igdb_client_id', null);
      await settingsService.setSetting('igdb_client_secret', null);
    } else {
      if (typeof clientId === 'string') {
        await settingsService.setSetting('igdb_client_id', clientId);
      }
      // An empty string means "unchanged": the form never shows the stored secret.
      if (clientSecret === null) {
        await settingsService.setSetting('igdb_client_secret', null);
      } else if (typeof clientSecret === 'string' && clientSecret.trim() !== '') {
        await settingsService.setSetting('igdb_client_secret', clientSecret);
      }
    }

    clearIgdbTokenCache();
    clearGameSearchCache();
    // Games stored while search ran on Wikidata get their IGDB cover now,
    // in the background, rather than at the next restart — and then, since
    // IGDB may know Steam ids Wikidata did not, another look for app icons.
    await forgetGameIconChecks();
    void resolveStoredGamesAgainstIgdb().then(() => refreshGameIcons());
    return res.json({ success: true, igdb: await settingsService.getIgdbCredentialStatus() });
  } catch (error) {
    log.error('Error saving IGDB settings', error);
    return res.status(500).json({ success: false, error: 'Failed to save IGDB settings' });
  }
});

/**
 * @openapi
 * /api/settings/igdb/test:
 *   post:
 *     tags: [Settings]
 *     summary: Test the IGDB connection (admin)
 *     description: Requests a fresh Twitch token and runs a one-row IGDB query with the active credentials.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: "`ok: true`, or `ok: false` with an error safe to show"
 */
router.post('/igdb/test', async (_req: Request, res: Response) => {
  const result = await testIgdbConnection();
  return res.json({ success: true, ...result });
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
      startPendingPreMatchPhases: () => startAutoVetoForRunningTournament(tournamentId),
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

