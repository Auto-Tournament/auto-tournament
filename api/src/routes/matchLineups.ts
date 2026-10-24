/**
 * Match lineups (services/matchLineups.ts): who plays a match for a team
 * whose roster is bigger than the team size.
 *
 * GET /:slug        public: each such team's pool and lineup, and whether the viewer may change it
 * PUT /:slug/:side  the team's owner or a captain (any member without one), or an admin
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../utils/logger';
import { resolveViewerAccount } from '../utils/viewerIdentity';
import { checkAdminAccess } from '../middleware/auth';
import { isSameSiteRequest } from '../utils/accountConnections';
import {
  LineupError,
  getMatchLineups,
  setMatchLineup,
  type LineupViewer,
} from '../services/matchLineups';

const router = Router();

async function viewerOf(req: Request, asAdmin: boolean): Promise<LineupViewer> {
  const account = await resolveViewerAccount(req);
  const admin = asAdmin
    ? (await checkAdminAccess(req)).ok
    : account.isAdmin && !account.isImpersonating;
  return { uid: account.uid, steamId: account.playerId, admin };
}

function fail(res: Response, error: unknown, what: string) {
  if (error instanceof LineupError) {
    return res
      .status(error.status)
      .json({ success: false, error: error.message, code: error.code });
  }
  log.error(`[LINEUP] ${what} failed`, { error });
  return res.status(500).json({ success: false, error: `Could not ${what}` });
}

/**
 * @openapi
 * /api/match-lineups/{slug}:
 *   get:
 *     tags:
 *       - Match lineups
 *     summary: Who plays the match for each team bigger than the team size
 *     description: |
 *       Public. Only teams whose roster (or signed-up lineup) has more players
 *       than the team size are listed, each with its pool, the `size` players
 *       who play (`players`), where that came from (`set`, `previous` match,
 *       `roster` order) and whether the viewer may change it (`canEdit`).
 *       `open`: lineups can change now (before go-live, or between maps).
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: The lineups }
 *       404: { description: No such match }
 */
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const lineups = await getMatchLineups(req.params.slug, await viewerOf(req, false));
    return res.json({ success: true, ...lineups });
  } catch (error) {
    return fail(res, error, 'read the lineups');
  }
});

/**
 * @openapi
 * /api/match-lineups/{slug}/{side}:
 *   put:
 *     tags:
 *       - Match lineups
 *     summary: Pick who plays the match for a team
 *     description: |
 *       The team's owner or a captain (any member of a team with neither);
 *       an admin with `asAdmin: true` for either team. Before the match goes
 *       live, or between maps. `players` are exactly `size` Steam IDs from the
 *       pool. A match on a Ready Up server gets the new roster at once;
 *       `serverSync` says whether it took it (the lineup is saved either way).
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: side
 *         required: true
 *         schema: { type: string, enum: [team1, team2] }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               players: { type: array, items: { type: string } }
 *               asAdmin: { type: boolean }
 *     responses:
 *       200: { description: Saved }
 *       400: { description: Not `size` players from the pool }
 *       403: { description: Not the team's captain, or not an admin }
 *       409: { description: Locked (live), or the team has no lineup to pick }
 */
router.put('/:slug/:side', async (req: Request, res: Response) => {
  // Cookie-signed writes only from this site (the session cookie is Lax, so this is for sibling origins).
  if (!isSameSiteRequest(req) && !req.headers.authorization) {
    return res.status(403).json({ success: false, error: 'Request refused' });
  }
  try {
    const side = req.params.side;
    if (side !== 'team1' && side !== 'team2') {
      return res.status(400).json({ success: false, error: 'side must be team1 or team2' });
    }
    const asAdmin = req.body?.asAdmin === true;
    const viewer = await viewerOf(req, asAdmin);
    if (asAdmin && !viewer.admin) {
      return res.status(403).json({ success: false, error: 'Only an admin can do that.' });
    }
    if (!viewer.admin && !viewer.uid && !viewer.steamId) {
      return res.status(401).json({ success: false, error: 'Sign in first' });
    }
    const result = await setMatchLineup(req.params.slug, side, req.body?.players, viewer);
    return res.json({ success: true, ...result.lineups, serverSync: result.serverSync });
  } catch (error) {
    return fail(res, error, 'set the lineup');
  }
});

export default router;
