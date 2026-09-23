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
  installPack,
  installedPack,
  installedPacks,
  packIcon,
  packIsInUse,
  removePack,
  validatePack,
} from '../services/gamePackService';

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
  const result = validatePack(req.body);
  if (!result.ok) {
    res.status(400).json({ success: false, error: result.error });
    return;
  }

  try {
    const existing = installedPack(result.pack.slug);
    const pack = await installPack(result.pack, {
      source: 'uploaded',
      installedBy: requestActorId(req),
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
