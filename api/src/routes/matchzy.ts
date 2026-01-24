import { Router, Request, Response } from 'express';
import { getLatestMatchZyVersion } from '../services/matchzyVersionService';

const router = Router();

/**
 * GET /api/matchzy/latest-version
 * Get the latest MatchZy Enhanced version from GitHub (cached)
 */
router.get('/latest-version', async (_req: Request, res: Response) => {
  try {
    const versionInfo = await getLatestMatchZyVersion();
    
    if (!versionInfo) {
      return res.status(200).json({
        success: false,
        message: 'Could not fetch latest version (GitHub API may be unavailable)',
      });
    }

    return res.status(200).json({
      success: true,
      version: versionInfo.version,
      releaseUrl: versionInfo.releaseUrl,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch MatchZy version',
    });
  }
});

export default router;
