import { Router, Request, Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import {
  findActiveMatchForServer,
  settleEndedMatch,
} from '../../../services/matchTerminationService';
import {
  answerWithFleetCommand,
  fleetCommandFor,
  fleetExec,
  fleetResponseBody,
  issuedBy,
} from './fleetCommands';
import { addPlayer, currentPosition, runFleetCommand } from '../fleet/driver';

const router = Router();

// The admin server buttons, sent to each server as fleet commands (FLEET.md §7.4).
router.use(requireAuth);

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

    await answerWithFleetCommand(req, res, serverId, 'practice.set', { on: true });
    return res;
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

    await answerWithFleetCommand(req, res, serverId, 'start');
    return res;
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

    await answerWithFleetCommand(req, res, serverId, 'change_map', { name: mapName });
    return res;
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

    await answerWithFleetCommand(req, res, serverId, 'pause', { type: 'technical' });
    return res;
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

    await answerWithFleetCommand(req, res, serverId, 'unpause');
    return res;
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

    await answerWithFleetCommand(req, res, serverId, 'pause', { type: 'admin' });
    return res;
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

    await answerWithFleetCommand(req, res, serverId, 'unpause');
    return res;
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
    // (Ready Up: restart_map, back to warmup on the same map.)
    await answerWithFleetCommand(req, res, serverId, 'restart_map');
    return res;
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

    await answerWithFleetCommand(req, res, serverId, 'start');
    return res;
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

    return res.json({
      success: true,
      transport: 'fleet',
      response: 'Ready Up servers get their admins from the platform; nothing to reload',
    });
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

    await answerWithFleetCommand(req, res, serverId, 'say', {
      text: sanitizedMessage.slice(0, 190),
    });
    return res;
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

    // `say {as_admin}` over each server's fleet link.
    const sendTo = async (serverId: string) => {
      const outcome = await runFleetCommand(
        serverId,
        'say',
        { text: sanitizedMessage.slice(0, 190), as_admin: true },
        issuedBy(req)
      );
      return { ...fleetResponseBody(outcome), serverId };
    };

    let results;
    if (serverIds && Array.isArray(serverIds) && serverIds.length > 0) {
      // Send to specific servers
      results = await Promise.all(serverIds.map((serverId: string) => sendTo(serverId)));
    } else {
      // Broadcast to all enabled servers
      const { serverService } = await import('../services/serverService');
      const servers = await serverService.getAllServers(true);
      results = await Promise.all(servers.map((server) => sendTo(server.id)));
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

    await answerWithFleetCommand(req, res, serverId, 'swap_teams');
    return res;
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

    // Ready Up: restore_round on the current map; `round` is the round the
    // backup starts (1-based), and the server uses its own backup file.
    const position = await currentPosition(serverId);
    if (!position) {
      return res
        .status(409)
        .json({ success: false, transport: 'fleet', error: 'No match is assigned to this server' });
    }
    const outcome = await runFleetCommand(
      serverId,
      'restore_round',
      { map_number: position.mapNumber, round: Math.max(1, Math.floor(Number(round)) || 1) },
      issuedBy(req)
    );
    return res.status(outcome.httpStatus).json(fleetResponseBody(outcome));
  } catch (error) {
    console.error('Error restoring backup:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to restore backup',
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

    // Ready Up: restore the backup the current round started from.
    const position = await currentPosition(serverId);
    if (!position?.round) {
      return res
        .status(409)
        .json({ success: false, transport: 'fleet', error: 'No round is being played' });
    }
    const outcome = await runFleetCommand(
      serverId,
      'restart_round',
      { map_number: position.mapNumber, round: position.round },
      issuedBy(req)
    );
    return res.status(outcome.httpStatus).json(fleetResponseBody(outcome));
  } catch (error) {
    console.error('Error restarting round:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to restart round',
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

    const result = fleetResponseBody(
      await runFleetCommand(serverId, 'end_match', { reason: 'admin' }, issuedBy(req))
    );

    // The platform's record is what ends the match: settled here even when the
    // server did not answer, or the row stays 'live' on the Matches tab. The
    // answer says whether the server confirmed.
    const match = await findActiveMatchForServer(serverId);
    if (match) {
      await settleEndedMatch(match, 'end match');
      return res.json({
        ...result,
        success: true,
        settled: true,
        serverConfirmed: result.success,
        ...(result.success
          ? {}
          : {
              warning: `The match is over here, but the server did not confirm: ${result.error ?? result.status}`,
            }),
      });
    }
    log.warn(
      `[RCON] End match on ${serverId}: no loaded/live match was found for it; nothing to settle`
    );
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    console.error('Error ending match:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to end match',
    });
  }
});

/**
 * POST /api/rcon/:serverId/add-player
 * Add a backup player or spectator to the match currently set up on a server.
 *
 * A Ready Up match.update add_player on the match the server plays.
 */
router.post('/:serverId/add-player', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const { steamId, team, nickname } = req.body as {
      steamId?: string;
      team?: string;
      nickname?: string;
    };

    if (!steamId || !team) {
      return res.status(400).json({
        success: false,
        error: 'steamId and team are required',
      });
    }

    if (!/^\d{17}$/.test(steamId)) {
      return res.status(400).json({
        success: false,
        error: 'steamId must be a 17-digit Steam64 ID',
      });
    }

    const allowedTeams = ['team1', 'team2', 'spec'];
    if (!allowedTeams.includes(team)) {
      return res.status(400).json({
        success: false,
        error: `team must be one of: ${allowedTeams.join(', ')}`,
      });
    }

    const safeName = (nickname || steamId).replace(/"/g, '').trim() || steamId;

    const outcome = await addPlayer(serverId, {
      steamid64: steamId,
      name: safeName,
      team: team === 'spec' ? 'spectator' : (team as 'team1' | 'team2'),
    });
    if (outcome.ok) {
      return res.json({
        success: true,
        transport: 'fleet',
        message: `${safeName} added to ${team}`,
      });
    }
    return res
      .status(outcome.status)
      .json({ success: false, transport: 'fleet', error: outcome.error });
  } catch (error) {
    log.error('Error adding player to match', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add player to match',
    });
  }
});

/**
 * POST /api/rcon/command
 * Execute generic admin commands with parameters
 */
router.post('/command', async (req: Request, res: Response) => {
  try {
    const { serverIds, command, message, round, value, map } = req.body;

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

    // Execute command on all specified servers
    const results = await Promise.all(
      serverIds.map(async (serverId: string) => {
        // A raw command is `exec` (root only, audited); the named ones are
        // their fleet commands.
        if (command === 'custom') {
          const exec = await fleetExec(req, serverId, String(value ?? ''));
          return { serverId, ...exec.body };
        }
        const mapped = fleetCommandFor({ command, message, round, value, map });
        if (!mapped) {
          return {
            serverId,
            success: false,
            transport: 'fleet' as const,
            error: `${command} is not available on Ready Up servers`,
          };
        }
        const outcome = await runFleetCommand(serverId, mapped.name, mapped.args, issuedBy(req));
        return { serverId, ...fleetResponseBody(outcome) };
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
