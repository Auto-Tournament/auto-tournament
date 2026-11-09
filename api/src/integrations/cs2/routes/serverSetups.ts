/**
 * Saved setups (serverSetups.ts), admin only (`requireAuth`):
 *
 *   GET    /api/game/cs2/setups                           the saved setups
 *   PUT    /api/game/cs2/setups { name, plugins, maps }   save one (same name replaces it)
 *   DELETE /api/game/cs2/setups/:id                       remove one
 *   POST   /api/game/cs2/setups/:id/start { serverId? }   start it on a free server
 *   POST   /api/game/cs2/setups/running/:serverId/stop    stop the setup on that server
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requestActorId } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import type { Untrusted } from '../../../utils/untrusted';
import { issuedBy } from '../fleet/push/routes';
import { listSetupRuns } from '../fleet/setupRuns';
import { startSetup, stopSetup } from '../serverSetupRuns';
import { deleteSetup, listSetups, MAX_SETUPS, saveSetup, setupOf } from '../serverSetups';

const router = Router();

/**
 * @openapi
 * /api/game/cs2/setups:
 *   get:
 *     tags: [Fleet]
 *     summary: The saved setups (practice and fun servers to start on any free server)
 *     responses:
 *       200: { description: "{ success, setups: [{ id, name, plugins: { preset, plugins }, maps, updatedAt }], running: [{ setupId, serverId, startedAt, startedBy }] }" }
 *   put:
 *     tags: [Fleet]
 *     summary: Save a setup (the same name replaces it)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, plugins, maps]
 *             properties:
 *               name: { type: string, maxLength: 40 }
 *               plugins: { type: object, description: "{ preset } or { preset: 'custom', plugins: [name] } (Ready Up plugin set)" }
 *               maps: { type: array, items: { type: string }, maxItems: 64, description: "Map names, Workshop ids or links; the first loads on start" }
 *     responses:
 *       200: { description: "{ success, setup }" }
 *       400: { description: A bad name, plugin or map }
 *       409: { description: The list is full }
 */
router.get('/setups', requireAuth, async (_req: Request, res: Response) => {
  try {
    const running = (await listSetupRuns()).map((r) => ({
      setupId: r.setupId,
      serverId: r.cs2ServerId,
      startedAt: r.startedAt,
      startedBy: r.startedBy,
    }));
    res.json({ success: true, setups: await listSetups(), running });
  } catch (error) {
    log.error('[SETUPS] list failed', { error: String(error) });
    res.status(500).json({ success: false, error: 'Failed to load the setups' });
  }
});

router.put('/setups', requireAuth, async (req: Request, res: Response) => {
  const { setup, error } = setupOf(req.body);
  if (!setup) return res.status(400).json({ success: false, error });
  try {
    const saved = await saveSetup(setup);
    if (!saved)
      return res.status(409).json({ success: false, error: `At most ${MAX_SETUPS} setups` });
    log.info(`[SETUPS] saved "${saved.name}"`);
    return res.json({ success: true, setup: saved });
  } catch (err) {
    log.error('[SETUPS] save failed', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to save the setup' });
  }
});

/**
 * @openapi
 * /api/game/cs2/setups/{id}:
 *   delete:
 *     tags: [Fleet]
 *     summary: Remove a saved setup
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Removed }
 *       404: { description: No such setup }
 */
router.delete('/setups/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!(await deleteSetup(String(req.params.id))))
      return res.status(404).json({ success: false, error: 'No such setup' });
    return res.json({ success: true });
  } catch (error) {
    log.error('[SETUPS] delete failed', { error: String(error) });
    return res.status(500).json({ success: false, error: 'Failed to remove the setup' });
  }
});

/**
 * @openapi
 * /api/game/cs2/setups/{id}/start:
 *   post:
 *     tags: [Fleet]
 *     summary: Start a saved setup on a free server
 *     description: >-
 *       Takes a free Ready Up server (one a match could get), gives it the setup's plugins and
 *       map pool and loads the first map. No match goes to it until the setup is stopped.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               serverId: { type: string, description: "That server, if it is free" }
 *     responses:
 *       200: { description: "{ success, serverId, serverName }" }
 *       404: { description: No such setup }
 *       409: { description: No free server, or the setup is already running }
 *       502: { description: The server did not take it }
 */
router.post('/setups/:id/start', requireAuth, async (req: Request, res: Response) => {
  const wanted = (req.body as { serverId?: Untrusted } | undefined)?.serverId;
  try {
    const out = await startSetup(
      String(req.params.id),
      { actorId: requestActorId(req), issuedBy: await issuedBy(req) },
      typeof wanted === 'string' && wanted ? wanted : undefined
    );
    if (!out.ok) return res.status(out.status).json({ success: false, error: out.error });
    return res.json({ success: true, serverId: out.cs2ServerId, serverName: out.serverName });
  } catch (error) {
    log.error('[SETUPS] start failed', { error: String(error) });
    return res.status(500).json({ success: false, error: 'Failed to start the setup' });
  }
});

/**
 * @openapi
 * /api/game/cs2/setups/running/{serverId}/stop:
 *   post:
 *     tags: [Fleet]
 *     summary: Stop the saved setup on a server
 *     description: The server gets its own plugins and map vote back, and goes back to tournaments.
 *     parameters:
 *       - { in: path, name: serverId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Stopped }
 *       404: { description: No setup runs on it }
 */
router.post('/setups/running/:serverId/stop', requireAuth, async (req: Request, res: Response) => {
  try {
    const out = await stopSetup(String(req.params.serverId), {
      actorId: requestActorId(req),
      issuedBy: await issuedBy(req),
    });
    if (!out.ok) return res.status(out.status).json({ success: false, error: out.error });
    return res.json({ success: true });
  } catch (error) {
    log.error('[SETUPS] stop failed', { error: String(error) });
    return res.status(500).json({ success: false, error: 'Failed to stop the setup' });
  }
});

export default router;
