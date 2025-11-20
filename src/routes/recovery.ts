/**
 * Recovery routes - for testing and manual recovery
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { recoverActiveMatches, replayRecentEvents } from '../services/matchRecoveryService';
import { log } from '../utils/logger';

const router = Router();

/**
 * POST /api/recovery/recover
 * Manually trigger recovery of all active matches
 * Protected by API token
 */
router.post('/recover', requireAuth, async (_req: Request, res: Response) => {
  try {
    log.info('[Recovery] Manual recovery triggered via API');
    const results = await recoverActiveMatches();

    const summary = {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      details: results,
    };

    return res.json({
      success: true,
      message: `Recovery completed: ${summary.successful}/${summary.total} matches recovered`,
      summary,
    });
  } catch (error) {
    log.error('[Recovery] Manual recovery failed', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to recover matches',
    });
  }
});

/**
 * POST /api/recovery/replay/:matchSlug
 * Replay recent events for a specific match
 * Protected by API token
 */
router.post('/replay/:matchSlug', requireAuth, async (req: Request, res: Response) => {
  try {
    const { matchSlug } = req.params;
    const sinceTimestamp = req.body.sinceTimestamp
      ? parseInt(req.body.sinceTimestamp, 10)
      : undefined;

    log.info('[Recovery] Manual event replay triggered', { matchSlug, sinceTimestamp });
    await replayRecentEvents(matchSlug, sinceTimestamp);

    return res.json({
      success: true,
      message: `Event replay completed for ${matchSlug}`,
    });
  } catch (error) {
    log.error('[Recovery] Manual event replay failed', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to replay events',
    });
  }
});

export default router;

