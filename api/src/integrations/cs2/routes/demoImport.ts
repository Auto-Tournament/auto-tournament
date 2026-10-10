/**
 * Import a match from its demos (admin): create the match, upload one demo
 * per map, follow its analysis (demos/demoImport.ts).
 */
import express, { Router, Request, Response } from 'express';
import { requireAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import {
  createImport,
  DemoImportError,
  importStatus,
  storeImportedChunk,
} from '../demos/demoImport';

import { FleetError } from '../demos/recorderFleet';

const router = Router();

function fail(res: Response, error: unknown, fallback: string): Response {
  if (error instanceof DemoImportError || error instanceof FleetError) {
    return res.status(error.status).json({ success: false, error: error.message });
  }
  log.error(`[IMPORT] ${fallback}`, error as Error);
  return res.status(500).json({ success: false, error: fallback });
}

/**
 * @openapi
 * /api/game/cs2/imports:
 *   post:
 *     tags: [Match import]
 *     summary: Start importing a match from its demos (admin)
 *     description: |
 *       Creates the match; then upload each map's demo. `maps`: how many
 *       demos (1 to 5), `event`: where it was played (optional).
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               maps: { type: integer }
 *               event: { type: string }
 *               recordingGroupId: { type: integer, nullable: true, description: Optional recorder group for this match }
 *     responses:
 *       201:
 *         description: "`slug`: the new match"
 *       400:
 *         description: No or too many maps
 */
router.post('/imports', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return res.status(201).json({ success: true, ...(await createImport(body)) });
  } catch (error) {
    return fail(res, error, 'Could not start the import');
  }
});

/**
 * @openapi
 * /api/game/cs2/imports/{slug}/maps/{mapNumber}:
 *   put:
 *     tags: [Match import]
 *     summary: Upload one map's demo, a piece at a time (admin)
 *     description: |
 *       A piece of the .dem file as the body (application/octet-stream, up
 *       to 64 MB), in order: `offset` is where it starts, `total` the file's
 *       size. `mapNumber` is 0-based, in the order the maps were played. With
 *       the last piece the map's name is read from the demo and its analysis
 *       is queued for the worker.
 *     parameters:
 *       - in: query
 *         name: offset
 *         schema: { type: integer }
 *       - in: query
 *         name: total
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: "`received` bytes so far; `done` with the last piece, then `map`"
 *       409:
 *         description: Not the next piece (the error says which byte comes next)
 *       400:
 *         description: Not a CS2 demo, or no such map number
 *       404:
 *         description: No imported match with that id
 */
router.put(
  '/imports/:slug/maps/:mapNumber',
  requireAuth,
  express.raw({ type: 'application/octet-stream', limit: '64mb' }),
  async (req: Request, res: Response) => {
    try {
      const stored = await storeImportedChunk(
        req.params.slug,
        Number(req.params.mapNumber),
        Number(req.query.offset ?? 0),
        Number(req.query.total),
        req.body as Buffer
      );
      return res.json({ success: true, ...stored });
    } catch (error) {
      return fail(res, error, 'Could not store the demo');
    }
  }
);

/**
 * @openapi
 * /api/game/cs2/imports/{slug}:
 *   get:
 *     tags: [Match import]
 *     summary: An import's progress (admin)
 *     responses:
 *       200:
 *         description: "The teams found so far and each map: uploaded, analysis status, score"
 *       404:
 *         description: No imported match with that id
 */
router.get('/imports/:slug', requireAuth, async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, import: await importStatus(req.params.slug) });
  } catch (error) {
    return fail(res, error, 'Could not read the import');
  }
});

export default router;
