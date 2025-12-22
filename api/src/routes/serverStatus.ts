import { Router, Request, Response } from 'express';
import { serverService } from '../services/serverService';
import { rconService } from '../services/rconService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { getMatchZyWebhookCommands } from '../utils/matchzyRconCommands';
import { getWebhookBaseUrl } from '../utils/urlHelper';
import { serverStatusService, ServerStatus } from '../services/serverStatusService';
import { getLastServerTestEvent } from '../services/serverConnectivityService';
import { serverAllocationTracker } from '../services/serverAllocationTracker';
import { db } from '../config/database';
import type { DbMatchRow } from '../types/database.types';

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
        isAvailable: true,
        currentMatch: null,
      });
    }

    // Prefer detailed status from the MatchZy plugin ConVars (includes current match slug)
    const statusInfo = await Promise.race([
      serverStatusService.getServerStatus(id),
      new Promise<{
        status: null;
        matchSlug: null;
        updatedAt: null;
        online: false;
      }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              status: null,
              matchSlug: null,
              updatedAt: null,
              online: false,
            }),
          2000
        )
      ),
    ]);

    const reachableFromApi = statusInfo.online;

    if (!statusInfo.online) {
      log.warn(`Server ${id} is offline or unreachable (status check failed)`);
      return res.json({
        success: true,
        status: 'offline',
        serverId: id,
        isAvailable: false,
        currentMatch: null,
      });
    }

    // Derive a more accurate status by combining plugin ConVars with our DB view of
    // which matches are actually running on this server. This helps in cases where
    // the MatchZy plugin has not yet updated its custom status ConVars and is still
    // reporting "idle" even though a match is already loaded or live.
    let effectiveStatus = statusInfo.status;
    let effectiveMatchSlug = statusInfo.matchSlug;

    if (!effectiveStatus || effectiveStatus === ServerStatus.IDLE || effectiveStatus === ServerStatus.POSTGAME) {
      try {
        const activeMatch = await db.queryOneAsync<Pick<DbMatchRow, 'slug' | 'status'>>(
          'SELECT slug, status FROM matches WHERE server_id = ? AND status IN (?, ?) ORDER BY created_at DESC LIMIT 1',
          [id, 'live', 'loaded']
        );

        if (activeMatch) {
          effectiveMatchSlug = activeMatch.slug;
          if (activeMatch.status === 'live') {
            effectiveStatus = ServerStatus.LIVE;
          } else if (activeMatch.status === 'loaded') {
            // Treat a loaded match with players connecting as "warmup" so the UI
            // doesn't show the server as idle while the match is staged.
            effectiveStatus = ServerStatus.WARMUP;
          }
        }
      } catch (dbError) {
        log.warn(`Failed to derive active match status for server ${id}`, { error: dbError });
      }
    }

    log.debug(`Server ${id} is online`, {
      pluginStatus: statusInfo.status,
      pluginMatchSlug: statusInfo.matchSlug,
      effectiveStatus,
      effectiveMatchSlug,
    });

    // Configure webhook automatically when server is online
    const serverToken = process.env.SERVER_TOKEN || '';
    if (serverToken) {
      try {
        const baseUrl = await getWebhookBaseUrl(req);
        // For server status check and connectivity tests, configure a server-specific
        // webhook URL so test events include the server ID in the path.
        // Match-specific webhook (with match slug) will still be configured when a match loads.
        const webhookCommands = getMatchZyWebhookCommands(baseUrl, serverToken, id);

        for (const cmd of webhookCommands) {
          await rconService.sendCommand(id, cmd);
        }

        const webhookUrl = `${baseUrl}/api/events/${id}`;
        log.webhookConfigured(id, webhookUrl);
      } catch (error) {
        // Don't fail status check if webhook setup fails
        log.warn(`Failed to configure webhook for server ${id}`, { error });
      }
    }

    const isAvailable =
      !effectiveMatchSlug ||
      effectiveStatus === ServerStatus.IDLE ||
      effectiveStatus === ServerStatus.POSTGAME;

    // Combine plugin status with internal allocation tracker state
    const allocationState = serverAllocationTracker.getState(id);
    const allocationLabel = allocationState?.state ?? 'unknown';

    // Bi-directional connectivity check:
    //  - We already know we can reach the server via RCON (reachableFromApi).
    //  - Now trigger css_te so the server sends a test event back to /api/events.
    const previousTestEventTs = getLastServerTestEvent(id) ?? 0;
    let serverCanReachApi = false;

    try {
      await rconService.sendCommand(id, 'css_te');

      const timeoutMs = 5000;
      const pollIntervalMs = 250;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const lastTs = getLastServerTestEvent(id) ?? 0;
        if (lastTs > previousTestEventTs) {
          serverCanReachApi = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } catch (error) {
      log.warn(`Failed to send css_te connectivity test to server ${id}`, { error });
    }

    return res.json({
      success: true,
      status: 'online',
      serverId: id,
      isAvailable,
      currentMatch: effectiveMatchSlug,
      reachableFromApi,
      serverCanReachApi,
      pluginStatus: effectiveStatus,
      allocationState: allocationLabel,
      allocationMatchSlug: allocationState?.matchSlug ?? null,
    });
  } catch (error) {
    log.error('Error checking server status', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check server status',
    });
  }
});

export default router;
