import { Router, Request, Response } from 'express';
import { serverService } from '../services/serverService';
import { rconService } from '../services/rconService';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';

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
    const server = serverService.getServerById(id);

    if (!server) {
      return res.status(404).json({
        success: false,
        error: `Server '${id}' not found`,
      });
    }

    // Try to connect and send a simple command
    try {
      await rconService.sendCommand(id, 'status');
      log.info(`Server ${id} is online`);
      return res.json({
        success: true,
        status: 'online',
        serverId: id,
      });
    } catch (error) {
      log.warn(`Server ${id} is offline or unreachable`, { error });
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
