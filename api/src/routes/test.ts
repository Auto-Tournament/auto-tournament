import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';

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

  // Sanitize message: keep letters, numbers, basic punctuation and whitespace.
  const trimmed = message.trim().slice(0, 300); // limit length
  const sanitized = trimmed.replace(/[^\w\s\-.,:/#@()\[\]]/g, '');

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

export default router;


