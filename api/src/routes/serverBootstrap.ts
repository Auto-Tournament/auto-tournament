import { Router, Request, Response } from 'express';
import { validateServerToken } from '../middleware/serverAuth';
import { settingsService } from '../services/settingsService';
import { serverService } from '../services/serverService';
import { log } from '../utils/logger';
import {
  getMatchZyWebhookCommands,
  getMatchZyDemoUploadCommands,
  getMatchZyLoadMatchAuthCommands,
  getMatchZyCoreSettingsCommands,
  getMatchZyServerConfigCommands,
} from '../utils/matchzyRconCommands';

const router = Router();

/**
 * GET /api/servers/:id/bootstrap
 *
 * Server-only endpoint. Used by MatchZy Enhanced to fetch a single initialization payload
 * instead of requiring many individual RCON commands with delays.
 */
router.get('/:id/bootstrap', validateServerToken, async (req: Request, res: Response) => {
  const serverId = req.params.id;
  const serverToken = process.env.SERVER_TOKEN || '';

  try {
    const baseUrl = await settingsService.getWebhookUrl();
    if (!baseUrl) {
      return res.status(500).json({
        success: false,
        error: 'Webhook base URL is not configured',
      });
    }

    if (!serverToken) {
      return res.status(500).json({
        success: false,
        error: 'SERVER_TOKEN is required',
      });
    }

    const server = await serverService.getServerById(serverId);
    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found',
      });
    }

    const [chatPrefix, adminChatPrefix, knifeEnabledDefault, debugChatEnabled, matchzyCoreDefaults] =
      await Promise.all([
        settingsService.getMatchzyChatPrefix(),
        settingsService.getMatchzyAdminChatPrefix(),
        settingsService.isKnifeRoundEnabledByDefault(),
        settingsService.isMatchzyDebugChatEnabled(),
        settingsService.getMatchzyCoreDefaults(),
      ]);

    const perServerOverrides = server.matchzyConfig ?? {};
    const mergedServerConfig = { ...matchzyCoreDefaults, ...perServerOverrides };

    const commands: string[] = [
      // Ensure any queued events don't keep retrying against a stale URL.
      'matchzy_clear_event_queue',
      // Ensure server_id is set (even if the controller sets it separately via RCON).
      `matchzy_server_id "${serverId}"`,
      ...getMatchZyWebhookCommands(baseUrl, serverToken, null),
      ...getMatchZyDemoUploadCommands(baseUrl, null, serverToken),
      ...getMatchZyLoadMatchAuthCommands(serverToken),
      ...getMatchZyCoreSettingsCommands({
        chatPrefix,
        adminChatPrefix,
        knifeEnabledDefault,
        debugChatEnabled,
      }),
      ...getMatchZyServerConfigCommands(mergedServerConfig),
    ];

    return res.json({
      success: true,
      serverId,
      commands,
    });
  } catch (error) {
    log.error('[BOOTSTRAP] Failed to build bootstrap payload', { serverId, error });
    return res.status(500).json({
      success: false,
      error: 'Failed to build bootstrap payload',
    });
  }
});

export default router;

