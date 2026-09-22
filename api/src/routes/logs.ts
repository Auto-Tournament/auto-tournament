import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getRecentLogs } from '../utils/logger';

const router = Router();

// Protect all routes
router.use(requireAuth);

/**
 * @openapi
 * /api/logs:
 *   get:
 *     tags:
 *       - Logs
 *     summary: Get recent application logs
 *     description: Returns recent log entries for debugging and auditing
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of logs to return
 *       - in: query
 *         name: level
 *         schema:
 *           type: string
 *           enum: [debug, info, warn, error]
 *         description: Filter by log level
 *     responses:
 *       200:
 *         description: Logs retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const levelFilter = req.query.level as string;

    let logs = getRecentLogs(limit);

    // Filter by level if specified
    if (levelFilter) {
      logs = logs.filter((log) => log.level === levelFilter);
    }

    return res.json({
      success: true,
      logs,
      count: logs.length,
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch logs',
    });
  }
});

export default router;
