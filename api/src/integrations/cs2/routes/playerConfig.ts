/**
 * A player's CS2 config on their profile (the Config tab; ../playerConfig.ts).
 *
 * - GET /api/game/cs2/players/:playerId/config: what Ready Up read from their game and the gear
 *   they typed in. Public, unless the player turned it off: then only they (and admins) see it.
 * - GET /api/game/cs2/players/:playerId/config/autoexec.cfg: the same as one autoexec.cfg.
 * - PUT /api/game/cs2/players/me/config: the signed-in player's own switch (`show`) and gear.
 */

import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import type { Untrusted } from '../../../utils/untrusted';
import { resolveViewerAccount } from '../../../utils/viewerIdentity';
import { autoexec, cleanGear, playerConfigService } from '../playerConfig';

const router = Router();

/** The config, or null when this viewer may not see it (the player turned it off). */
async function visibleConfig(req: Request, playerId: string) {
  const config = await playerConfigService.get(playerId);
  const viewer = await resolveViewerAccount(req);
  const own = viewer.playerId === playerId;
  if (!config.show && !own && !viewer.isAdmin) return { own, config: null };
  return { own, config };
}

router.get('/players/:playerId/config', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const { own, config } = await visibleConfig(req, playerId);
    if (!config) return res.json({ success: true, own, hidden: true });
    return res.json({ success: true, own, hidden: false, ...config });
  } catch (error) {
    log.error('[CONFIG] read failed', { error, playerId: req.params.playerId });
    return res.status(500).json({ success: false, error: 'Could not read the config' });
  }
});

router.get('/players/:playerId/config/autoexec.cfg', async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const { config } = await visibleConfig(req, playerId);
    if (!config || (!config.crosshairCode && Object.keys(config.cvars).length === 0)) {
      return res.status(404).json({ success: false, error: 'No config to download' });
    }
    const player = await db.queryOneAsync<{ name: string }>(
      'SELECT name FROM players WHERE id = ?',
      [playerId]
    );
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="autoexec.cfg"');
    return res.send(autoexec(player?.name ?? playerId, config.cvars, config.crosshairCode));
  } catch (error) {
    log.error('[CONFIG] autoexec failed', { error, playerId: req.params.playerId });
    return res.status(500).json({ success: false, error: 'Could not build the config' });
  }
});

router.put('/players/me/config', async (req: Request, res: Response) => {
  try {
    const viewer = await resolveViewerAccount(req);
    if (!viewer.playerId) return res.status(401).json({ success: false, error: 'Sign in first' });
    if (viewer.isImpersonating) {
      return res
        .status(403)
        .json({ success: false, error: 'Stop impersonating to change the config.' });
    }
    const body: Untrusted = req.body;
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, Untrusted>;
    if (typeof b.show === 'boolean') await playerConfigService.setShow(viewer.playerId, b.show);
    if (b.gear !== undefined) await playerConfigService.setGear(viewer.playerId, cleanGear(b.gear));
    return res.json({
      success: true,
      own: true,
      hidden: false,
      ...(await playerConfigService.get(viewer.playerId)),
    });
  } catch (error) {
    log.error('[CONFIG] save failed', { error });
    return res.status(500).json({ success: false, error: 'Could not save the config' });
  }
});

export default router;
