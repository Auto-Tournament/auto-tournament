import type { Request, Response } from 'express';
import { Router } from 'express';
import { serverService } from '../services/serverService';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';

const router = Router();

// Protect all routes
router.use(requireAuth);

/**
 * @openapi
 * /api/servers/{id}/status:
 *   get:
 *     tags:
 *       - Servers
 *     summary: Server status
 *     description: The server's state as its Ready Up fleet link reports it
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
        cs2RequiredVersion: server.cs2RequiredVersion ?? null,
        cs2UpdatePhase: server.cs2UpdatePhase ?? null,
        cs2UpdateCheckedAt: server.cs2UpdateCheckedAt ?? null,
      });
    }

    // A Ready Up server's state is what its fleet link reports.
    const { fleetServerStatus } = await import('../fleet/driver');
    const fleet = await fleetServerStatus(id);
    return res.json({
      success: true,
      status: fleet.online ? 'online' : 'offline',
      serverId: id,
      isAvailable: fleet.online && fleet.availability === 'available' && !fleet.matchSlug,
      currentMatch: fleet.matchSlug,
      queuedMatch: null,
      reachableFromApi: fleet.online,
      serverCanReachApi: fleet.online,
      pluginStatus: fleet.status,
      allocationState: null,
      allocationMatchSlug: null,
      ipBanned: false,
      cs2BuildId: server.cs2BuildId ?? null,
      cs2RequiredVersion: server.cs2RequiredVersion ?? null,
      cs2UpdatePhase: server.cs2UpdatePhase ?? null,
      cs2UpdateCheckedAt: server.cs2UpdateCheckedAt ?? null,
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
