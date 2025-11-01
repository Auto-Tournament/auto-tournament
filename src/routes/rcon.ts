import { Router, Request, Response } from 'express';
import { rconService } from '../services/rconService';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Apply authentication to all RCON routes
router.use(requireAuth);

/**
 * GET /api/rcon/test/:serverId
 * Test RCON connection to a specific server
 */
router.get('/test/:serverId', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const result = await rconService.testConnection(serverId);
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error testing connection:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to test connection',
    });
  }
});

/**
 * GET /api/rcon/test
 * Test RCON connections to all enabled servers
 */
router.get('/test', async (_req: Request, res: Response) => {
  try {
    const results = await rconService.testAllConnections();
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return res.json({
      success: failed === 0,
      message: `${successful} server(s) online, ${failed} offline/failed`,
      results,
      stats: {
        total: results.length,
        successful,
        failed,
      },
    });
  } catch (error) {
    console.error('Error testing connections:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to test connections',
    });
  }
});

/**
 * Predefined MatchZy commands - Safe and controlled
 */

/**
 * POST /api/rcon/practice-mode
 * Start practice mode (css_prac)
 */
router.post('/practice-mode', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'css_prac');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error starting practice mode:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to start practice mode',
    });
  }
});

/**
 * POST /api/rcon/start-match
 * Force start a match (css_start)
 */
router.post('/start-match', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'css_start');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error starting match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to start match',
    });
  }
});

/**
 * POST /api/rcon/change-map
 * Change map (css_map <mapname>)
 */
router.post('/change-map', async (req: Request, res: Response) => {
  try {
    const { serverId, mapName } = req.body;

    if (!serverId || !mapName) {
      return res.status(400).json({
        success: false,
        error: 'serverId and mapName are required',
      });
    }

    // Validate map name (basic sanitization)
    if (!/^[a-zA-Z0-9_-]+$/.test(mapName)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid map name',
      });
    }

    const result = await rconService.sendCommand(serverId, `css_map ${mapName}`);
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error changing map:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to change map',
    });
  }
});

/**
 * POST /api/rcon/pause-match
 * Pause the current match
 */
router.post('/pause-match', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'css_pause');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error pausing match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to pause match',
    });
  }
});

/**
 * POST /api/rcon/unpause-match
 * Unpause the current match
 */
router.post('/unpause-match', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'css_unpause');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error unpausing match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to unpause match',
    });
  }
});

/**
 * POST /api/rcon/restart-match
 * Restart the match
 */
router.post('/restart-match', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'css_restart');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error restarting match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to restart match',
    });
  }
});

/**
 * POST /api/rcon/end-warmup
 * End warmup and start match
 */
router.post('/end-warmup', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'mp_warmup_end');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error ending warmup:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to end warmup',
    });
  }
});

/**
 * POST /api/rcon/reload-admins
 * Reload admin configuration
 */
router.post('/reload-admins', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'css_reload_admins');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error reloading admins:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to reload admins',
    });
  }
});

/**
 * POST /api/rcon/say
 * Send a message to server chat (sanitized)
 */
router.post('/say', async (req: Request, res: Response) => {
  try {
    const { serverId, message } = req.body;

    if (!serverId || !message) {
      return res.status(400).json({
        success: false,
        error: 'serverId and message are required',
      });
    }

    // Sanitize message (remove special characters that could be exploited)
    const sanitizedMessage = message.replace(/[";\\]/g, '').substring(0, 200);

    const result = await rconService.sendCommand(serverId, `say ${sanitizedMessage}`);
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error sending message:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send message',
    });
  }
});

/**
 * POST /api/rcon/broadcast
 * Broadcast a message to all servers or specific servers
 */
router.post('/broadcast', async (req: Request, res: Response) => {
  try {
    const { message, serverIds } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'message is required',
      });
    }

    // Sanitize message (remove special characters that could be exploited)
    const sanitizedMessage = message.replace(/[";\\]/g, '').substring(0, 200);

    let results;
    if (serverIds && Array.isArray(serverIds) && serverIds.length > 0) {
      // Send to specific servers
      results = await Promise.all(
        serverIds.map((serverId: string) =>
          rconService.sendCommand(serverId, `say ${sanitizedMessage}`)
        )
      );
    } else {
      // Broadcast to all enabled servers
      const { serverService } = await import('../services/serverService');
      const servers = serverService.getAllServers(true);
      results = await Promise.all(
        servers.map((server) => rconService.sendCommand(server.id, `say ${sanitizedMessage}`))
      );
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return res.status(failed > 0 ? 207 : 200).json({
      success: failed === 0,
      message: `Broadcast sent to ${successful} server(s), ${failed} failed`,
      results,
      stats: {
        total: results.length,
        successful,
        failed,
      },
    });
  } catch (error) {
    console.error('Error broadcasting message:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to broadcast message',
    });
  }
});

export default router;
