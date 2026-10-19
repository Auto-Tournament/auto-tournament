import type { Request, Response } from 'express';
import { Router } from 'express';
import { getLatestReadyUpRelease } from '../services/pluginVersionService';

const router = Router();

/**
 * GET /api/cs2-plugin/latest-version
 * The latest Ready Up release from GitHub (cached). Ready Up may have no
 * release yet: `readyUp` is null then, and clients show "no update check yet".
 */
router.get('/latest-version', async (_req: Request, res: Response) => {
  try {
    const readyUp = await getLatestReadyUpRelease();
    return res.status(200).json({
      success: true,
      readyUp: readyUp ? { version: readyUp.version, releaseUrl: readyUp.releaseUrl } : null,
    });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to fetch the Ready Up version' });
  }
});

export default router;
