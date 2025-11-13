import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { settingsService } from '../services/settingsService';
import { log } from '../utils/logger';

const router = Router();

router.use(requireAuth);

const mapSettingsResponse = () => {
  const webhookUrl = settingsService.getWebhookUrl();
  const steamApiKey = settingsService.getSteamApiKey();

  return {
    webhookUrl,
    steamApiKey,
    steamApiKeySet: Boolean(steamApiKey),
    webhookConfigured: Boolean(webhookUrl),
  };
};

router.get('/', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    settings: mapSettingsResponse(),
  });
});

router.put('/', (req: Request, res: Response) => {
  const { webhookUrl, steamApiKey } = req.body as {
    webhookUrl?: unknown;
    steamApiKey?: unknown;
  };

  try {
    if (webhookUrl !== undefined) {
      if (typeof webhookUrl !== 'string' && webhookUrl !== null) {
        return res.status(400).json({
          success: false,
          error: 'webhookUrl must be a string or null',
        });
      }
      settingsService.setSetting('webhook_url', typeof webhookUrl === 'string' ? webhookUrl : null);
    }

    if (steamApiKey !== undefined) {
      if (typeof steamApiKey !== 'string' && steamApiKey !== null) {
        return res.status(400).json({
          success: false,
          error: 'steamApiKey must be a string or null',
        });
      }
      settingsService.setSetting(
        'steam_api_key',
        typeof steamApiKey === 'string' ? steamApiKey : null
      );
    }

    return res.json({
      success: true,
      settings: mapSettingsResponse(),
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

