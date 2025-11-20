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
 * POST /api/rcon/test-connection
 * Test RCON connection to a server without requiring it to be saved
 */
router.post('/test-connection', async (req: Request, res: Response) => {
  try {
    const { host, port, password, name } = req.body;

    if (!host || !port || !password) {
      return res.status(400).json({
        success: false,
        error: 'host, port, and password are required',
      });
    }

    const portNum = parseInt(String(port));
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return res.status(400).json({
        success: false,
        error: 'port must be a number between 1 and 65535',
      });
    }

    const result = await rconService.testConnectionByParams(host, portNum, password, name);
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
 * Pause the current match (css_pause)
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
 * Unpause the current match (css_unpause)
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
 * POST /api/rcon/force-pause
 * Admin pause (css_forcepause)
 */
router.post('/force-pause', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'css_forcepause');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error force pausing match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to force pause match',
    });
  }
});

/**
 * POST /api/rcon/force-unpause
 * Force unpause the match (css_forceunpause)
 */
router.post('/force-unpause', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'css_forceunpause');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error force unpausing match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to force unpause match',
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

    // Note: This endpoint is for CS2 round restart, not match restart
    // For match restart, use css_restart instead
    const result = await rconService.sendCommand(serverId, 'mp_restartgame 1');
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
 * Reload admin configuration (reload_admins)
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

    const result = await rconService.sendCommand(serverId, 'reload_admins');
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
 * Broadcast an admin message to all servers or specific servers (css_asay)
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
          rconService.sendCommand(serverId, `css_asay ${sanitizedMessage}`)
        )
      );
    } else {
      // Broadcast to all enabled servers
      const { serverService } = await import('../services/serverService');
      const servers = await serverService.getAllServers(true);
      results = await Promise.all(
        servers.map((server) => rconService.sendCommand(server.id, `css_asay ${sanitizedMessage}`))
      );
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return res.status(failed > 0 ? 207 : 200).json({
      success: failed === 0,
      message: `Admin broadcast sent to ${successful} server(s), ${failed} failed`,
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

/**
 * POST /api/rcon/swap-teams
 * Swap teams (switch sides) - css_switch
 */
router.post('/swap-teams', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'css_switch');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error swapping teams:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to swap teams',
    });
  }
});

/**
 * POST /api/rcon/restore-backup
 * Restore match to a specific round (css_restore)
 */
router.post('/restore-backup', async (req: Request, res: Response) => {
  try {
    const { serverId, round } = req.body;

    if (!serverId || round === undefined) {
      return res.status(400).json({
        success: false,
        error: 'serverId and round are required',
      });
    }

    const result = await rconService.sendCommand(serverId, `css_restore ${round}`);
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error restoring backup:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to restore backup',
    });
  }
});

/**
 * POST /api/rcon/skip-veto
 * Skip the veto phase (css_skipveto or css_sv)
 */
router.post('/skip-veto', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'css_skipveto');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error skipping veto:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to skip veto',
    });
  }
});

/**
 * POST /api/rcon/restart-round
 * Restart the current round
 */
router.post('/restart-round', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body;

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'serverId is required',
      });
    }

    const result = await rconService.sendCommand(serverId, 'mp_restartgame 1');
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error restarting round:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to restart round',
    });
  }
});

/**
 * POST /api/rcon/add-time
 * Add time to the current round
 */
router.post('/add-time', async (req: Request, res: Response) => {
  try {
    const { serverId, seconds } = req.body;

    if (!serverId || !seconds) {
      return res.status(400).json({
        success: false,
        error: 'serverId and seconds are required',
      });
    }

    const result = await rconService.sendCommand(serverId, `mp_roundtime_defuse ${seconds / 60}`);
    const statusCode = result.success ? 200 : 400;

    return res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error adding time:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add time',
    });
  }
});

/**
 * POST /api/rcon/end-match
 * Force end the current match (css_restart / css_endmatch)
 */
router.post('/end-match', async (req: Request, res: Response) => {
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
    console.error('Error ending match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to end match',
    });
  }
});

/**
 * POST /api/rcon/command
 * Execute generic admin commands with parameters
 */
router.post('/command', async (req: Request, res: Response) => {
  try {
    const { serverIds, command, message, round, value, map, name } = req.body;

    if (!serverIds || !Array.isArray(serverIds) || serverIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'serverIds array is required',
      });
    }

    if (!command) {
      return res.status(400).json({
        success: false,
        error: 'command is required',
      });
    }

    // Build the full command with parameters
    let fullCommand = command;

    // Handle custom raw RCON commands
    if (command === 'custom' && value) {
      // Use the value directly as the raw command without any prefix
      fullCommand = value;
    } else {
      // List of base RCON commands and prefixes that don't need modification
      const baseRconCommands = ['status', 'changelevel', 'kick', 'ban', 'exec', 'rcon_password', 'say'];

      // Add css_ prefix if not present and not a raw RCON command or already prefixed
      if (
        !fullCommand.startsWith('css_') &&
        !fullCommand.startsWith('matchzy_') &&
        !fullCommand.startsWith('mp_') &&
        !fullCommand.startsWith('sv_') &&
        !fullCommand.startsWith('say') &&
        !baseRconCommands.includes(fullCommand.split(' ')[0])
      ) {
        fullCommand = `css_${fullCommand}`;
      }

      // Append parameters based on the command
      if (message !== undefined) {
        // For css_asay and say commands
        fullCommand = `${fullCommand} ${message}`;
      } else if (round !== undefined) {
        // For css_restore
        fullCommand = `${fullCommand} ${round}`;
      } else if (value !== undefined && command !== 'custom') {
        // For css commands with value parameters (css_readyrequired, etc.)
        fullCommand = `${fullCommand} ${value}`;
      } else if (map !== undefined) {
        // For css_map
        fullCommand = `${fullCommand} ${map}`;
      } else if (name !== undefined) {
        // For css_team1, css_team2
        fullCommand = `${fullCommand} ${name}`;
      }
    }

    // Execute command on all specified servers
    const results = await Promise.all(
      serverIds.map(async (serverId: string) => {
        const result = await rconService.sendCommand(serverId, fullCommand);
        return {
          serverId,
          success: result.success,
          response: result.response,
          error: result.error,
        };
      })
    );

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return res.status(failed > 0 ? 207 : 200).json({
      success: failed === 0,
      message: `Command executed on ${successful} server(s), ${failed} failed`,
      results,
      stats: {
        total: results.length,
        successful,
        failed,
      },
    });
  } catch (error) {
    console.error('Error executing command:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to execute command',
    });
  }
});

export default router;
