/**
 * Virtual skins: a player's inventory and loadout, other players' showcases,
 * and the admin settings. Every player route answers 404 while skins are off.
 *
 * GET    /status                   public: on or off
 * GET    /odds                     public: drop odds per rarity and per skin, and when drops happen
 * GET    /me                       signed in: your inventory, showcase and new skins
 * POST   /me/equip                 equip a skin ({ skinId, team?: 0 both | 2 T | 3 CT })
 * DELETE /me/equip/:slot           empty a slot (?team= one side)
 * POST   /me/seen                  the "new skin" reveal was shown ({ ids })
 * PUT    /me/showcase              the profile showcase ({ items: [{ skinId, big }] })
 * GET    /players/:steamId         public: a player's skins
 * GET    /skin/:id                 public: one skin and its owner
 * GET    /tournaments/:id/rewards  public: what a tournament's top three got
 * GET    /admin/config, PUT        admin: the settings
 * GET    /admin/catalog?q=         admin: search the catalogue (for picking a reward)
 */

import { db } from '../../../config/database';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { resolveViewerAccount } from '../../../utils/viewerIdentity';
import { knifeAndGlovePrices, priceFor, priceKey } from './skinPrices';
import {
  RARITIES,
  SKIN_IMAGES_BASE,
  SkinError,
  type Rarity,
  skinService,
  variantOf,
  type SkinsConfig,
  type DropTarget,
  MVP_PLACE,
  parseRewards,
} from './skinService';
import type { Untrusted } from '../../../utils/untrusted';

const router = Router();

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof SkinError)
    return res.status(error.status).json({ success: false, error: error.message });
  log.error(`[Skins] ${what} failed`, { error });
  return res.status(500).json({ success: false, error: `${what} failed` });
}

/** The signed-in player's account, while skins are on; otherwise the answer is already sent. */
/** A loadout changed: a player in a match right now sees it in game at once. */
async function loadoutChanged(uid: string): Promise<void> {
  const row = await db.queryOneAsync<{ id: string }>('SELECT id FROM players WHERE uid = ?', [uid]);
  if (!row) return;
  const { pushLoadoutLive } = await import('../fleet/push/skins');
  await pushLoadoutLive(row.id);
}

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
    const config = await skinService.config();
    return res.json({
      success: true,
      enabled: config.enabled,
      tradeUp: config.enabled && config.tradeUp.enabled ? { count: config.tradeUp.count } : null,
    });
  } catch (error) {
    return fail(res, error, 'Reading the skins status');
  }
});

/**
 * @openapi
 * /api/skins/catalog:
 *   get:
 *     tags: [Skins]
 *     summary: Every skin a drop can give, with its rarity and chance per option (public)
 *     responses:
 *       200: { description: The skins }
 *       404: { description: Skins are off }
 */
router.get('/catalog', async (_req, res) => {
  try {
    const catalog = await skinService.publicCatalog();
    if (!catalog.enabled) return res.status(404).json({ success: false, error: 'Skins are off' });
    // The same for everyone and slow to change: let the browser keep it a while.
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ success: true, skins: catalog.skins });
  } catch (error) {
    return fail(res, error, 'Reading the skin list');
  }
});

/**
 * @openapi
 * /api/skins/odds:
 *   get:
 *     tags: [Skins]
 *     summary: Drop odds per rarity and per skin, and when drops happen (public)
 *     responses:
 *       200: { description: The odds }
 *       404: { description: Skins are off }
 */
router.get('/odds', async (_req, res) => {
  try {
    const odds = await skinService.odds();
    if (!odds.enabled) return res.status(404).json({ success: false, error: 'Skins are off' });
    return res.json({ success: true, ...odds });
  } catch (error) {
    return fail(res, error, 'Reading the drop odds');
  }
});

/**
 * @openapi
 * /api/skins/tryout:
 *   get:
 *     tags: [Skins]
 *     summary: Servers where you can try your skins in game
 *     description: >-
 *       Online Ready Up servers on the Skin tryout plugin set (practice and
 *       skins, no match plugin). Signed-in players, while skins are on.
 *     responses:
 *       200: { description: "`servers`: name, address (host:port), connectIp, port" }
 *       401: { description: Not signed in }
 *       404: { description: Skins are off }
 */
router.get('/tryout', async (req, res) => {
  try {
    if (!(await skinService.config()).enabled) {
      return res.status(404).json({ success: false, error: 'Skins are off' });
    }
    const viewer = await resolveViewerAccount(req);
    if (!viewer.uid) return res.status(401).json({ success: false, error: 'Sign in first' });
    const { tryoutServers } = await import('./tryout');
    return res.json({ success: true, servers: await tryoutServers() });
  } catch (error) {
    return fail(res, error, 'Listing the tryout servers');
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
      choices: await skinService.openChoices(uid),
    });
  } catch (error) {
    return fail(res, error, 'Reading the inventory');
  }
});

/**
 * @openapi
 * /api/skins/me/trade-up:
 *   get:
 *     tags: [Skins]
 *     summary: How trade-ups work here, and what one of a grade can give
 *     parameters:
 *       - { in: query, name: rarity, schema: { type: string }, description: 'The grade to trade up (common … legendary)' }
 *     responses:
 *       200: { description: "{ enabled, count, to, skins }: the skins of the next grade, each equally likely" }
 *   post:
 *     tags: [Skins]
 *     summary: Trade up skins of one grade for one random skin of the next
 *     description: Exactly `count` of the player's weapon skins (no knives or gloves) of one grade below ancient. They leave the inventory, loadout and showcase; the new skin has their average wear.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { skinIds: { type: array, items: { type: integer } } } }
 *     responses:
 *       200: { description: "{ skinId, skin }" }
 *       400: { description: Not a valid contract (count, grade, knives or gloves, not yours) }
 *       404: { description: Skins or trade-ups are off }
 */
router.get('/me/trade-up', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    const { tradeUp } = await skinService.config();
    const rarity = String(req.query.rarity ?? '');
    const outcomes = RARITIES.includes(rarity as Rarity)
      ? await skinService.tradeUpOutcomes(rarity as Rarity)
      : { to: null, skins: [] };
    return res.json({
      success: true,
      enabled: tradeUp.enabled,
      count: tradeUp.count,
      to: outcomes.to,
      skins: outcomes.skins.map((s) => ({
        weapon: s.weapon,
        weaponName: s.weaponName,
        name: s.name,
        rarity: s.rarity,
        imageUrl: `${SKIN_IMAGES_BASE}/${s.image}`,
      })),
    });
  } catch (error) {
    return fail(res, error, 'Reading the trade-up');
  }
});

router.post('/me/trade-up', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    const result = await skinService.tradeUp(uid, req.body?.skinIds);
    void loadoutChanged(uid);
    return res.json({ success: true, skinId: result.skinId });
  } catch (error) {
    return fail(res, error, 'Trading up');
  }
});

/**
 * @openapi
 * /api/skins/me/choices/{id}:
 *   post:
 *     tags: [Skins]
 *     summary: Keep one option of a drop
 *     description: A drop offers three skins; the player keeps one (`index` 0-2), the others are gone.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { index: { type: integer } } }
 *     responses:
 *       200: { description: "{ skinId }" }
 *       404: { description: Not a waiting choice of yours }
 *       409: { description: Already chosen }
 */
router.post('/me/choices/:id', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    const skinId = await skinService.choose(uid, Number(req.params.id), Number(req.body?.index));
    return res.json({ success: true, skinId });
  } catch (error) {
    return fail(res, error, 'Choosing a skin');
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
 *           schema: { type: object, properties: { skinId: { type: integer }, team: { type: integer, enum: [0, 2, 3], description: '0 both sides (default), 2 T, 3 CT' } } }
 *     responses:
 *       200: { description: Equipped }
 *       404: { description: Not in your inventory, or skins are off }
 */
router.post('/me/equip', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    const team = Number(req.body?.team ?? 0);
    await skinService.equip(uid, Number(req.body?.skinId), team);
    void loadoutChanged(uid);
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
 *       - { in: query, name: team, schema: { type: integer, enum: [0, 2, 3] }, description: 'One side only (default: every side)' }
 *     responses:
 *       200: { description: Emptied }
 */
router.delete('/me/equip/:slot', async (req, res) => {
  try {
    const uid = await playerOrStop(req, res);
    if (!uid) return;
    const team = req.query.team === undefined ? undefined : Number(req.query.team);
    await skinService.unequip(uid, req.params.slot, team);
    void loadoutChanged(uid);
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
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(Number).filter(Number.isInteger)
      : [];
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
    if (!(await skinService.config()).enabled)
      return res.status(404).json({ success: false, error: 'Skins are off' });
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
    if (!(await skinService.config()).enabled)
      return res.status(404).json({ success: false, error: 'Skins are off' });
    const skin = await skinService.one(Number(req.params.id));
    // The odds a drop option is this rarity, and this exact skin.
    const rarity = (await skinService.odds()).rarities.find((r) => r.rarity === skin.skin.rarity);
    return res.json({
      success: true,
      ...skin,
      odds: rarity ? { rarity: rarity.chance, skin: rarity.perSkin, skins: rarity.skins } : null,
    });
  } catch (error) {
    return fail(res, error, 'Reading a skin');
  }
});

/**
 * @openapi
 * /api/skins/tournaments/{id}/rewards:
 *   get:
 *     tags: [Skins]
 *     summary: What a finished tournament's top three got (public)
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: The rewards, by place }
 *       404: { description: Skins are off }
 */
router.get('/tournaments/:id/rewards', async (req, res) => {
  try {
    if (!(await skinService.config()).enabled)
      return res.status(404).json({ success: false, error: 'Skins are off' });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ success: false, error: 'Bad tournament id' });
    return res.json({
      success: true,
      rewards: await skinService.tournamentRewards(id),
      ...(await tournamentPrizeInfo(id)),
    });
  } catch (error) {
    return fail(res, error, 'Reading the tournament rewards');
  }
});

/**
 * What a tournament gives (its own prizes, else the site's) and its MVP: who,
 * why (commends, rating or the organizer) and their numbers, for Results.
 */
async function tournamentPrizeInfo(tournamentId: number) {
  const { storedCs2Settings } = await import('../tournamentSettings');
  const { mvpCandidates, MIN_ROUNDS_FOR_RATING } = await import('./mvp');
  const row = await db.queryOneAsync<{ settings: string | null; status: string }>(
    'SELECT settings, status FROM tournament WHERE id = ?',
    [tournamentId]
  );
  const own = storedCs2Settings(row?.settings ?? null);
  const config = await skinService.config();
  const off = own?.skinRewards === false || !config.tournamentRewards;
  const places = off
    ? []
    : (parseRewards(own?.rewards) ?? config.rewards)
        .filter((r) => r.mode !== 'none')
        .map((r) => ({
          place: r.place,
          mode: r.mode,
          rarity: r.rarity ?? null,
          pick: r.mode === 'random' ? (r.pick === 'one' ? 'one' : 'choice') : null,
        }));
  const mvpSetting = !off && own?.mvp?.enabled ? own.mvp : null;
  let mvp = null;
  if (mvpSetting) {
    const rewards = await skinService.tournamentRewards(tournamentId);
    const winner = rewards.find((r) => r.place === MVP_PLACE);
    if (winner) {
      const numbers = (await mvpCandidates(tournamentId)).find(
        (c) => c.steamId === winner.player.steamId
      );
      mvp = {
        player: winner.player,
        teamName: numbers?.teamName ?? null,
        commends: numbers?.commends ?? 0,
        commendedBy: numbers?.commendedBy ?? 0,
        kinds: numbers?.kinds ?? {},
        rating: numbers?.rating ?? null,
        matches: numbers?.matches ?? 0,
        skin: winner.skin,
        choosing: winner.choosing,
      };
    }
  }
  return {
    prizes: {
      places,
      mvp: mvpSetting
        ? {
            by: mvpSetting.by,
            rarity: mvpSetting.rarity,
            pick: mvpSetting.pick === 'one' ? 'one' : 'choice',
          }
        : null,
      minRoundsForRating: MIN_ROUNDS_FOR_RATING,
    },
    mvp,
  };
}

/**
 * @openapi
 * /api/game/cs2/skins/tournaments/{id}/mvp-candidates:
 *   get:
 *     tags: [Skins]
 *     summary: Who could be the tournament's MVP (admin)
 *     description: Everyone who played in it, with commends and rating, ranked by the tournament's MVP rule.
 *     responses:
 *       200: { description: "`candidates`, best first, and whether the MVP prize is given" }
 */
router.get('/tournaments/:id/mvp-candidates', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0)
      return res.status(400).json({ success: false, error: 'Bad tournament id' });
    const { storedCs2Settings } = await import('../tournamentSettings');
    const { mvpCandidates, rankMvp } = await import('./mvp');
    const row = await db.queryOneAsync<{ settings: string | null }>(
      'SELECT settings FROM tournament WHERE id = ?',
      [id]
    );
    const by = storedCs2Settings(row?.settings ?? null)?.mvp?.by ?? 'commends';
    const given = (await skinService.tournamentRewards(id)).find((r) => r.place === MVP_PLACE);
    return res.json({
      success: true,
      by,
      given: given ? given.player : null,
      candidates: rankMvp(await mvpCandidates(id), by).slice(0, 50),
    });
  } catch (error) {
    return fail(res, error, 'Reading the MVP candidates');
  }
});

/**
 * @openapi
 * /api/game/cs2/skins/tournaments/{id}/mvp:
 *   post:
 *     tags: [Skins]
 *     summary: Give the MVP prize to a player (admin)
 *     description: Once the tournament is over, to a player who played in it. Once per tournament.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { steamId: { type: string } } }
 *     responses:
 *       200: { description: Given }
 *       409: { description: Not over yet, no MVP prize, or already given }
 */
router.post('/tournaments/:id/mvp', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const steamId = String((req.body as { steamId?: Untrusted } | undefined)?.steamId ?? '');
    if (!Number.isInteger(id) || id <= 0 || !steamId)
      return res.status(400).json({ success: false, error: 'Pick a player' });
    const { storedCs2Settings } = await import('../tournamentSettings');
    const { mvpCandidates } = await import('./mvp');
    const row = await db.queryOneAsync<{ settings: string | null; status: string; name: string }>(
      'SELECT settings, status, name FROM tournament WHERE id = ?',
      [id]
    );
    if (!row) return res.status(404).json({ success: false, error: 'No such tournament' });
    if (row.status !== 'completed')
      return res.status(409).json({ success: false, error: 'The tournament is not over yet' });
    const mvp = storedCs2Settings(row.settings)?.mvp;
    if (!mvp?.enabled)
      return res.status(409).json({ success: false, error: 'This tournament has no MVP prize' });
    if (!(await mvpCandidates(id)).some((c) => c.steamId === steamId))
      return res.status(400).json({ success: false, error: 'That player did not play in it' });
    const given = await skinService.awardMvp(id, row.name, steamId, {
      rarity: mvp.rarity,
      pick: mvp.pick,
    });
    if (!given)
      return res.status(409).json({ success: false, error: 'The MVP prize is already given' });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Giving the MVP prize');
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
    const before = (await skinService.config()).enabled;
    const config = await skinService.setConfig((req.body ?? {}) as Partial<SkinsConfig>);
    // The servers' skins plugin follows the platform's switch.
    if (config.enabled !== before) {
      void import('../fleet/push/controls').then(({ syncSkinsPluginEverywhere }) =>
        syncSkinsPluginEverywhere()
      );
    }
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
 *       200: { description: 'Up to 50 matching skins; knives and gloves carry priceUsd (Skinport, at most a day old)' }
 */
router.get('/admin/catalog', requireAuth, async (req, res) => {
  try {
    const words = String(req.query.q ?? '')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    // `all=1`: every paint kit, so each phase of a Doppler is its own row.
    const all = req.query.all === '1';
    const seen = new Set<string>();
    const prices = await knifeAndGlovePrices();
    const skins = (await skinService.catalog())
      .map((s) => {
        const variant = variantOf(s.paintKitName);
        return {
          ...s,
          variant,
          imageUrl: `${SKIN_IMAGES_BASE}/${s.image}`,
        };
      })
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
      .slice(0, 50)
      .map((s) => ({
        ...s,
        priceUsd: priceFor(prices, priceKey(s.weaponName, s.name, s.variant)) ?? null,
      }));
    return res.json({ success: true, skins });
  } catch (error) {
    return fail(res, error, 'Searching the catalogue');
  }
});

/**
 * @openapi
 * /api/skins/admin/stats:
 *   get:
 *     tags: [Skins]
 *     summary: How many skins are out there, and the rarest one
 *     security: [{ BearerAuth: [] }]
 *     responses:
 *       200: { description: 'Counts, and the rarest skin with its owner' }
 */
router.get('/admin/stats', requireAuth, async (_req, res) => {
  try {
    return res.json({ success: true, ...(await skinService.adminStats()) });
  } catch (error) {
    return fail(res, error, 'Reading skin stats');
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
      players: players.map((p) => ({
        steamId: p.id,
        name: p.name,
        avatarUrl: p.avatar_url,
        skins: p.skins,
        best: p.best_name
          ? { weaponName: p.best_weapon, name: p.best_name, rarity: p.best_rarity }
          : null,
      })),
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
    return res.json({
      success: true,
      inventory: await skinService.adminInventory(req.params.steamId),
    });
  } catch (error) {
    return fail(res, error, 'Reading the inventory');
  }
});

/**
 * @openapi
 * /api/skins/admin/players/{steamId}/equip:
 *   post:
 *     tags: [Skins]
 *     summary: Equip one of a player's skins (admin)
 *     description: As the player would on their inventory. team 0 is both sides, 2 T, 3 CT; a knife or gloves can differ per side.
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: steamId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [skinId]
 *             properties:
 *               skinId: { type: integer }
 *               team: { type: integer, enum: [0, 2, 3] }
 *     responses:
 *       200: { description: Equipped (and sent to their server when they are on one) }
 *       404: { description: No such player or skin }
 */
router.post('/admin/players/:steamId/equip', requireAuth, async (req, res) => {
  try {
    const uid = await skinService.adminEquip(
      req.params.steamId,
      Number(req.body?.skinId),
      Number(req.body?.team ?? 0)
    );
    void loadoutChanged(uid);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Equipping');
  }
});

/**
 * @openapi
 * /api/skins/admin/players/{steamId}/equip/{slot}:
 *   delete:
 *     tags: [Skins]
 *     summary: Empty a slot of a player's loadout (admin)
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: steamId, required: true, schema: { type: string } }
 *       - { in: path, name: slot, required: true, schema: { type: string } }
 *       - { in: query, name: team, schema: { type: integer, enum: [0, 2, 3] }, description: 'One side only (default: every side)' }
 *     responses:
 *       200: { description: Emptied }
 */
router.delete('/admin/players/:steamId/equip/:slot', requireAuth, async (req, res) => {
  try {
    const team = req.query.team === undefined ? undefined : Number(req.query.team);
    const uid = await skinService.adminUnequip(req.params.steamId, req.params.slot, team);
    void loadoutChanged(uid);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Unequipping');
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
 * /api/skins/admin/drops:
 *   post:
 *     tags: [Skins]
 *     summary: Give a drop (a choice of three) to a player or a group
 *     description: With `preview` true, nothing is given; the answer names who would get one.
 *     security: [{ BearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               target:
 *                 type: object
 *                 properties:
 *                   kind: { type: string, enum: [player, online, team, match, tournament] }
 *                   id: { type: string, description: 'Steam ID, team id, match slug or tournament id' }
 *               preview: { type: boolean }
 *               label: { type: string, description: 'Shown on the drop, e.g. "From the admins"' }
 *               rarity:
 *                 type: string
 *                 enum: [common, uncommon, rare, mythical, legendary, ancient, immortal]
 *                 description: All three options of this rarity (the catalogue's tiers; knives and gloves are ranked by price into common–ancient, and immortal is one skin, the M4A4 Howl); without it, the drop odds.
 *     responses:
 *       200: { description: 'Who gets one (preview), or how many were given' }
 *       400: { description: Not a target }
 */
router.post('/admin/drops', requireAuth, async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      target?: { kind?: string; id?: Untrusted };
      preview?: boolean;
      label?: Untrusted;
      rarity?: Untrusted;
    };
    const rarity =
      typeof body.rarity === 'string' && RARITIES.includes(body.rarity as Rarity)
        ? (body.rarity as Rarity)
        : null;
    if (body.rarity !== undefined && body.rarity !== null && !rarity)
      return res
        .status(400)
        .json({ success: false, error: `rarity is one of ${RARITIES.join(', ')}.` });
    const kind = body.target?.kind;
    const id = typeof body.target?.id === 'string' ? body.target.id.trim() : '';
    let target: DropTarget;
    if (kind === 'online') target = { kind };
    else if (
      (kind === 'player' || kind === 'team' || kind === 'match' || kind === 'tournament') &&
      id
    )
      target = { kind, id };
    else
      return res.status(400).json({ success: false, error: 'target.kind (and id) are required.' });
    const players = await skinService.dropTargets(target);
    if (body.preview) {
      return res.json({ success: true, count: players.length, names: players.map((p) => p.name) });
    }
    const label =
      typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : null;
    const given = await skinService.adminDrop(
      players.map((p) => p.uid),
      label,
      rarity
    );
    return res.json({ success: true, given });
  } catch (error) {
    return fail(res, error, 'Giving drops');
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
    if (!Number.isInteger(id))
      return res.status(400).json({ success: false, error: 'Bad skin id.' });
    await skinService.adminRemove(id);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, 'Removing a skin');
  }
});

/**
 * @openapi
 * /api/skins/admin/players/{steamId}/inventory:
 *   delete:
 *     tags: [Skins]
 *     summary: Empty a player's skins
 *     description: Every skin, the loadout, the showcase, open choices and skin notices.
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: steamId, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: 'What was removed: skins, choices, notices' }
 *       404: { description: No such player }
 */
router.delete('/admin/players/:steamId/inventory', requireAuth, async (req, res) => {
  try {
    const player = await db.queryOneAsync<{ id: string; uid: string }>(
      'SELECT id, uid FROM players WHERE id = ?',
      [String(req.params.steamId)]
    );
    if (!player) return res.status(404).json({ success: false, error: 'No such player.' });
    const removed = await skinService.adminClearInventory(player.uid, player.id);
    return res.json({ success: true, ...removed });
  } catch (error) {
    return fail(res, error, "Emptying a player's skins");
  }
});

export default router;
