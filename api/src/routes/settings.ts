import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { settingsService } from '../services/settingsService';
import { resolveTournamentId } from '../utils/tournamentRow';
import { log } from '../utils/logger';
import { db } from '../config/database';
import { integrationForMatch, listIntegrations } from '../integrations/registry';
import packageJson from '../../package.json';

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

