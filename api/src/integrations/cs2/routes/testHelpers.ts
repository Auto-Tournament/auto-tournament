/**
 * CS2 test helpers, mounted at /api/test next to the core ones.
 *
 * Only for E2E runs: disabled in production unless ENABLE_TEST_ENDPOINTS is set,
 * the same switch as the core test helpers.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { primeServerStatusForTests, ServerStatus } from '../services/serverStatusService';

const router = Router();

function isE2eTestHelperEnabled(): boolean {
  const enabled = (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase();
  return enabled === '1' || enabled === 'true' || enabled === 'yes';
}

/**
 * Test-only helper: stand in for a CS2 server's reported status.
 *
 * POST /api/test/server-status  { serverId, status, updatedAt?, online?, matchSlug? }
 *
 * Allocation decisions hinge on what the Auto Tournament CS2 plugin reports through its
 * convars, and CI has no CS2 server to report anything — so without this the
 * idle/busy paths cannot be exercised at all.
 *
 * NOTE: This endpoint is only available in non-production environments.
 */
router.post('/server-status', requireAuth, (req: Request, res: Response): void => {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return;
  }

  const { serverId, status, updatedAt, online, matchSlug } = (req.body || {}) as {
    serverId?: string;
    status?: string;
    updatedAt?: number;
    online?: boolean;
    matchSlug?: string;
  };

  if (!serverId) {
    res.status(400).json({ success: false, error: 'serverId is required' });
    return;
  }

  const allowed = Object.values(ServerStatus) as string[];
  if (status !== undefined && status !== null && !allowed.includes(status)) {
    res.status(400).json({ success: false, error: `status must be one of: ${allowed.join(', ')}` });
    return;
  }

  primeServerStatusForTests(serverId, {
    status: (status as ServerStatus) ?? null,
    updatedAt: updatedAt ?? null,
    online: online ?? true,
    matchSlug: matchSlug ?? null,
  });

  log.warn(`[DEV-TOOLS] Primed server status for ${serverId}: ${status ?? 'null'}`);
  res.json({ success: true });
});

export default router;
