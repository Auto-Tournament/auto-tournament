import { Router, Request, Response } from 'express';
import { getLatestPluginVersion } from '../services/pluginVersionService';

const router = Router();

/**
 * GET /api/cs2-plugin/latest-version
 * Get the latest Auto Tournament CS2 version from GitHub (cached)
 */
router.get('/latest-version', async (_req: Request, res: Response) => {
  try {
    const versionInfo = await getLatestPluginVersion();
    
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
  } catch {
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch Auto Tournament CS2 version',
    });
  }
});

export default router;
