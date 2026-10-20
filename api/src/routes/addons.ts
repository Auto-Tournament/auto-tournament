import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getAddon, isAddonRunning, listAddons, setAddonEnabled } from '../addons';
import { log } from '../utils/logger';
import type { Untrusted } from '../utils/untrusted';

/**
 * Add-on modules (addons/types.ts): list them, turn them on and off, and each
 * one's own API under /api/addons/<id>/.
 */
const router = Router();

/**
 * @openapi
 * /api/addons:
 *   get:
 *     tags: [Add-ons]
 *     summary: The add-on modules, and whether each is on and running
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: "`addons`: { id, name, description, enabled, running, error }[]" }
 */
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, addons: await listAddons() });
  } catch (error) {
    log.error('Listing add-ons failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not list the add-ons' });
  }
});

/**
 * @openapi
 * /api/addons/{id}:
 *   put:
 *     tags: [Add-ons]
 *     summary: Turn an add-on on or off (takes effect at once)
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [enabled], properties: { enabled: { type: boolean } } }
 *     responses:
 *       200: { description: "`addon`: the add-on after the change" }
 *       400: { description: enabled is not a boolean }
 *       404: { description: No such add-on }
 */
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const enabled = (req.body as Record<string, Untrusted> | undefined)?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'enabled must be true or false' });
  }
  try {
    const addon = await setAddonEnabled(String(req.params.id), enabled);
    if (!addon) return res.status(404).json({ success: false, error: 'No such add-on' });
    return res.json({ success: true, addon });
  } catch (error) {
    log.error('Turning an add-on on or off failed', error as Error);
    return res.status(500).json({ success: false, error: 'Could not change the add-on' });
  }
});

// An add-on's own API: only while it runs.
router.use('/:id', (req: Request, res: Response, next: NextFunction) => {
  const addon = getAddon(String(req.params.id));
  if (!addon?.router || !isAddonRunning(addon.id)) {
    return res.status(404).json({ success: false, error: 'That add-on is off' });
  }
  return addon.router(req, res, next);
});

export default router;
