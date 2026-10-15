/**
 * CS2 test helpers, mounted at /api/test next to the core ones.
 *
 * Only for E2E runs: disabled in production unless ENABLE_TEST_ENDPOINTS is set,
 * the same switch as the core test helpers.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { db } from '../../../config/database';
import { resetEnrollRateLimit } from '../fleet/routes';
import { liveStateStore } from '../fleet/state';
import { processInbound } from '../fleet/inbound';
import { assignConfigPreview } from '../fleet/driver';
import type { Envelope } from '../fleet/protocol/v1';
import { FleetSendError, getCommand, sendReliable, type ReliableType } from '../fleet/reliable';
import { scanForFailovers } from '../fleet/failover';

const router = Router();

function isE2eTestHelperEnabled(): boolean {
  const enabled = (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase();
  return enabled === '1' || enabled === 'true' || enabled === 'yes';
}

/**
 * Test-only helper: set clips' status (a recorder that failed them).
 *
 * POST /api/test/highlights/status  { ids: number[], status }
 */
router.post(
  '/highlights/status',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
      res.status(403).json({ success: false, error: 'Disabled in production' });
      return;
    }
    const { ids, status } = (req.body || {}) as { ids?: unknown; status?: unknown };
    const list = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger) : [];
    if (list.length === 0 || typeof status !== 'string') {
      res.status(400).json({ success: false, error: 'ids and status are required' });
      return;
    }
    await db.runAsync(
      `UPDATE cs2_highlights SET status = ? WHERE id IN (${list.map(() => '?').join(', ')})`,
      [status, ...list]
    );
    res.json({ success: true });
  }
);

/**
 * Test-only fleet helpers (the Ready Up fleet link, api/src/integrations/cs2/fleet).
 *
 * POST /api/test/fleet/reset-enroll-rate-limit   forget the 10/min/IP enrollment counts
 * POST /api/test/fleet/age-token { serverId, days }   backdate a server's live tokens,
 *   so the next connect (or the hourly job) rotates them
 * POST /api/test/fleet/expire-key { keyId }   make a fleet key's expiry pass
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

router.post(
  '/fleet/expire-key',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (process.env.NODE_ENV === 'production' && !isE2eTestHelperEnabled()) {
      res.status(403).json({ success: false, error: 'Disabled in production' });
      return;
    }
    const { keyId } = (req.body || {}) as { keyId?: string };
    if (!keyId) {
      res.status(400).json({ success: false, error: 'keyId is required' });
      return;
    }
    const result = await db.runAsync(
      'UPDATE cs2_fleet_enrollment_keys SET expires_at = ? WHERE id = ?',
      [Math.floor(Date.now() / 1000) - 1, keyId]
    );
    res.json({ success: true, keys: result.changes });
  }
);

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

/**
 * POST /api/test/highlights/repick { matchSlug, mapNumber, clips, source }
 *
 * Seeds a map's clips (`clips`: { playerId, round, startTick, status,
 * demoPath }) and runs `saveMoments` with no new moments from `source`
 * (the newer demo), as a finished analysis does. Answers each seeded clip's
 * status afterwards, by start tick.
 */
router.post(
  '/highlights/repick',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (!fleetTestGuard(res)) return;
    const { matchSlug, mapNumber, clips, source } = (req.body || {}) as {
      matchSlug?: string;
      mapNumber?: number;
      clips?: Array<{
        playerId: string;
        round: number;
        startTick: number;
        status: string;
        demoPath: string | null;
      }>;
      source?: { demoPath: string; firstRound: number };
    };
    if (!matchSlug || typeof mapNumber !== 'number' || !Array.isArray(clips)) {
      res
        .status(400)
        .json({ success: false, error: 'matchSlug, mapNumber and clips are required' });
      return;
    }
    for (const c of clips) {
      await db.runAsync(
        `INSERT INTO cs2_highlights (match_slug, map_number, player_id, kind, score, round, start_tick, end_tick,
                                   slowmo_tick, kill_ticks, title, status, demo_path)
       VALUES (?, ?, ?, '3k', 300, ?, ?, ?, ?, '[]', 'spec clip', ?, ?)`,
        [
          matchSlug,
          mapNumber,
          c.playerId,
          c.round,
          c.startTick,
          c.startTick + 640,
          c.startTick + 320,
          c.status,
          c.demoPath,
        ]
      );
    }
    const { saveMoments } = await import('../demos/highlights');
    await saveMoments(matchSlug, mapNumber, [], source);
    const rows = await db.queryAsync<{ start_tick: number; status: string }>(
      'SELECT start_tick, status FROM cs2_highlights WHERE match_slug = ? AND map_number = ?',
      [matchSlug, mapNumber]
    );
    res.json({
      success: true,
      statuses: Object.fromEntries(rows.map((r) => [String(r.start_tick), r.status])),
    });
  }
);

/**
 * POST /api/test/fleet/snapshot { serverId?, state }
 *
 * A Ready Up `state.snapshot` of a match (`state.match_id`), applied as a
 * connected server's would be: the match then has a live record the admin
 * match page reads. `serverId` defaults to `test-ready-up`.
 */
router.post('/fleet/snapshot', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fleetTestGuard(res)) return;
  const { serverId, state } = (req.body || {}) as {
    serverId?: string;
    state?: Record<string, unknown>;
  };
  if (!state || typeof state.match_id !== 'string') {
    res.status(400).json({ success: false, error: 'state with match_id is required' });
    return;
  }
  try {
    const outcome = await liveStateStore.applySnapshot(serverId || 'test-ready-up', {
      reason: 'request',
      state,
    } as unknown as Parameters<typeof liveStateStore.applySnapshot>[1]);
    res.json({ success: true, outcome });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/test/fleet/stattrak  { increments }: a skins.stattrak report, as from a server. */
router.post('/fleet/stattrak', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fleetTestGuard(res)) return;
  const { skinService } = await import('../skins/skinService');
  const increments = Array.isArray(req.body?.increments) ? req.body.increments : [];
  res.json({ success: true, counted: await skinService.addStatTrakKills(increments) });
});

/** POST /api/test/fleet/movement-record  { ...movement.record payload }: a finished run, as from a server. */
router.post(
  '/fleet/movement-record',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (!fleetTestGuard(res)) return;
    const { validatePayload } = await import('../fleet/protocol/v1');
    const check = validatePayload('movement.record', req.body ?? {});
    if (!check.ok) {
      res.status(400).json({ success: false, errors: check.errors });
      return;
    }
    const { addMovementRun } = await import('../movement/records');
    await addMovementRun('test-ready-up', req.body);
    res.json({ success: true });
  }
);

/**
 * POST /api/test/fleet/events { matchSlug, serverId?, events: [{ type, map_number?, round?, data, patch? }] }
 *
 * Ready Up's `event.*` messages for a match, applied through the same
 * `processInbound` a connected server's messages take (state store, ingest,
 * map stats, the driver's hooks), without a socket. `serverId` is the fleet
 * server they come from (the match's server, else `test-ready-up`). Each
 * event gets the next rev for the match.
 */
const testRevs = new Map<string, number>();
router.post('/fleet/events', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!fleetTestGuard(res)) return;
  const { matchSlug, serverId, events } = (req.body || {}) as {
    matchSlug?: string;
    serverId?: string;
    events?: Array<{
      type: string;
      map_number?: number;
      round?: number;
      data?: Record<string, unknown>;
      patch?: Record<string, unknown>;
    }>;
  };
  if (!matchSlug || !Array.isArray(events) || events.length === 0) {
    res.status(400).json({ success: false, error: 'matchSlug and events are required' });
    return;
  }
  const match = await db.queryOneAsync<{ server_id: string | null }>(
    'SELECT server_id FROM matches WHERE slug = ?',
    [matchSlug]
  );
  // A call for help can come from a server with no match (`admin_called`).
  if (!match && !serverId) {
    res.status(404).json({ success: false, error: 'Match not found' });
    return;
  }
  const from = serverId ?? match?.server_id ?? 'test-ready-up';
  const record = await liveStateStore.getLiveState(matchSlug);
  const ctx = { serverId: from, streamId: 'test', sendEphemeral: () => false };
  // In order after the stored record (a real server's revs, or 0 for a record
  // a new match with this slug starts from), else after the last test batch.
  let rev = record ? record.liveRev : (testRevs.get(matchSlug) ?? 0);
  for (const event of events) {
    const type = event.type.startsWith('event.') ? event.type : `event.${event.type}`;
    rev += 1;
    testRevs.set(matchSlug, rev);
    const env = {
      v: 1,
      type,
      id: `test-${matchSlug}-${rev}-${Date.now()}`,
      ts: Date.now(),
      ...(record?.epoch !== undefined ? { epoch: record.epoch } : {}),
      payload: {
        match_id: matchSlug,
        map_number: event.map_number ?? 1,
        round: event.round ?? 0,
        rev,
        patch: { ...(event.patch ?? {}), live_rev: rev },
        data: event.data ?? {},
      },
    } as unknown as Envelope;
    await processInbound(ctx, env, null);
  }
  res.json({ success: true, applied: events.length });
});

/** GET /api/test/fleet/assign-config/:slug  the `match.assign` config the match would get now. */
router.get(
  '/fleet/assign-config/:slug',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (!fleetTestGuard(res)) return;
    const preview = await assignConfigPreview(req.params.slug);
    if (!preview) {
      res.status(404).json({ success: false, error: 'Match not found' });
      return;
    }
    res.json({ success: true, ...preview });
  }
);

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

router.get(
  '/fleet/live-state/:slug',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (!fleetTestGuard(res)) return;
    const record = await liveStateStore.getLiveState(String(req.params.slug));
    if (!record) {
      res.status(404).json({ success: false, error: 'No live state' });
      return;
    }
    res.json({ success: true, record });
  }
);

router.get(
  '/fleet/events/:serverId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (!fleetTestGuard(res)) return;
    const rows = await db.queryAsync(
      `SELECT id, stream_id, seq, message_id, type, match_slug, epoch, rev, ref, processed_at, error
       FROM cs2_fleet_events WHERE server_id = ? ORDER BY id ASC`,
      [String(req.params.serverId)]
    );
    res.json({ success: true, events: rows });
  }
);

router.post(
  '/fleet/failover/scan',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (!fleetTestGuard(res)) return;
    const { liveSeconds, preLiveSeconds } = (req.body || {}) as {
      liveSeconds?: number;
      preLiveSeconds?: number;
    };
    const result = await scanForFailovers({
      grace: {
        liveSeconds: typeof liveSeconds === 'number' ? liveSeconds : 0,
        preLiveSeconds: typeof preLiveSeconds === 'number' ? preLiveSeconds : 0,
      },
    });
    res.json({ success: true, ...result });
  }
);

router.get(
  '/fleet/commands/:id',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (!fleetTestGuard(res)) return;
    const command = await getCommand(String(req.params.id));
    if (!command) {
      res.status(404).json({ success: false, error: 'No such command' });
      return;
    }
    res.json({ success: true, command });
  }
);

export default router;
