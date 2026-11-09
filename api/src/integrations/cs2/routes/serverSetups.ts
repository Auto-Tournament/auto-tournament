/**
 * Saved setups (serverSetups.ts), admin only (`requireAuth`):
 *
 *   GET    /api/game/cs2/setups                           the saved setups
 *   PUT    /api/game/cs2/setups { name, plugins, maps }   save one (same name replaces it)
 *   DELETE /api/game/cs2/setups/:id                       remove one
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { deleteSetup, listSetups, MAX_SETUPS, saveSetup, setupOf } from '../serverSetups';

const router = Router();

/**
 * @openapi
 * /api/game/cs2/setups:
 *   get:
 *     tags: [Fleet]
 *     summary: The saved setups (practice and fun servers to start on any free server)
 *     responses:
 *       200: { description: "{ success, setups: [{ id, name, plugins: { preset, plugins }, maps, updatedAt }] }" }
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
    res.json({ success: true, setups: await listSetups() });
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

export default router;
