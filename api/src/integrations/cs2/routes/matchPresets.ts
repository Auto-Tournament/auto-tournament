/**
 * Match setting presets (matchPresets.ts), admin only (`requireAuth`):
 *
 *   GET    /api/game/cs2/match-presets          the saved presets
 *   PUT    /api/game/cs2/match-presets { name, settings }   save one (same name replaces it)
 *   DELETE /api/game/cs2/match-presets/:id      remove one
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import type { Untrusted } from '../../../utils/untrusted';
import {
  deletePreset,
  listPresets,
  MAX_PRESETS,
  presetIdOf,
  presetSettingsOf,
  savePreset,
} from '../matchPresets';

const router = Router();

/**
 * @openapi
 * /api/game/cs2/match-presets:
 *   get:
 *     tags: [Tournaments]
 *     summary: The match setting presets saved on this site
 *     responses:
 *       200: { description: "{ success, presets: [{ id, name, settings, updatedAt }] }" }
 *   put:
 *     tags: [Tournaments]
 *     summary: Save a match setting preset (the same name replaces it)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, settings]
 *             properties:
 *               name: { type: string, maxLength: 40 }
 *               settings: { type: object, description: "Match settings only (settings.cs2 fields)" }
 *     responses:
 *       200: { description: "{ success, preset }" }
 *       400: { description: A bad name or setting }
 *       409: { description: The list is full }
 */
router.get('/match-presets', requireAuth, async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, presets: await listPresets() });
  } catch (error) {
    log.error('[PRESETS] list failed', { error: String(error) });
    res.status(500).json({ success: false, error: 'Failed to load presets' });
  }
});

router.put('/match-presets', requireAuth, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { name?: Untrusted; settings?: Untrusted };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 40 || !presetIdOf(name))
    return res.status(400).json({ success: false, error: 'A name of 1 to 40 letters or digits' });
  const { settings, error } = presetSettingsOf(body.settings);
  if (error) return res.status(400).json({ success: false, error });
  try {
    const preset = await savePreset(name, settings);
    if (!preset)
      return res.status(409).json({ success: false, error: `At most ${MAX_PRESETS} presets` });
    log.info(`[PRESETS] saved "${name}"`);
    return res.json({ success: true, preset });
  } catch (err) {
    log.error('[PRESETS] save failed', { error: String(err) });
    return res.status(500).json({ success: false, error: 'Failed to save the preset' });
  }
});

/**
 * @openapi
 * /api/game/cs2/match-presets/{id}:
 *   delete:
 *     tags: [Tournaments]
 *     summary: Remove a match setting preset
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Removed }
 *       404: { description: No such preset }
 */
router.delete('/match-presets/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!(await deletePreset(String(req.params.id))))
      return res.status(404).json({ success: false, error: 'No such preset' });
    return res.json({ success: true });
  } catch (error) {
    log.error('[PRESETS] delete failed', { error: String(error) });
    return res.status(500).json({ success: false, error: 'Failed to remove the preset' });
  }
});

export default router;
