import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { settingsService } from '../services/settingsService';
import { log } from '../utils/logger';
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

const mapSettingsResponse = async () => {
  const webhookUrl = await settingsService.getWebhookUrl();
  const steamApiKey = await settingsService.getSteamApiKey();
  const defaultPlayerElo = await settingsService.getDefaultPlayerElo();

  return {
    webhookUrl,
    steamApiKey,
    steamApiKeySet: Boolean(steamApiKey),
    webhookConfigured: Boolean(webhookUrl),
    defaultPlayerElo,
  };
};

router.get('/', async (_req: Request, res: Response) => {
  return res.json({
    success: true,
    settings: await mapSettingsResponse(),
  });
});

router.put('/', async (req: Request, res: Response) => {
  const { webhookUrl, steamApiKey, defaultPlayerElo } = req.body as {
    webhookUrl?: unknown;
    steamApiKey?: unknown;
    defaultPlayerElo?: unknown;
  };

  try {
    if (webhookUrl !== undefined) {
      if (typeof webhookUrl !== 'string' && webhookUrl !== null) {
        return res.status(400).json({
          success: false,
          error: 'webhookUrl must be a string or null',
        });
      }
      await settingsService.setSetting('webhook_url', typeof webhookUrl === 'string' ? webhookUrl : null);
    }

    if (steamApiKey !== undefined) {
      if (typeof steamApiKey !== 'string' && steamApiKey !== null) {
        return res.status(400).json({
          success: false,
          error: 'steamApiKey must be a string or null',
        });
      }
      await settingsService.setSetting(
        'steam_api_key',
        typeof steamApiKey === 'string' ? steamApiKey : null
      );
    }

    if (defaultPlayerElo !== undefined) {
      if (
        (typeof defaultPlayerElo !== 'number' || !Number.isFinite(defaultPlayerElo)) &&
        defaultPlayerElo !== null
      ) {
        return res.status(400).json({
          success: false,
          error: 'defaultPlayerElo must be a number or null',
        });
      }

      const value =
        typeof defaultPlayerElo === 'number' && Number.isFinite(defaultPlayerElo)
          ? String(Math.round(defaultPlayerElo))
          : null;

      await settingsService.setSetting('default_player_elo', value);
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

