/**
 * Notable moments for integrators (../demos/momentStore.ts).
 *
 *   GET  /api/integrations/highlights          the moments, oldest change first (integrator token)
 *   POST /api/game/cs2/moments/backfill        find them on maps analyzed before (admin)
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth, requireIntegratorAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { settingsService } from '../../../services/settingsService';
import { backfillMoments, LIST_MAX, listMoments } from '../demos/momentStore';
import { MOMENT_KINDS } from '../demos/moments';
import type { Untrusted } from '../../../utils/untrusted';

/** The platform's address (Settings → webhook URL), for absolute links; null without it. */
async function platformOrigin(): Promise<string | null> {
  const base = await settingsService.getWebhookUrl().catch(() => null);
  try {
    return base ? new URL(base).origin : null;
  } catch {
    return null;
  }
}

export const integrationHighlightsRouter = Router();

integrationHighlightsRouter.use(requireIntegratorAuth);

/**
 * @openapi
 * /api/integrations/highlights:
 *   get:
 *     tags: [Integrations: highlights]
 *     summary: Notable moments from the demos, oldest change first
 *     description: |
 *       One row per moment the demo analysis found in a real round (no warmup,
 *       no knife round, never a kill on a teammate or a bot): `knife_kill`,
 *       `zeus_kill`, `ace`, `clutch_1vN` (`detail.against` = N ≥ 3),
 *       `noscope_kill`, `grenade_kill` (HE, molotov, incendiary) and
 *       `bomb_defuse_last_second` (`detail.secondsLeft` < 1). Imported
 *       matches are included (`imported: true`).
 *
 *       `id` is the same on every re-parse. A moment a re-parse no longer
 *       finds, or one of a deleted match, comes back with `revoked: true`.
 *       Every change moves the moment to the end of the list: poll with
 *       `since=<nextCursor>` and apply rows by `id`.
 *
 *       Integrator token (API_TOKENS_INTEGRATOR), read-only or admin token,
 *       or an admin session.
 *     parameters:
 *       - in: query
 *         name: since
 *         schema: { type: string }
 *         description: The `nextCursor` of the last page; from the start without it.
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 1000, default: 500 }
 *       - in: query
 *         name: tournament
 *         schema: { type: integer }
 *         description: Only this tournament's matches (and played matches kept from it).
 *       - in: query
 *         name: match
 *         schema: { type: string }
 *         description: Only this match (slug).
 *       - in: query
 *         name: kind
 *         schema: { type: string }
 *         description: Only these kinds, comma-separated.
 *     responses:
 *       200:
 *         description: A page of moments, and the cursor for the next one.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 highlights:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, example: hl_3f9a0c1b2d4e5f6a7b8c9d0e }
 *                       kind: { type: string, example: knife_kill }
 *                       matchSlug: { type: string, example: t4-swiss-r3m3 }
 *                       tournament:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           id: { type: integer, nullable: true, description: null for an imported match }
 *                           name: { type: string }
 *                       mapNumber: { type: integer, description: 1-based, example: 1 }
 *                       map: { type: string, nullable: true, example: de_mirage }
 *                       round: { type: integer, example: 7 }
 *                       tick: { type: integer, example: 51234 }
 *                       playedAt: { type: string, format: date-time, nullable: true, description: Estimated from the map's end; null for an imported match }
 *                       player:
 *                         type: object
 *                         properties:
 *                           steamId64: { type: string }
 *                           name: { type: string, nullable: true }
 *                       victim:
 *                         type: object
 *                         nullable: true
 *                         properties:
 *                           steamId64: { type: string }
 *                           name: { type: string, nullable: true }
 *                       weapon: { type: string, nullable: true, example: Knife }
 *                       detail: { type: object, additionalProperties: true }
 *                       clipUrl: { type: string, nullable: true, description: The recorded clip of the player's round, when there is one }
 *                       replayUrl: { type: string, nullable: true, description: The map's 2D replay at that round }
 *                       imported: { type: boolean }
 *                       revoked: { type: boolean }
 *                       revokedReason: { type: string, nullable: true }
 *                       updatedAt: { type: string, format: date-time }
 *                 nextCursor: { type: string }
 *                 hasMore: { type: boolean }
 *       400: { description: A bad parameter }
 *       401: { description: No or a wrong token }
 */
integrationHighlightsRouter.get('/', async (req: Request, res: Response) => {
  const q = req.query;
  const str = (v: Untrusted) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const since = str(q.since);
  if (since !== undefined && !/^\d{1,18}$/.test(since)) {
    return res
      .status(400)
      .json({ success: false, error: 'since must be a nextCursor from an earlier page' });
  }
  const limit = q.limit === undefined ? undefined : Number(q.limit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= LIST_MAX)) {
    return res.status(400).json({ success: false, error: `limit must be 1 to ${LIST_MAX}` });
  }
  const tournament = q.tournament === undefined ? undefined : Number(q.tournament);
  if (tournament !== undefined && !(Number.isInteger(tournament) && tournament > 0)) {
    return res.status(400).json({ success: false, error: 'tournament must be a tournament id' });
  }
  const kinds = str(q.kind)
    ?.split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const unknown = kinds?.filter((k) => !(MOMENT_KINDS as readonly string[]).includes(k));
  if (unknown?.length) {
    return res.status(400).json({
      success: false,
      error: `Unknown kind ${unknown.join(', ')}; one of ${MOMENT_KINDS.join(', ')}`,
    });
  }
  try {
    const page = await listMoments(
      { since, limit, tournament, match: str(q.match), kinds },
      await platformOrigin()
    );
    return res.json({ success: true, ...page });
  } catch (error) {
    log.error('[Integrations] Highlights API failed', error);
    return res.status(500).json({ success: false, error: 'Could not read the highlights' });
  }
});

export const momentAdminRouter = Router();

/**
 * @openapi
 * /api/game/cs2/moments/backfill:
 *   post:
 *     tags: [Integrations: highlights]
 *     summary: Find the notable moments of maps analyzed before (admin)
 *     description: |
 *       Reads the kill feeds and 2D replays already stored for each analyzed
 *       map and stores its moments (GET /api/integrations/highlights). No demo
 *       is read again. Safe to run more than once: a moment keeps its id, and
 *       one no longer found is revoked. `dryRun: true` stores nothing and
 *       returns what it would find.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               match: { type: string, description: Only this match (slug) }
 *               tournament: { type: integer, description: Only this tournament's matches }
 *               imported: { type: boolean, description: Only imported matches }
 *               dryRun: { type: boolean }
 *     responses:
 *       200: { description: "Maps read, moments found by kind, rows created, updated, revoked; the knife kills" }
 *       400: { description: A bad parameter }
 */
momentAdminRouter.post('/moments/backfill', requireAuth, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, Untrusted>;
  const match = typeof body.match === 'string' && body.match.trim() ? body.match.trim() : undefined;
  const tournament = body.tournament === undefined ? undefined : Number(body.tournament);
  if (tournament !== undefined && !(Number.isInteger(tournament) && tournament > 0)) {
    return res.status(400).json({ success: false, error: 'tournament must be a tournament id' });
  }
  try {
    const result = await backfillMoments({
      match,
      tournament,
      imported: body.imported === true,
      dryRun: body.dryRun === true,
    });
    log.info('[MOMENTS] Backfill', {
      maps: result.maps,
      created: result.created,
      updated: result.updated,
      revoked: result.revoked,
      dryRun: body.dryRun === true,
    });
    return res.json({ success: true, dryRun: body.dryRun === true, ...result });
  } catch (error) {
    log.error('[MOMENTS] Backfill failed', error);
    return res.status(500).json({ success: false, error: 'The backfill failed' });
  }
});
