/**
 * Check-in before each match (services/matchCheckIns.ts).
 *
 * GET  /:slug                    public: open, closes at, both teams with who checked in
 * POST /:slug                    the viewer checks in
 * POST /:slug/:teamId/:steamId   the team's owner or a captain checks in a player
 * GET  /:slug/full-team          public: the "Getting on the server" deadline and walkover choice
 * POST /:slug/walkover           the complete team's owner or a captain: { take } walkover or play
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../utils/logger';
import { resolveViewerAccount } from '../utils/viewerIdentity';
import { SignupError } from '../services/tournamentSignupService';
import { checkInForMatch, matchCheckInState } from '../services/matchCheckIns';
import { chooseWalkover, fullTeamState } from '../services/walkoverOffers';

const router = Router();

function fail(res: Response, error: unknown) {
  if (error instanceof SignupError) {
    return res
      .status(error.status)
      .json({ success: false, error: error.message, code: error.code });
  }
  log.error('[MATCH CHECK-IN] failed', { error });
  return res.status(500).json({ success: false, error: 'Could not check in' });
}

/**
 * @openapi
 * /api/match-check-in/{slug}:
 *   get:
 *     tags:
 *       - Match check-in
 *     summary: Check-in for one match (public)
 *     description: When the tournament checks in before each match; null otherwise. Subs always count as checked in.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ state: { open, closesAt, teams } | null }" }
 */
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, state: await matchCheckInState(req.params.slug) });
  } catch (error) {
    return fail(res, error);
  }
});

/**
 * @openapi
 * /api/match-check-in/{slug}:
 *   post:
 *     tags:
 *       - Match check-in
 *     summary: Check in for this match
 *     description: A starter in one of the match's lineups, between the veto opening and the start.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Checked in }
 *       401: { description: Not signed in }
 *       409: { description: Not open }
 */
router.post('/:slug', async (req: Request, res: Response) => {
  try {
    const viewer = await resolveViewerAccount(req);
    if (!viewer.playerId) return res.status(401).json({ success: false, error: 'Sign in first' });
    await checkInForMatch(req.params.slug, viewer.playerId);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
});

/**
 * @openapi
 * /api/match-check-in/{slug}/{teamId}/{steamId}:
 *   post:
 *     tags:
 *       - Match check-in
 *     summary: Check in a teammate for this match
 *     description: The team's owner or a captain, when the tournament lets captains check in (settings.captainCheckIn).
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: steamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Checked in }
 *       403: { description: Not a captain of that team }
 */
router.post('/:slug/:teamId/:steamId', async (req: Request, res: Response) => {
  try {
    const viewer = await resolveViewerAccount(req);
    if (!viewer.uid) return res.status(401).json({ success: false, error: 'Sign in first' });
    await checkInForMatch(req.params.slug, req.params.steamId, {
      uid: viewer.uid,
      teamId: req.params.teamId,
    });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
});

/**
 * @openapi
 * /api/match-check-in/{slug}/full-team:
 *   get:
 *     tags:
 *       - Match check-in
 *     summary: Getting on the server (public)
 *     description: While the match is loaded, when each team must have a full team on the server (settings.fullTeamMinutes); and the walkover choice once one team was short.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ state: { deadline, size, teams, offer } | null }" }
 */
router.get('/:slug/full-team', async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, state: await fullTeamState(req.params.slug) });
  } catch (error) {
    return fail(res, error);
  }
});

/**
 * @openapi
 * /api/match-check-in/{slug}/walkover:
 *   post:
 *     tags:
 *       - Match check-in
 *     summary: Take the walkover, or play them short
 *     description: The complete team's owner or a captain, within two minutes of the time running out. No choice in time is a walkover.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               take: { type: boolean }
 *     responses:
 *       200: { description: Chosen }
 *       403: { description: Not a captain of the complete team }
 *       409: { description: Nothing to choose }
 */
router.post('/:slug/walkover', async (req: Request, res: Response) => {
  try {
    const viewer = await resolveViewerAccount(req);
    if (!viewer.uid) return res.status(401).json({ success: false, error: 'Sign in first' });
    if (typeof req.body?.take !== 'boolean') {
      return res.status(400).json({ success: false, error: 'take must be true or false' });
    }
    await chooseWalkover(req.params.slug, viewer.uid, req.body.take);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
});

export default router;
