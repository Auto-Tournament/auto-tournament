import { Router, type NextFunction, type Request, type Response } from 'express';
import { createRateLimiter } from '../utils/rateLimit';
import { log } from '../utils/logger';
import { compatBadge, validateCompatDocument } from '../utils/compatPayload';
import {
  COMPAT_HISTORY_LIMIT,
  compatIngestToken,
  getLatestCompat,
  ingestCompatDocument,
  isCompatEnabled,
  isValidCompatIngestAuth,
  listCompatRuns,
} from '../services/compatService';

/**
 * Ready Up compatibility (services/compatService.ts). Public reads for the
 * `/compatibility` page and a shields.io badge; one token-guarded write for
 * the Ready Up CI. Everything answers 404 unless the instance is configured
 * for it (COMPAT_INGEST_TOKEN and/or COMPAT_FEED_URL).
 *
 * The write's body is parsed with a 256 KB limit before the app's global
 * JSON parser sees it (index.ts), so a large body is refused unread.
 */
const router = Router();

/** Per-IP limit on the public reads: the page loads twice, a badge refreshes every few minutes. */
export const compatReadLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  message: 'Too many compatibility requests, try again in a minute',
});

/** Per-IP limit on the write, ahead of the token check, so guessing it is slow too. */
export const compatIngestLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  message: 'Too many compatibility reports, try again in a minute',
});

const DEFAULT_RUNS = 20;

function disabled(res: Response) {
  return res.status(404).json({
    success: false,
    error: 'compat_disabled',
    message: 'Ready Up compatibility is not enabled on this instance',
  });
}

function requireCompatEnabled(_req: Request, res: Response, next: NextFunction) {
  if (!isCompatEnabled()) return disabled(res);
  return next();
}

/**
 * `Authorization: Bearer <COMPAT_INGEST_TOKEN>`. 404 while the token is unset,
 * as if the endpoint did not exist; 401 for a missing or wrong token.
 */
function requireCompatIngestToken(req: Request, res: Response, next: NextFunction) {
  if (!compatIngestToken()) return disabled(res);
  if (!isValidCompatIngestAuth(req.headers.authorization)) {
    return res.status(401).json({ success: false, error: 'invalid_token' });
  }
  return next();
}

/** 404 before the rate limiter, so a disabled instance does not count anything. */
function ingestEnabled(_req: Request, res: Response, next: NextFunction) {
  if (!compatIngestToken()) return disabled(res);
  return next();
}

/**
 * @openapi
 * /api/compat/events:
 *   post:
 *     tags: [Compatibility]
 *     summary: Report a Ready Up compatibility run
 *     description: |
 *       Called by the Ready Up CI with one `compat.json` (schema 1) per run
 *       update. Upserted by `run.id`; a copy with an older `checked_at` than
 *       the stored one is ignored (`stale`), and an identical one changes
 *       nothing (`unchanged`). Every stored change is sent to the public page
 *       as the Socket.IO event `compat:update`. The body is validated
 *       strictly (unknown fields are refused) and limited to 256 KB.
 *       404 unless COMPAT_INGEST_TOKEN is set.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CompatDocument'
 *     responses:
 *       200:
 *         description: Stored, unchanged or stale
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 status: { type: string, enum: [stored, unchanged, stale] }
 *                 created: { type: boolean }
 *                 runId: { type: string }
 *       400:
 *         description: Not a valid schema-1 document; `details` lists each bad field
 *       401:
 *         description: Missing or wrong token
 *       404:
 *         description: COMPAT_INGEST_TOKEN is not set
 *       413:
 *         description: Body larger than 256 KB
 *       429:
 *         description: Too many requests from this address
 */
router.post(
  '/events',
  ingestEnabled,
  compatIngestLimiter,
  requireCompatIngestToken,
  async (req: Request, res: Response) => {
    const checked = validateCompatDocument(req.body);
    if (!checked.ok) {
      return res.status(400).json({ success: false, error: 'invalid_document', details: checked.errors });
    }
    try {
      const result = await ingestCompatDocument(checked.value, 'push');
      return res.json({ success: true, ...result });
    } catch (error) {
      log.error('[COMPAT] Could not store a pushed run', error);
      return res.status(500).json({ success: false, error: 'Could not store the run' });
    }
  }
);

/**
 * @openapi
 * /api/compat/latest:
 *   get:
 *     tags: [Compatibility]
 *     summary: The newest Ready Up compatibility run
 *     description: |
 *       The newest run (by `run.started_at`) with every component's checks,
 *       plus `source`, `received_at` and `updated_at`. `latest` is null until
 *       the first run arrives. Public; rate limited per IP. 404 unless the
 *       instance has compatibility enabled.
 *     responses:
 *       200:
 *         description: The newest run, or null
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 latest:
 *                   nullable: true
 *                   allOf:
 *                     - $ref: '#/components/schemas/CompatDocument'
 *       404:
 *         description: Compatibility is not enabled on this instance
 */
router.get('/latest', requireCompatEnabled, compatReadLimiter, async (_req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-cache');
    return res.json({ success: true, latest: await getLatestCompat() });
  } catch (error) {
    log.error('[COMPAT] Could not read the latest run', error);
    return res.status(500).json({ success: false, error: 'Could not read compatibility' });
  }
});

/**
 * @openapi
 * /api/compat/runs:
 *   get:
 *     tags: [Compatibility]
 *     summary: Recent Ready Up compatibility runs
 *     description: |
 *       Newest first, each with its components' statuses but not their
 *       checks. The instance keeps the newest 200. Public; rate limited per
 *       IP. 404 unless the instance has compatibility enabled.
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *     responses:
 *       200:
 *         description: Runs, newest first
 *       400:
 *         description: limit is not an integer from 1 to 200
 *       404:
 *         description: Compatibility is not enabled on this instance
 */
router.get('/runs', requireCompatEnabled, compatReadLimiter, async (req: Request, res: Response) => {
  let limit = DEFAULT_RUNS;
  if (req.query.limit !== undefined) {
    const raw = String(req.query.limit);
    limit = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > COMPAT_HISTORY_LIMIT) {
      return res.status(400).json({
        success: false,
        error: `limit must be an integer from 1 to ${COMPAT_HISTORY_LIMIT}`,
      });
    }
  }
  try {
    res.setHeader('Cache-Control', 'no-cache');
    return res.json({ success: true, runs: await listCompatRuns(limit) });
  } catch (error) {
    log.error('[COMPAT] Could not list runs', error);
    return res.status(500).json({ success: false, error: 'Could not read compatibility' });
  }
});

/**
 * @openapi
 * /api/compat/badge.json:
 *   get:
 *     tags: [Compatibility]
 *     summary: shields.io badge for the newest run
 *     description: |
 *       A shields.io endpoint badge
 *       (`https://img.shields.io/endpoint?url=<this URL>`): "Ready Up" and the
 *       newest run's verdict with its CS2 patch, coloured green, yellow, red,
 *       blue (checking) or grey. Public; rate limited per IP. 404 unless the
 *       instance has compatibility enabled.
 *     responses:
 *       200:
 *         description: Endpoint badge
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 schemaVersion: { type: integer, example: 1 }
 *                 label: { type: string, example: Ready Up }
 *                 message: { type: string, example: 'compatible · CS2 1.41.8.5' }
 *                 color: { type: string, example: brightgreen }
 *                 cacheSeconds: { type: integer, example: 300 }
 *       404:
 *         description: Compatibility is not enabled on this instance
 */
router.get('/badge.json', requireCompatEnabled, compatReadLimiter, async (_req: Request, res: Response) => {
  try {
    const latest = await getLatestCompat();
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json(compatBadge(latest));
  } catch (error) {
    log.error('[COMPAT] Could not build the badge', error);
    return res.status(500).json({ success: false, error: 'Could not read compatibility' });
  }
});

export default router;
