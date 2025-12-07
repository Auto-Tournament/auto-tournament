import { Router, Request, Response } from 'express';
import { serverService } from '../services/serverService';
import { rconService } from '../services/rconService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { getMatchZyWebhookCommands } from '../utils/matchzyRconCommands';
import { getWebhookBaseUrl } from '../utils/urlHelper';

const router = Router();

// Protect all routes
router.use(requireAuth);

/**
 * @openapi
 * /api/servers/{id}/status:
 *   get:
 *     tags:
 *       - Servers
 *     summary: Test server RCON connection
 *     description: Attempts to connect to the server via RCON and returns online/offline status
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Server ID
 *     responses:
 *       200:
 *         description: Server status retrieved
 *       404:
 *         description: Server not found
 */
router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const server = await serverService.getServerById(id);

    if (!server) {
      return res.status(404).json({
        success: false,
        error: `Server '${id}' not found`,
      });
    }

    // Fake server for screenshots/testing - always return online
    // Servers with IP 0.0.0.0 are treated as always online (fake servers)
    if (server.host === '0.0.0.0') {
      return res.json({
        success: true,
        status: 'online',
        serverId: id,
      });
    }

    // Try to connect and send a simple command
    const result = await rconService.sendCommand(id, 'status');

    if (result.success) {
      log.debug(`Server ${id} is online`);

      // Configure webhook automatically when server is online
      const serverToken = process.env.SERVER_TOKEN || '';
      if (serverToken) {
        try {
          const baseUrl = await getWebhookBaseUrl(req);
          // For server status check, use generic webhook without match slug
          // Match-specific webhook will be configured when match is loaded
          const webhookCommands = getMatchZyWebhookCommands(baseUrl, serverToken);
          
          for (const cmd of webhookCommands) {
            await rconService.sendCommand(id, cmd);
          }
          
          const webhookUrl = `${baseUrl}/api/events`;
          log.webhookConfigured(id, webhookUrl);
        } catch (error) {
          // Don't fail status check if webhook setup fails
          log.warn(`Failed to configure webhook for server ${id}`, { error });
        }
      }

      return res.json({
        success: true,
        status: 'online',
        serverId: id,
      });
    } else {
      log.warn(`Server ${id} is offline or unreachable`, { error: result.error });
      return res.json({
        success: true,
        status: 'offline',
        serverId: id,
      });
    }
  } catch (error) {
    log.error('Error checking server status', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check server status',
    });
  }
});

export default router;
