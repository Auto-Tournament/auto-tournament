import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { db } from '../config/database';
import { playerService } from '../services/playerService';


const router = Router();

/**
 * @openapi
 * /api/test/marker:
 *   post:
 *     tags:
 *       - Testing
 *     summary: Write a sanitized test marker to the API logs
 *     description: >
 *       Helper endpoint for E2E tests to label log output with the current test name or context.
 *       The message is sanitized (length-limited and restricted to safe characters) before logging.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:
 *                 type: string
 *                 description: Free-form test marker (will be sanitized)
 *                 example: "Shuffle Tournament API - should update player ELO after match completion"
 *               scope:
 *                 type: string
 *                 description: Optional scope or shard identifier
 *                 example: "shard-1"
 *     responses:
 *       200:
 *         description: Marker written to logs
 *       400:
 *         description: Invalid request payload
 */
router.post('/marker', requireAuth, (req: Request, res: Response): void => {
  const { message, scope } = req.body as { message?: unknown; scope?: unknown };

  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: 'Field "message" is required and must be a non-empty string',
    });
    return;
  }

  // Sanitize message for logs:
  // - keep full Unicode content (including non-Latin characters)
  // - strip only control characters
  const trimmed = message.trim().slice(0, 300); // limit length
  // Strip ASCII control characters while preserving non‑Latin content.
  // eslint-disable-next-line no-control-regex
  const sanitized = trimmed.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

  const scopeValue = typeof scope === 'string' ? scope.slice(0, 100) : undefined;

  log.info('[TEST-MARKER]', {
    message: sanitized,
    scope: scopeValue,
  });

  res.json({
    success: true,
    message: 'Test marker logged',
  });
});

/**
 * @openapi
 * /api/test/reset-database:
 *   post:
 *     tags:
 *       - Testing
 *     summary: Reset database (development only)
 *     description: >
 *       Drops and recreates the entire database schema and re-initializes default data.
 *       This endpoint is **development only** and is disabled when NODE_ENV=production.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Database was reset and reinitialized successfully
 *       403:
 *         description: Disabled in production environments
 *       500:
 *         description: Failed to reset database
 */
router.post('/reset-database', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({
      success: false,
      error: 'Database reset endpoint is disabled in production',
    });
    return;
  }

  try {
    log.warn('[DEV-TOOLS] Full database reset requested via /api/test/reset-database');
    await db.resetDatabase();
    log.warn('[DEV-TOOLS] Database reset completed successfully');

    res.json({
      success: true,
      message: 'Database reset and reinitialized successfully',
    });
  } catch (err) {
    const error = err as Error;
    log.error('[DEV-TOOLS] Failed to reset database', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset database',
      details: error.message,
    });
  }
});

/**
 * Test-only helper: create an admin session for Playwright tests.
 *
 * POST /api/test/login-admin
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post('/login-admin', async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({
      success: false,
      error: 'login-admin test helper is disabled in production',
    });
    return;
  }

  const anyReq = req as Request & {
    login?: (user: unknown, cb: (err: unknown) => void) => void;
  };

  if (!anyReq.login) {
    res.status(500).json({
      success: false,
      error: 'Passport login function is not available on request object',
    });
    return;
  }

  try {
    const { steamId } = req.body as { steamId?: string };
    const testSteamId = steamId && steamId.trim().length > 0 ? steamId.trim() : '76561198000000001';

    // Ensure a player exists and is marked as admin for this Steam ID.
    await playerService.getOrCreatePlayer(testSteamId, `Test Admin ${testSteamId}`);
    await playerService.updatePlayer(testSteamId, { isAdmin: true });

    const user = {
      provider: 'steam' as const,
      steamId: testSteamId,
    };

    anyReq.login(user, (err) => {
      if (err) {
        log.error('Failed to create admin session via /api/test/login-admin', err as Error);
        res.status(500).json({
          success: false,
          error: 'Failed to create admin session',
        });
        return;
      }

      res.json({
        success: true,
        steamId: testSteamId,
      });
    });
  } catch (err) {
    const error = err as Error;
    log.error('Error in /api/test/login-admin', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create admin session',
      details: error.message,
    });
  }
});

export default router;


