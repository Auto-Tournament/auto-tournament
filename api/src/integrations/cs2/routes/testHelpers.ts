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
import { db } from '../../../config/database';
import { resetEnrollRateLimit } from '../fleet/routes';
import { liveStateStore } from '../fleet/state';
import { FleetSendError, getCommand, sendReliable, type ReliableType } from '../fleet/reliable';
import { scanForFailovers } from '../fleet/failover';

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
 * Allocation decisions hinge on what MatchZy Enhanced reports through its
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

/**
 * Test-only fleet helpers (the Ready Up fleet link, api/src/integrations/cs2/fleet).
 *
 * POST /api/test/fleet/reset-enroll-rate-limit   forget the 10/min/IP enrollment counts
 * POST /api/test/fleet/age-token { serverId, days }   backdate a server's live tokens,
 *   so the next connect (or the hourly job) rotates them
 */
router.post('/fleet/reset-enroll-rate-limit', requireAuth, (_req: Request, res: Response): void => {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return;
  }
  resetEnrollRateLimit();
  res.json({ success: true });
});

router.post('/fleet/age-token', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return;
  }
  const { serverId, days } = (req.body || {}) as { serverId?: string; days?: number };
  if (!serverId || typeof days !== 'number' || days <= 0) {
    res.status(400).json({ success: false, error: 'serverId and a positive days are required' });
    return;
  }
  const result = await db.runAsync(
    'UPDATE cs2_fleet_tokens SET created_at = created_at - ? WHERE server_id = ? AND revoked_at IS NULL',
    [Math.floor(days * 86400), serverId]
  );
  res.json({ success: true, tokens: result.changes });
});

/**
 * Test-only fleet match helpers (step 3: fleet/state.ts, fleet/reliable.ts,
 * fleet/inbound.ts), until the fleet driver has real routes:
 *
 * POST /api/test/fleet/assign { matchSlug, serverId, configRev? }   new epoch (beginAssignment)
 * POST /api/test/fleet/send { serverId, type, payload, epoch? }     sendReliable
 * GET  /api/test/fleet/live-state/:slug                             the stored LiveMatchRecord
 * GET  /api/test/fleet/events/:serverId                             cs2_fleet_events rows (no message bodies)
 * GET  /api/test/fleet/commands/:id                                 a command and its cmd.result
 * POST /api/test/fleet/failover/scan { liveSeconds?, preLiveSeconds? }   one failover detection pass
 *   with its own grace (default 0 / 0: a server that is down now counts as down)
 */
function fleetTestGuard(res: Response): boolean {
  if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return false;
  }
  return true;
}

router.post('/fleet/assign', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fleetTestGuard(res)) return;
  const { matchSlug, serverId, configRev } = (req.body || {}) as {
    matchSlug?: string;
    serverId?: string;
    configRev?: number;
  };
  if (!matchSlug || !serverId) {
    res.status(400).json({ success: false, error: 'matchSlug and serverId are required' });
    return;
  }
  const record = await liveStateStore.beginAssignment(matchSlug, serverId, configRev ?? 1);
  res.json({ success: true, epoch: record.epoch, record });
});

router.post('/fleet/send', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fleetTestGuard(res)) return;
  const { serverId, type, payload, epoch } = (req.body || {}) as {
    serverId?: string;
    type?: ReliableType;
    payload?: Record<string, unknown>;
    epoch?: number;
  };
  if (!serverId || !type || !payload) {
    res.status(400).json({ success: false, error: 'serverId, type and payload are required' });
    return;
  }
  try {
    const sent = await sendReliable(serverId, {
      type,
      payload: payload as never,
      ...(epoch !== undefined ? { epoch } : {}),
    });
    res.json({ success: true, ...sent });
  } catch (error) {
    if (error instanceof FleetSendError) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    throw error;
  }
});

router.get('/fleet/live-state/:slug', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fleetTestGuard(res)) return;
  const record = await liveStateStore.getLiveState(String(req.params.slug));
  if (!record) {
    res.status(404).json({ success: false, error: 'No live state' });
    return;
  }
  res.json({ success: true, record });
});

router.get('/fleet/events/:serverId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fleetTestGuard(res)) return;
  const rows = await db.queryAsync(
    `SELECT id, stream_id, seq, message_id, type, match_slug, epoch, rev, ref, processed_at, error
       FROM cs2_fleet_events WHERE server_id = ? ORDER BY id ASC`,
    [String(req.params.serverId)]
  );
  res.json({ success: true, events: rows });
});

router.post('/fleet/failover/scan', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fleetTestGuard(res)) return;
  const { liveSeconds, preLiveSeconds } = (req.body || {}) as { liveSeconds?: number; preLiveSeconds?: number };
  const result = await scanForFailovers({
    grace: {
      liveSeconds: typeof liveSeconds === 'number' ? liveSeconds : 0,
      preLiveSeconds: typeof preLiveSeconds === 'number' ? preLiveSeconds : 0,
    },
  });
  res.json({ success: true, ...result });
});

router.get('/fleet/commands/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fleetTestGuard(res)) return;
  const command = await getCommand(String(req.params.id));
  if (!command) {
    res.status(404).json({ success: false, error: 'No such command' });
    return;
  }
  res.json({ success: true, command });
});

export default router;
