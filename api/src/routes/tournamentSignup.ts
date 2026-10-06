/**
 * Tournament sign-up for players: teams sign themselves up with a lineup, and
 * lineup players check in on the day.
 *
 * GET    /:id                         public: the windows and every signed-up team
 * GET    /:id/me                      signed in: the teams you can sign up
 * POST   /:id/register                owner or captain: sign a team up
 * PUT    /:id/lineup                  owner or captain: change the lineup
 * DELETE /:id/registration/:teamId    owner or captain: withdraw
 * POST   /:id/check-in                a lineup player: "I'm here"
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../utils/logger';
import { resolveViewerAccount } from '../utils/viewerIdentity';
import { SignupError, tournamentSignupService } from '../services/tournamentSignupService';
import { readableTournamentId } from '../services/currentTournament';

const router = Router();

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Runs a sign-up action for the tournament in the URL, with or without a signed-in account. */
function signupAction(
  action: (tournamentId: number, viewer: { uid: string | null; steamId: string | null }, req: Request) => Promise<unknown>,
  { signIn = true }: { signIn?: boolean } = {}
) {
  return async (req: Request, res: Response) => {
    try {
      // The tournament in the URL, any that exists (several can take sign-ups at once).
      const tournamentId = await readableTournamentId(req.params.id);
      if (tournamentId === null) {
        return res.status(404).json({ success: false, error: 'No such tournament' });
      }
      const viewer = await resolveViewerAccount(req);
      if (signIn) {
        if (!viewer.uid || !viewer.playerId) {
          return res.status(401).json({ success: false, error: 'Sign in first' });
        }
        if (viewer.isImpersonating) {
          return res.status(403).json({ success: false, error: 'Stop impersonating to act for a team.' });
        }
      }
      const result = await action(tournamentId, { uid: viewer.uid, steamId: viewer.playerId }, req);
      return res.json({ success: true, ...(result && typeof result === 'object' ? result : {}) });
    } catch (error) {
      if (error instanceof SignupError) {
        return res.status(error.status).json({ success: false, error: error.message, code: error.code });
      }
      log.error('[TournamentSignup] Action failed', { error, path: req.path });
      return res.status(500).json({ success: false, error: 'The sign-up action failed' });
    }
  };
}

/**
 * @openapi
 * /api/tournament-signup/{id}:
 *   get:
 *     tags:
 *       - Tournament sign-up
 *     summary: Sign-up and check-in windows, and every signed-up team (public)
 *     description: |
 *       No session. The windows from the tournament settings and each
 *       signed-up team with its lineup: starters and subs, rating, what each
 *       player still has to fix (`noAccount`, `noGame`) and when they checked in.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: The windows and the teams }
 *       404: { description: No such tournament }
 */
router.get(
  '/:id',
  signupAction(
    async (tournamentId) => ({
      window: await tournamentSignupService.window(tournamentId),
      registrations: await tournamentSignupService.registrations(tournamentId),
    }),
    { signIn: false }
  )
);

/**
 * @openapi
 * /api/tournament-signup/{id}/me:
 *   get:
 *     tags:
 *       - Tournament sign-up
 *     summary: The teams the signed-in player can sign up
 *     description: Teams the player owns or captains, each with its roster.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: The teams }
 *       401: { description: Not signed in }
 */
router.get(
  '/:id/me',
  signupAction(async (tournamentId, viewer) => ({
    steamId: viewer.steamId,
    teams: await tournamentSignupService.eligibleTeams(viewer.uid as string, tournamentId),
  }))
);

/**
 * @openapi
 * /api/tournament-signup/{id}/remind:
 *   post:
 *     tags:
 *       - Tournament sign-up
 *     summary: Remind a lineup player what to fix before check-in
 *     description: Owner or captain. Posts a line in the team's chat naming what is missing (an account, or the game on their profile). Once per player per ten minutes.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Reminded }
 *       409: { description: Nothing to fix }
 *       429: { description: Reminded a moment ago }
 */
router.post(
  '/:id/remind',
  signupAction(async (tournamentId, viewer, req) => {
    const body = (req.body ?? {}) as { teamId?: unknown; steamId?: unknown };
    if (typeof body.teamId !== 'string' || typeof body.steamId !== 'string') {
      throw new SignupError(400, 'teamId and steamId are required.', 'invalid');
    }
    await tournamentSignupService.remind(tournamentId, viewer.uid as string, { teamId: body.teamId, steamId: body.steamId });
    return { reminded: true };
  })
);

/**
 * @openapi
 * /api/tournament-signup/{id}/register:
 *   post:
 *     tags:
 *       - Tournament sign-up
 *     summary: Sign a team up with its lineup
 *     description: |
 *       The team's owner or a captain. `starters` must be exactly the
 *       tournament's team size and `subs` at most two, all from the team's
 *       roster. `acceptRules` confirms every player has read the rules.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [teamId, starters, acceptRules]
 *             properties:
 *               teamId: { type: string }
 *               starters: { type: array, items: { type: string } }
 *               subs: { type: array, items: { type: string } }
 *               acceptRules: { type: boolean }
 *     responses:
 *       200: { description: Signed up }
 *       400: { description: The lineup or the rules confirmation is wrong }
 *       403: { description: Not the owner or a captain }
 *       409: { description: Sign-up is closed, full, or the team is already in }
 */
router.post(
  '/:id/register',
  signupAction(async (tournamentId, viewer, req) => {
    await tournamentSignupService.register(tournamentId, viewer.uid as string, {
      teamId: String(req.body?.teamId ?? ''),
      starters: idList(req.body?.starters),
      subs: idList(req.body?.subs),
      acceptRules: req.body?.acceptRules === true,
    });
    return {};
  })
);

/**
 * @openapi
 * /api/tournament-signup/{id}/lineup:
 *   put:
 *     tags:
 *       - Tournament sign-up
 *     summary: Change a signed-up team's lineup
 *     description: The owner or a captain, until check-in closes.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               teamId: { type: string }
 *               starters: { type: array, items: { type: string } }
 *               subs: { type: array, items: { type: string } }
 *     responses:
 *       200: { description: Changed }
 *       409: { description: Locked after check-in }
 */
router.put(
  '/:id/lineup',
  signupAction(async (tournamentId, viewer, req) => {
    await tournamentSignupService.changeLineup(tournamentId, viewer.uid as string, {
      teamId: String(req.body?.teamId ?? ''),
      starters: idList(req.body?.starters),
      subs: idList(req.body?.subs),
    });
    return {};
  })
);

/**
 * @openapi
 * /api/tournament-signup/{id}/registration/{teamId}:
 *   delete:
 *     tags:
 *       - Tournament sign-up
 *     summary: Withdraw a team
 *     description: The owner or a captain, before the tournament starts.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Withdrawn }
 *       409: { description: The tournament has started }
 */
router.delete(
  '/:id/registration/:teamId',
  signupAction(async (tournamentId, viewer, req) => {
    await tournamentSignupService.withdraw(tournamentId, viewer.uid as string, req.params.teamId);
    return {};
  })
);

/**
 * @openapi
 * /api/tournament-signup/{id}/check-in:
 *   post:
 *     tags:
 *       - Tournament sign-up
 *     summary: Check in ("I'm here")
 *     description: A player in a lineup, inside the check-in window.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Checked in }
 *       403: { description: Not in a lineup }
 *       409: { description: Check-in is not open }
 */
router.post(
  '/:id/check-in',
  signupAction(async (tournamentId, viewer) => {
    await tournamentSignupService.checkIn(tournamentId, viewer.steamId as string);
    return {};
  })
);

export default router;
