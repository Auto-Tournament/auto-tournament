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
  const defaultPlayerElo = null;
  const simulateMatches = await settingsService.isSimulationModeEnabled();
  const simulationTimescale = await settingsService.getSimulationTimescale();
  const matchzyChatPrefix = await settingsService.getMatchzyChatPrefix();
  const matchzyAdminChatPrefix = await settingsService.getMatchzyAdminChatPrefix();
  const matchzyKnifeEnabledDefault = await settingsService.isKnifeRoundEnabledByDefault();
  const ratingsEnabled = await settingsService.areRatingsEnabled();
  const matchzyDebugChatEnabled = await settingsService.isMatchzyDebugChatEnabled();
  const allowSelfRegister = await settingsService.isSelfRegistrationAllowed();

  return {
    webhookUrl,
    steamApiKey,
    steamApiKeySet: Boolean(steamApiKey),
    webhookConfigured: Boolean(webhookUrl),
    defaultPlayerElo,
    simulateMatches,
    simulationTimescale,
    matchzyChatPrefix,
    matchzyAdminChatPrefix,
    matchzyKnifeEnabledDefault,
    ratingsEnabled,
    matchzyDebugChatEnabled,
    allowSelfRegister,
  };
};

router.get('/', async (_req: Request, res: Response) => {
  return res.json({
    success: true,
    settings: await mapSettingsResponse(),
  });
});

router.put('/', async (req: Request, res: Response) => {
  const {
    webhookUrl,
    steamApiKey,
    simulateMatches,
    simulationTimescale,
    matchzyChatPrefix,
    matchzyAdminChatPrefix,
    matchzyKnifeEnabledDefault,
    ratingsEnabled,
    matchzyDebugChatEnabled,
    allowSelfRegister,
  } = req.body as {
    webhookUrl?: unknown;
    steamApiKey?: unknown;
    simulateMatches?: unknown;
    simulationTimescale?: unknown;
    matchzyChatPrefix?: unknown;
    matchzyAdminChatPrefix?: unknown;
    matchzyKnifeEnabledDefault?: unknown;
    ratingsEnabled?: unknown;
    matchzyDebugChatEnabled?: unknown;
    allowSelfRegister?: unknown;
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

    if (simulateMatches !== undefined) {
      // This is a **developer-only** option – ignore it completely in production.
      if (process.env.NODE_ENV === 'production') {
        log.warn(
          'Received simulateMatches setting update in production environment – ignoring for safety'
        );
      } else {
        if (typeof simulateMatches !== 'boolean' && simulateMatches !== null) {
          return res.status(400).json({
            success: false,
            error: 'simulateMatches must be a boolean or null',
          });
        }

        const value =
          simulateMatches === null ? null : simulateMatches === true ? '1' : '0';

        await settingsService.setSetting('simulate_matches', value);
      }
    }

    if (simulationTimescale !== undefined) {
      if (typeof simulationTimescale !== 'number' && simulationTimescale !== null) {
        return res.status(400).json({
          success: false,
          error: 'simulationTimescale must be a number or null',
        });
      }

      let value: string | null = null;
      if (typeof simulationTimescale === 'number' && Number.isFinite(simulationTimescale)) {
        const clamped = Math.min(4, Math.max(0.1, simulationTimescale));
        value = String(clamped);
      }

      await settingsService.setSetting('simulation_timescale', value);
    }

    if (matchzyChatPrefix !== undefined) {
      if (typeof matchzyChatPrefix !== 'string' && matchzyChatPrefix !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyChatPrefix must be a string or null',
        });
      }

      await settingsService.setSetting(
        'matchzy_chat_prefix',
        typeof matchzyChatPrefix === 'string' ? matchzyChatPrefix : null
      );
    }

    if (matchzyAdminChatPrefix !== undefined) {
      if (typeof matchzyAdminChatPrefix !== 'string' && matchzyAdminChatPrefix !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyAdminChatPrefix must be a string or null',
        });
      }

      await settingsService.setSetting(
        'matchzy_admin_chat_prefix',
        typeof matchzyAdminChatPrefix === 'string' ? matchzyAdminChatPrefix : null
      );
    }

    if (matchzyKnifeEnabledDefault !== undefined) {
      if (typeof matchzyKnifeEnabledDefault !== 'boolean' && matchzyKnifeEnabledDefault !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyKnifeEnabledDefault must be a boolean or null',
        });
      }

      const value =
        matchzyKnifeEnabledDefault === null
          ? null
          : matchzyKnifeEnabledDefault === true
          ? '1'
          : '0';

      await settingsService.setSetting('matchzy_knife_enabled_default', value);
    }

    if (ratingsEnabled !== undefined) {
      if (typeof ratingsEnabled !== 'boolean' && ratingsEnabled !== null) {
        return res.status(400).json({
          success: false,
          error: 'ratingsEnabled must be a boolean or null',
        });
      }

      const value =
        ratingsEnabled === null ? null : ratingsEnabled === true ? '1' : '0';

      await settingsService.setSetting('ratings_enabled', value);
    }

    if (matchzyDebugChatEnabled !== undefined) {
      if (typeof matchzyDebugChatEnabled !== 'boolean' && matchzyDebugChatEnabled !== null) {
        return res.status(400).json({
          success: false,
          error: 'matchzyDebugChatEnabled must be a boolean or null',
        });
      }

      const value =
        matchzyDebugChatEnabled === null
          ? null
          : matchzyDebugChatEnabled === true
          ? '1'
          : '0';

      await settingsService.setSetting('matchzy_debug_chat', value);
    }

    if (allowSelfRegister !== undefined) {
      if (typeof allowSelfRegister !== 'boolean' && allowSelfRegister !== null) {
        return res.status(400).json({
          success: false,
          error: 'allowSelfRegister must be a boolean or null',
        });
      }

      const value =
        allowSelfRegister === null ? null : allowSelfRegister === true ? '1' : '0';

      await settingsService.setSetting('allow_self_register', value);
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

