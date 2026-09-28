/**
 * Round backups and "restore to round N" for one CS2 match, for the match
 * admin panel. Admin only (`requireAuth`); every restore is audited
 * (`cs2_match_round_restores`, ../fleet/restore.ts).
 *
 *   GET  /api/game/cs2/matches/:slug/round-backups
 *        How restores reach this match (`transport`: 'fleet' | 'rcon' | null),
 *        the stored backups (fleet: from `event.backup`, without the file) and
 *        the recent restores.
 *   POST /api/game/cs2/matches/:slug/round-backups/restore { mapNumber?, round }
 *        Fleet: `cmd restore_round` with the stored backup inline, to the
 *        server holding the match's epoch; waits for its `cmd.result`.
 *        `mapNumber` is the fleet's (1-based; default: the current map).
 *        RCON: `css_restore <round>` on the match's server (the plugin's own
 *        backups), as POST /api/rcon/restore-backup does.
 *        200 ok; 202 sent, no answer yet; 409 not assigned; 404 no such
 *        backup; 422 the server refused it or the file cannot go inline;
 *        502 the RCON command failed.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth, requestActorId } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { roundBackupStore } from '../fleet/backups';
import {
  RestoreError,
  defaultRestoreDeps,
  restoreAudit,
  restoreRoundBackup,
  restoreTransportFor,
} from '../fleet/restore';

const router = Router();

const SLUG_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function actorName(req: Request, actorId: string | null): string {
  const user = (req as Request & { user?: { displayName?: string; name?: string } }).user;
  return user?.displayName || user?.name || actorId || 'admin';
}

router.get('/matches/:slug/round-backups', requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return res.status(400).json({ success: false, error: 'Invalid match slug' });
  try {
    const deps = defaultRestoreDeps();
    const [target, record, backups, restores] = await Promise.all([
      restoreTransportFor(deps, slug),
      deps.getLiveState(slug),
      roundBackupStore.list(slug),
      restoreAudit.list(slug, 20),
    ]);
    const maps: Record<string, string> = {};
    for (const [n, m] of Object.entries(record?.state?.series.maps ?? {})) maps[n] = m.name;
    return res.json({
      success: true,
      matchSlug: slug,
      transport: target.transport,
      serverId: target.serverId,
      epoch: target.epoch,
      currentMap: record?.state?.series.current_map ?? null,
      maps,
      backups,
      restores,
    });
  } catch (error) {
    log.error(`[RESTORE] listing the backups of ${slug} failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to list the round backups' });
  }
});

router.post('/matches/:slug/round-backups/restore', requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params;
  if (!SLUG_RE.test(slug)) return res.status(400).json({ success: false, error: 'Invalid match slug' });
  const round = Number(req.body?.round);
  let mapNumber = req.body?.mapNumber === undefined || req.body?.mapNumber === null ? null : Number(req.body.mapNumber);
  const deps = defaultRestoreDeps();
  try {
    if (mapNumber === null) {
      const record = await deps.getLiveState(slug);
      mapNumber = record?.state?.series.current_map ?? 1;
    }
    const actorId = requestActorId(req);
    const { restore, delivered } = await restoreRoundBackup(deps, {
      matchSlug: slug,
      mapNumber,
      round,
      actor: { id: actorId, name: actorName(req, actorId) },
    });
    const status =
      restore.status === 'ok'
        ? 200
        : restore.status === 'pending'
          ? 202
          : restore.transport === 'rcon'
            ? 502
            : 422;
    return res.status(status).json({
      success: restore.status === 'ok' || restore.status === 'pending',
      delivered,
      restore,
      ...(restore.status !== 'ok' && restore.status !== 'pending'
        ? { code: restore.errorCode, error: restore.errorMessage ?? restore.errorCode ?? restore.status }
        : {}),
    });
  } catch (error) {
    if (error instanceof RestoreError) {
      return res.status(error.status).json({ success: false, code: error.code, error: error.message });
    }
    log.error(`[RESTORE] restore of ${slug} failed: ${(error as Error).message}`);
    return res.status(500).json({ success: false, error: 'Failed to restore the round' });
  }
});

export default router;
