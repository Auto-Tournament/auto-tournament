/**
 * Game packs: list, import, remove, and serve a pack's tile.
 *
 * A pack is a file describing a game this instance can run — data only, no
 * code. See `services/gamePackService.ts` for what one is and why importing
 * one is safe.
 *
 * Everything here is admin-only except the tile, which the setup wizard's
 * game step fetches for anyone who can see that step.
 */

import { Router, Request, Response } from 'express';
import { requireAuth, requestActorId } from '../middleware/auth';
import { log } from '../utils/logger';
import {
  checkAppIcon,
  checkTileMarkup,
  installPack,
  installedPack,
  installedPacks,
  packIcon,
  packIsInUse,
  removePack,
  resolvePackAppIcon,
  validatePack,
  type AppIcon,
} from '../services/gamePackService';
import { fetchIndexedPack, fetchIndexedTile, readPackIndex } from '../services/packIndexService';

const router = Router();

/**
 * @openapi
 * /api/packs/{slug}/icon.svg:
 *   get:
 *     tags: [Game packs]
 *     summary: A game pack's square tile
 *     description: |
 *       The pack's own SVG, checked against a strict allowlist when the pack
 *       was imported. Served from this origin so the client can inline it and
 *       let it follow the active theme.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The tile
 *         content:
 *           image/svg+xml: {}
 *       404:
 *         description: No such pack, or it has no tile
 */
router.get('/:slug/icon.svg', async (req: Request, res: Response) => {
  try {
    const markup = await packIcon(req.params.slug);
    if (!markup) {
      res.status(404).json({ success: false, error: 'No tile for that pack' });
      return;
    }
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    // The markup passed the import allowlist, so this is a second lock on the
    // same door rather than the only one: nothing in a tile should ever run,
    // load or navigate, and a browser opening the file directly is told so.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(markup);
  } catch (error) {
    log.error('[PACKS] Failed to serve a pack tile', error);
    res.status(500).json({ success: false, error: 'Failed to read the tile' });
  }
});

/**
 * @openapi
 * /api/packs/{slug}/app-icon:
 *   get:
 *     tags: [Game packs]
 *     summary: A game's square app icon
 *     description: |
 *       The icon players know the game by, for the small game pills: the
 *       installed pack's own, else the one in the image's bundled snapshot
 *       for the same game (also when the installed pack has none). A PNG or
 *       WebP, checked by its bytes when it was imported.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The icon
 *         content:
 *           image/webp: {}
 *           image/png: {}
 *       404:
 *         description: No app icon for that game
 */
router.get('/:slug/app-icon', async (req: Request, res: Response) => {
  try {
    // The installed pack's own, else the snapshot's for the same game —
    // whoever installed the pack: a game shows its app icon wherever one
    // exists (`packAppIconUrl`).
    const icon = await resolvePackAppIcon(req.params.slug);
    if (!icon) {
      res.status(404).json({ success: false, error: 'No app icon for that game' });
      return;
    }
    res.setHeader('Content-Type', icon.type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(icon.data);
  } catch (error) {
    log.error('[PACKS] Failed to serve an app icon', error);
    res.status(500).json({ success: false, error: 'Failed to read the app icon' });
  }
});

// Everything below is admin-only.
router.use(requireAuth);

/**
 * @openapi
 * /api/packs:
 *   get:
 *     tags: [Game packs]
 *     summary: Every installed game pack
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: The installed packs
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    packs: installedPacks().map((pack) => ({
      slug: pack.slug,
      name: pack.name,
      engine: pack.engine,
      version: pack.version,
      source: pack.source,
      hasIcon: pack.hasIcon,
      hasAppIcon: pack.hasAppIcon,
      installedAt: pack.installedAt,
      description: pack.definition.description ?? null,
      statFieldCount: pack.definition.stats?.length ?? 0,
    })),
  });
});

/**
 * @openapi
 * /api/packs:
 *   post:
 *     tags: [Game packs]
 *     summary: Import a game pack
 *     description: |
 *       Takes the pack file's JSON as the request body. Re-importing a slug
 *       that is already installed updates it in place, which is how an
 *       update is applied.
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: The pack was imported
 *       400:
 *         description: The pack is not valid, with the reason
 */
router.post('/', async (req: Request, res: Response) => {
  // Two shapes, because a pack's tile is a file beside it rather than a
  // string inside it. The page sends `{ pack, icon }` with the markup of the
  // SVG the admin picked alongside the JSON; `curl -d @pack.json` sends the
  // pack on its own, and gets the game with its text mark. `appIcon`, when
  // sent, is the app icon's bytes as base64.
  const body = (req.body ?? {}) as { pack?: unknown; icon?: unknown; appIcon?: unknown };
  const hasEnvelope = body.pack !== undefined;
  const result = validatePack(hasEnvelope ? body.pack : req.body);
  if (!result.ok) {
    res.status(400).json({ success: false, error: result.error });
    return;
  }

  let tile: string | null = null;
  if (hasEnvelope && body.icon !== undefined && body.icon !== null) {
    if (typeof body.icon !== 'string') {
      res.status(400).json({ success: false, error: 'icon must be SVG markup' });
      return;
    }
    const problem = checkTileMarkup(body.icon);
    if (problem) {
      res.status(400).json({ success: false, error: problem });
      return;
    }
    tile = body.icon;
  }

  let appIcon: AppIcon | null = null;
  if (hasEnvelope && body.appIcon !== undefined && body.appIcon !== null) {
    if (typeof body.appIcon !== 'string') {
      res.status(400).json({ success: false, error: 'appIcon must be base64 image data' });
      return;
    }
    const checked = checkAppIcon(Buffer.from(body.appIcon, 'base64'));
    if (typeof checked === 'string') {
      res.status(400).json({ success: false, error: checked });
      return;
    }
    appIcon = checked;
  }

  try {
    const existing = installedPack(result.pack.slug);
    const pack = await installPack(result.pack, {
      source: 'uploaded',
      installedBy: requestActorId(req),
      tile,
      appIcon,
    });
    res.json({
      success: true,
      updated: Boolean(existing),
      pack: { slug: pack.slug, name: pack.name, engine: pack.engine, version: pack.version },
    });
  } catch (error) {
    log.error('[PACKS] Failed to import a pack', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to import the pack',
    });
  }
});

/**
 * @openapi
 * /api/packs/index:
 *   get:
 *     tags: [Game packs]
 *     summary: The community pack index
 *     description: |
 *       Fetches `index.json` from the configured pack index (by default the
 *       `Auto-Tournament/packs` repository) and says which of its games this
 *       instance already has. Nothing is fetched until this is called, and
 *       the answer is cached under `DATA_DIR`, so an instance with no network
 *       still lists what it saw last — with `stale` set.
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: The index, or the last copy of it
 */
router.get('/index', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, ...(await readPackIndex()) });
  } catch (error) {
    log.error('[PACKS] Failed to read the pack index', error);
    res.status(502).json({ success: false, error: 'Could not read the pack index' });
  }
});

/**
 * @openapi
 * /api/packs/index/{slug}/icon.svg:
 *   get:
 *     tags: [Game packs]
 *     summary: The tile the index names for a game
 *     description: |
 *       Fetched by this server and served from this origin, so a browse list
 *       does not hand every admin's address to whoever hosts the index, and
 *       so the tile is same-origin and can follow the theme. Checked against
 *       the same allowlist an imported tile is.
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: The tile
 *         content:
 *           image/svg+xml: {}
 *       404:
 *         description: The index names no usable tile for that game
 */
router.get('/index/:slug/icon.svg', async (req: Request, res: Response) => {
  const found = await fetchIndexedTile(req.params.slug);
  if (!found.ok) {
    res.status(404).json({ success: false, error: found.error });
    return;
  }
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(found.markup);
});

/**
 * @openapi
 * /api/packs/index/{slug}:
 *   post:
 *     tags: [Game packs]
 *     summary: Import a game from the community index
 *     description: |
 *       Downloads the pack the index lists for this slug and validates it
 *       exactly as an uploaded file is validated. Being listed in the index
 *       earns a pack nothing.
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: The pack was imported
 *       400:
 *         description: The pack is not valid, with the reason
 */
router.post('/index/:slug', async (req: Request, res: Response) => {
  try {
    const found = await fetchIndexedPack(req.params.slug);
    if (!found.ok) {
      res.status(400).json({ success: false, error: found.error });
      return;
    }
    const existing = installedPack(found.pack.slug);
    const pack = await installPack(found.pack, {
      source: 'index',
      origin: found.origin,
      installedBy: requestActorId(req),
      tile: found.tile,
      appIcon: found.appIcon,
    });
    res.json({
      success: true,
      updated: Boolean(existing),
      pack: { slug: pack.slug, name: pack.name, engine: pack.engine, version: pack.version },
    });
  } catch (error) {
    log.error('[PACKS] Failed to import a pack from the index', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to import the pack',
    });
  }
});

/**
 * @openapi
 * /api/packs/{slug}:
 *   delete:
 *     tags: [Game packs]
 *     summary: Remove a game pack
 *     description: |
 *       Refused while a tournament is running the pack's game, so a live
 *       tournament is never left pointing at a game this instance no longer
 *       knows about.
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: Removed
 *       409:
 *         description: A tournament is using it
 */
router.delete('/:slug', async (req: Request, res: Response) => {
  try {
    if (await packIsInUse(req.params.slug)) {
      res.status(409).json({
        success: false,
        error: 'A tournament is running this game; delete the tournament first',
      });
      return;
    }
    const removed = await removePack(req.params.slug);
    if (!removed) {
      res.status(404).json({ success: false, error: 'No such pack' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    log.error('[PACKS] Failed to remove a pack', error);
    res.status(500).json({ success: false, error: 'Failed to remove the pack' });
  }
});

export default router;
