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
import { SKIN_IMAGES_BASE, SkinError, skinService, variantOf, type SkinsConfig } from '../services/skinService';

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
 *       - { in: query, name: all, schema: { type: string, enum: ['1'] }, description: Every paint kit (each Doppler phase) instead of one per name }
 *     responses:
 *       200: { description: Up to 50 matching skins }
 */
router.get('/admin/catalog', requireAuth, async (req, res) => {
  try {
    const words = String(req.query.q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    // `all=1`: every paint kit, so each phase of a Doppler is its own row.
    const all = req.query.all === '1';
    const seen = new Set<string>();
    const skins = (await skinService.catalog())
      .map((s) => ({ ...s, variant: variantOf(s.paintKitName), imageUrl: `${SKIN_IMAGES_BASE}/${s.image}` }))
      .filter((s) => {
        const text = `${s.weaponName} ${s.name} ${s.variant ?? ''}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .filter((s) => {
        const key = all ? `${s.weapon}|${s.paintKit}` : `${s.weapon}|${s.name}`;
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

/**
 * @openapi
 * /api/skins/admin/players:
 *   get:
 *     tags: [Skins]
 *     summary: Find players to manage their inventory
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: q, schema: { type: string }, description: Part of a name, or a Steam ID }
 *     responses:
 *       200: { description: Up to 30 players with their skin counts }
 */
router.get('/admin/players', requireAuth, async (req, res) => {
  try {
    const players = await skinService.adminFindPlayers(String(req.query.q ?? ''));
    return res.json({
      success: true,
      players: players.map((p) => ({ steamId: p.id, name: p.name, avatarUrl: p.avatar_url, skins: p.skins })),
    });
  } catch (error) {
    return fail(res, error, 'Finding players');
  }
});

/**
 * @openapi
 * /api/skins/admin/players/{steamId}/inventory:
 *   get:
 *     tags: [Skins]
 *     summary: A player's whole inventory, for an admin
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: steamId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: The player's skins }
 *       404: { description: No such player }
 */
router.get('/admin/players/:steamId/inventory', requireAuth, async (req, res) => {
  try {
    return res.json({ success: true, inventory: await skinService.adminInventory(req.params.steamId) });
  } catch (error) {
    return fail(res, error, 'Reading the inventory');
  }
});

/**
 * @openapi
 * /api/skins/admin/players/{steamId}/skins:
 *   post:
 *     tags: [Skins]
 *     summary: Give a player a skin
 *     description: One exact paint kit. Float and pattern are rolled when left out.
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: steamId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [weapon, paintKit]
 *             properties:
 *               weapon: { type: string }
 *               paintKit: { type: integer }
 *               float: { type: number, minimum: 0, maximum: 1 }
 *               pattern: { type: integer, minimum: 0, maximum: 1000 }
 *     responses:
 *       200: { description: The new skin's id }
 *       400: { description: Not in the catalogue }
 *       404: { description: No such player }
 */
router.post('/admin/players/:steamId/skins', requireAuth, async (req, res) => {
  try {
    const body = req.body ?? {};
    if (typeof body.weapon !== 'string' || !Number.isInteger(body.paintKit)) {
      return res.status(400).json({ success: false, error: 'weapon and paintKit are required.' });
    }
    const id = await skinService.adminGive(req.params.steamId, {
      weapon: body.weapon,
      paintKit: body.paintKit,
      float: typeof body.float === 'number' ? body.float : null,
      pattern: Number.isInteger(body.pattern) ? body.pattern : null,
    });
    return res.json({ success: true, id });
  } catch (error) {
    return fail(res, error, 'Giving a skin');
  }
});

/**
 * @openapi
 * /api/skins/admin/skins/{id}:
 *   delete:
 *     tags: [Skins]
 *     summary: Take a skin away from its owner
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Removed }
 *       404: { description: No such skin }
 */
router.delete('/admin/skins/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'Bad skin id.' });
    await skinService.adminRemove(id);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Removing a skin');
  }
});

export default router;
