import { Router, Request, Response } from 'express';
import { getLatestPluginVersion, getLatestReadyUpRelease } from '../services/pluginVersionService';

const router = Router();

/**
 * GET /api/cs2-plugin/latest-version
 * Get the latest MatchZy Enhanced version from GitHub (cached)
 */
router.get('/latest-version', async (_req: Request, res: Response) => {
  try {
    const [versionInfo, readyUp] = await Promise.all([
      getLatestPluginVersion(),
      getLatestReadyUpRelease(),
    ]);
    // Ready Up may have no release yet: `readyUp` is null then, and clients must
    // show "no update check yet" instead of a warning.
    const readyUpBody = readyUp ? { version: readyUp.version, releaseUrl: readyUp.releaseUrl } : null;

    if (!versionInfo) {
      return res.status(200).json({
        success: false,
        readyUp: readyUpBody,
        message: 'Could not fetch latest version (GitHub API may be unavailable)',
      });
    }

    return res.status(200).json({
      success: true,
      version: versionInfo.version,
      releaseUrl: versionInfo.releaseUrl,
      readyUp: readyUpBody,
    });
  } catch {
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch MatchZy Enhanced version',
    });
  }
});

export default router;
