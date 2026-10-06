/**
 * Virtual skins: a player's inventory and loadout, other players' showcases,
 * and the admin settings. Every player route answers 404 while skins are off.
 *
 * GET    /status                   public: on or off
 * GET    /me                       signed in: your inventory, showcase and new skins
 * POST   /me/equip                 equip a skin ({ skinId })
 * DELETE /me/equip/:slot           empty a slot
 * POST   /me/seen                  the "new skin" reveal was shown ({ ids })
 * PUT    /me/showcase              the profile showcase ({ items: [{ skinId, big }] })
 * GET    /players/:steamId         public: a player's skins
 * GET    /skin/:id                 public: one skin and its owner
 * GET    /admin/config, PUT        admin: the settings
 * GET    /admin/catalog?q=         admin: search the catalogue (for picking a reward)
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { log } from '../utils/logger';
import { resolveViewerAccount } from '../utils/viewerIdentity';
import { SkinError, skinService, type SkinsConfig } from '../services/skinService';

const router = Router();

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof SkinError) return res.status(error.status).json({ success: false, error: error.message });
  log.error(`[Skins] ${what} failed`, { error });
  return res.status(500).json({ success: false, error: `${what} failed` });
}

/** The signed-in player's account, while skins are on; otherwise the answer is already sent. */
async function playerOrStop(req: Request, res: Response): Promise<string | null> {
  if (!(await skinService.config()).enabled) {
    res.status(404).json({ success: false, error: 'Skins are off' });
    return null;
  }
  const viewer = await resolveViewerAccount(req);
  if (!viewer.uid) {
    res.status(401).json({ success: false, error: 'Sign in first' });
    return null;
  }
  if (viewer.isImpersonating) {
    res.status(403).json({ success: false, error: 'Stop impersonating to change a loadout.' });
    return null;
  }
  return viewer.uid;
}

/**
 * @openapi
 * /api/skins/status:
 *   get:
 *     tags: [Skins]
 *     summary: Whether virtual skins are on (public)
 *     responses:
 *       200: { description: "{ enabled }" }
 */
router.get('/status', async (_req, res) => {
  try {
    return res.json({ success: true, enabled: (await skinService.config()).enabled });
  } catch (error) {
    return fail(res, error, 'Reading the skins status');
  }
});

/**
 * @openapi
 * /api/skins/me:
 *   get:
 *     tags: [Skins]
 *     summary: Your inventory, showcase, and skins you have not seen yet
 *     responses:
 *       200: { description: The inventory }
 *       401: { description: Not signed in }
 *       404: { description: Skins are off }
 */
router.get('/me', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    const inventory = await skinService.inventory(uid);
    return res.json({
      success: true,
      inventory,
      showcase: await skinService.showcase(uid),
      unseen: inventory.filter((s) => !s.seen).map((s) => s.id),
    });
  } catch (error) {
    return fail(res, error, 'Reading the inventory');
  }
});

/**
 * @openapi
 * /api/skins/me/equip:
 *   post:
 *     tags: [Skins]
 *     summary: Equip a skin in its slot
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { skinId: { type: integer } } }
 *     responses:
 *       200: { description: Equipped }
 *       404: { description: Not in your inventory, or skins are off }
 */
router.post('/me/equip', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    await skinService.equip(uid, Number(req.body?.skinId));
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Equipping');
  }
});

/**
 * @openapi
 * /api/skins/me/equip/{slot}:
 *   delete:
 *     tags: [Skins]
 *     summary: Empty a loadout slot
 *     parameters:
 *       - { in: path, name: slot, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Emptied }
 */
router.delete('/me/equip/:slot', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    await skinService.unequip(uid, req.params.slot);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Unequipping');
  }
});

/**
 * @openapi
 * /api/skins/me/seen:
 *   post:
 *     tags: [Skins]
 *     summary: Mark new skins as seen
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { ids: { type: array, items: { type: integer } } } }
 *     responses:
 *       200: { description: Marked }
 */
router.post('/me/seen', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    await skinService.markSeen(uid, ids);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Marking skins seen');
  }
});

/**
 * @openapi
 * /api/skins/me/showcase:
 *   put:
 *     tags: [Skins]
 *     summary: Arrange the profile showcase (up to 8 skins, some big)
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               items:
 *                 type: array
 *                 items: { type: object, properties: { skinId: { type: integer }, big: { type: boolean } } }
 *     responses:
 *       200: { description: Saved }
 */
router.put('/me/showcase', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    await skinService.setShowcase(uid, Array.isArray(req.body?.items) ? req.body.items : []);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Saving the showcase');
  }
});

/**
 * @openapi
 * /api/skins/players/{steamId}:
 *   get:
 *     tags: [Skins]
 *     summary: A player's skins (public)
 *     parameters:
 *       - { in: path, name: steamId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Inventory and showcase }
 *       404: { description: Skins are off, or no such player }
 */
router.get('/players/:steamId', async (req, res) => {
  try {
    if (!(await skinService.config()).enabled) return res.status(404).json({ success: false, error: 'Skins are off' });
    const profile = await skinService.publicProfile(req.params.steamId);
    if (!profile) return res.status(404).json({ success: false, error: 'No such player' });
    return res.json({ success: true, ...profile });
  } catch (error) {
    return fail(res, error, "Reading a player's skins");
  }
});

/**
 * @openapi
 * /api/skins/skin/{id}:
 *   get:
 *     tags: [Skins]
 *     summary: One skin and its owner (public)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: The skin }
 *       404: { description: No such skin, or skins are off }
 */
router.get('/skin/:id', async (req, res) => {
  try {
    if (!(await skinService.config()).enabled) return res.status(404).json({ success: false, error: 'Skins are off' });
    return res.json({ success: true, ...(await skinService.one(Number(req.params.id))) });
  } catch (error) {
    return fail(res, error, 'Reading a skin');
  }
});

/**
 * @openapi
 * /api/skins/admin/config:
 *   get:
 *     tags: [Skins]
 *     summary: The skins settings (admin)
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: The settings }
 *   put:
 *     tags: [Skins]
 *     summary: Change the skins settings (admin)
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200: { description: The saved settings }
 */
router.get('/admin/config', requireAuth, async (_req, res) => {
  try {
    return res.json({ success: true, config: await skinService.config() });
  } catch (error) {
    return fail(res, error, 'Reading the skins settings');
  }
});
router.put('/admin/config', requireAuth, async (req, res) => {
  try {
    const config = await skinService.setConfig((req.body ?? {}) as Partial<SkinsConfig>);
    return res.json({ success: true, config });
  } catch (error) {
    return fail(res, error, 'Saving the skins settings');
  }
});

/**
 * @openapi
 * /api/skins/admin/catalog:
 *   get:
 *     tags: [Skins]
 *     summary: Search the skin catalogue (admin)
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string } }
 *     responses:
 *       200: { description: Up to 50 matching skins, one per weapon and name }
 */
router.get('/admin/catalog', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const seen = new Set<string>();
    const skins = (await skinService.catalog())
      .filter((s) => !q || `${s.weaponName} ${s.name}`.toLowerCase().includes(q))
      .filter((s) => {
        const key = `${s.weapon}|${s.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 50);
    return res.json({ success: true, skins });
  } catch (error) {
    return fail(res, error, 'Searching the catalogue');
  }
});

export default router;
