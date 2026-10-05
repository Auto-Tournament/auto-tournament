/**
 * Matchmaking (docs/design/matchmaking.md). Experimental: every route here
 * answers 404 until the `matchmaking` feature is on. Admins only until an
 * admin opens it to players (`mm_open_to_players`).
 *
 * Phase 1: parties, the queue, accept / decline and cooldowns. Writes are
 * same-site JSON, by the signed-in player; no player ids in bodies.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requestActorId } from '../middleware/auth';
import { requireExperimentalFeature } from '../services/experimentalFeatures';
import { resolveViewerIdentity } from '../utils/viewerIdentity';
import { isSameSiteRequest } from '../utils/accountConnections';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { matchmakingService, MatchmakingError } from '../services/matchmaking/matchmakingService';
import { MODES } from '../services/matchmaking/rules';
import { progressionService, ProgressionError } from '../services/matchmaking/progressionService';

const router = Router();

/** Setting: '1' lets every signed-in player use matchmaking, not just admins. */
export const MM_OPEN_TO_PLAYERS = 'mm_open_to_players';

type PlayerRequest = Request & { mmPlayerId?: string };

// The flag first: while it is off, even an anonymous caller gets a 404.
router.use(requireExperimentalFeature('matchmaking'));

/** A signed-in player (not an API token). Admins always; others once matchmaking is open to players. */
async function requirePlayer(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identity = await resolveViewerIdentity(req);
  if (!identity.realSteamId) {
    res.status(401).json({ success: false, error: 'Sign in to use matchmaking' });
    return;
  }
  if (identity.isImpersonating) {
    res.status(403).json({ success: false, error: 'Stop impersonating to use matchmaking' });
    return;
  }
  if (!identity.isRealAdmin && (await db.getAppSettingAsync(MM_OPEN_TO_PLAYERS)) !== '1') {
    res.status(403).json({ success: false, error: 'Matchmaking is not open to players yet' });
    return;
  }
  (req as PlayerRequest).mmPlayerId = identity.realSteamId;
  next();
}

function sameSiteJson(req: Request, res: Response, next: NextFunction): void {
  if (!isSameSiteRequest(req)) {
    res.status(403).json({ success: false, error: 'Request refused' });
    return;
  }
  if (!req.is('application/json')) {
    res.status(415).json({ success: false, error: 'Send this request as JSON' });
    return;
  }
  next();
}

const me = (req: Request) => (req as PlayerRequest).mmPlayerId!;

/** Wrap a handler: MatchmakingError → its status, anything else → 500. */
function handle(what: string, fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      return await fn(req, res);
    } catch (error) {
      if (error instanceof MatchmakingError) {
        return res.status(error.status).json({ success: false, code: error.code, error: error.message });
      }
      if (error instanceof ProgressionError) {
        return res.status(error.status).json({ success: false, error: error.message });
      }
      log.error(`[MATCHMAKING] ${what} failed`, error as Error);
      return res.status(500).json({ success: false, error: `Could not ${what}` });
    }
  };
}

/**
 * @openapi
 * /api/matchmaking/status:
 *   get:
 *     tags: [Matchmaking]
 *     summary: Matchmaking status (experimental)
 *     description: |
 *       404 unless the experimental `matchmaking` feature is on. Admin only.
 *       Which modes exist and whether players may use it yet.
 *     responses:
 *       200:
 *         description: Matchmaking is on
 *       404:
 *         description: Matchmaking is off
 */
router.get(
  '/status',
  requireAuth,
  handle('read the status', async (_req, res) => {
    const open = (await db.getAppSettingAsync(MM_OPEN_TO_PLAYERS)) === '1';
    return res.json({ success: true, enabled: true, modes: MODES, openToPlayers: open });
  })
);

/**
 * @openapi
 * /api/matchmaking/me:
 *   get:
 *     tags: [Matchmaking]
 *     summary: My party, search, match and cooldown (experimental)
 *     description: |
 *       404 unless matchmaking is on. A signed-in player; admins only until
 *       matchmaking is open to players.
 *     responses:
 *       200:
 *         description: The caller's matchmaking state
 *       401:
 *         description: Not signed in
 *       403:
 *         description: Not open to players yet, or impersonating
 */
router.get(
  '/me',
  requirePlayer,
  handle('read your matchmaking state', async (req, res) => {
    return res.json({ success: true, ...(await matchmakingService.me(me(req))) });
  })
);

/**
 * @openapi
 * /api/matchmaking/party:
 *   post:
 *     tags: [Matchmaking]
 *     summary: Create a party (experimental)
 *     description: Same-site JSON. Returns the caller's party (a new one with them as leader, or the one they are in) and its invite code.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mode: { type: string, example: 5v5 }
 *     responses:
 *       200:
 *         description: The party
 *       400:
 *         description: Unknown mode
 */
router.post(
  '/party',
  requirePlayer,
  sameSiteJson,
  handle('create the party', async (req, res) => {
    await matchmakingService.createParty(me(req), req.body?.mode ?? '5v5');
    return res.json({ success: true, ...(await matchmakingService.me(me(req))) });
  })
);

/**
 * @openapi
 * /api/matchmaking/party/join:
 *   post:
 *     tags: [Matchmaking]
 *     summary: Join a party by invite code (experimental)
 *     description: Same-site JSON. Leaves the caller's current party first.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200:
 *         description: Joined
 *       404:
 *         description: No party with that code
 *       409:
 *         description: The party is full or searching, or the caller is in a match being accepted
 */
router.post(
  '/party/join',
  requirePlayer,
  sameSiteJson,
  handle('join the party', async (req, res) => {
    await matchmakingService.joinParty(me(req), req.body?.code);
    return res.json({ success: true, ...(await matchmakingService.me(me(req))) });
  })
);

/**
 * @openapi
 * /api/matchmaking/party/leave:
 *   post:
 *     tags: [Matchmaking]
 *     summary: Leave the party (experimental)
 *     description: Same-site JSON. The leader leaving disbands the party. Stops a search.
 *     responses:
 *       200:
 *         description: Left
 *       409:
 *         description: In a match being accepted
 */
router.post(
  '/party/leave',
  requirePlayer,
  sameSiteJson,
  handle('leave the party', async (req, res) => {
    await matchmakingService.leaveParty(me(req));
    return res.json({ success: true });
  })
);

/**
 * @openapi
 * /api/matchmaking/queue:
 *   post:
 *     tags: [Matchmaking]
 *     summary: Start searching (experimental)
 *     description: Same-site JSON. Party leader only (a solo player gets a party of one). Refused while a party member is on cooldown.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mode: { type: string, example: 5v5 }
 *     responses:
 *       200:
 *         description: Searching
 *       403:
 *         description: Not the party leader
 *       409:
 *         description: Cooldown, or the party is too big for the mode
 *   delete:
 *     tags: [Matchmaking]
 *     summary: Stop searching (experimental)
 *     description: Same-site JSON. Party leader only.
 *     responses:
 *       200:
 *         description: Stopped
 *       409:
 *         description: In a match being accepted
 */
router.post(
  '/queue',
  requirePlayer,
  sameSiteJson,
  handle('start the search', async (req, res) => {
    await matchmakingService.startSearch(me(req), req.body?.mode ?? '5v5');
    return res.json({ success: true, ...(await matchmakingService.me(me(req))) });
  })
);

router.delete(
  '/queue',
  requirePlayer,
  sameSiteJson,
  handle('stop the search', async (req, res) => {
    await matchmakingService.stopSearch(me(req));
    return res.json({ success: true });
  })
);

/**
 * @openapi
 * /api/matchmaking/lobbies/{id}/accept:
 *   post:
 *     tags: [Matchmaking]
 *     summary: Accept a found match (experimental)
 *     description: Same-site JSON. Only a player in that match, before the deadline.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Accepted; `status` is `ready` once everyone has
 *       404:
 *         description: No such match for the caller
 *       409:
 *         description: The match is no longer waiting for answers
 */
router.post(
  '/lobbies/:id/accept',
  requirePlayer,
  sameSiteJson,
  handle('accept the match', async (req, res) => {
    const result = await matchmakingService.accept(me(req), req.params.id);
    return res.json({ success: true, ...result });
  })
);

/**
 * @openapi
 * /api/matchmaking/lobbies/{id}/decline:
 *   post:
 *     tags: [Matchmaking]
 *     summary: Decline a found match (experimental)
 *     description: |
 *       Same-site JSON. The caller gets a cooldown and their party leaves the
 *       queue; every other party goes back to the front of the queue.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Declined
 *       404:
 *         description: No such match for the caller
 *       409:
 *         description: The match is no longer waiting for answers
 */
router.post(
  '/lobbies/:id/decline',
  requirePlayer,
  sameSiteJson,
  handle('decline the match', async (req, res) => {
    await matchmakingService.decline(me(req), req.params.id);
    return res.json({ success: true });
  })
);

/**
 * @openapi
 * /api/matchmaking/lobbies/{id}:
 *   get:
 *     tags: [Matchmaking]
 *     summary: The match room (experimental)
 *     description: Only a player in that match. Teams with names and who accepted, the map, and the match once it exists.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The lobby
 *       404:
 *         description: No such match for the caller
 */
router.get(
  '/lobbies/:id',
  requirePlayer,
  handle('read the match', async (req, res) => {
    return res.json({ success: true, lobby: await matchmakingService.lobbyView(me(req), req.params.id) });
  })
);

/**
 * @openapi
 * /api/matchmaking/matches/{slug}/result:
 *   get:
 *     tags: [Matchmaking]
 *     summary: The post-match screen (experimental)
 *     description: Only a player of that match. Map scores, the scoreboard, the caller's rating change, XP breakdown and level, and the commends they gave.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The result
 *       404:
 *         description: No such match for the caller
 */
router.get(
  '/matches/:slug/result',
  requirePlayer,
  handle('read the result', async (req, res) => {
    return res.json({ success: true, result: await progressionService.result(me(req), req.params.slug) });
  })
);

/**
 * @openapi
 * /api/matchmaking/matches/{slug}/commends/{playerId}:
 *   put:
 *     tags: [Matchmaking]
 *     summary: Thumbs up or down for a player of the same match (experimental)
 *     description: |
 *       Same-site JSON, within 24 hours of the match ending. Body `{ value: 1, tag? }`
 *       (tag: friendly, team_player, leader, good_comms) or `{ value: -1, tag }`
 *       (tag: toxic, griefing, afk, other). Sending again changes it.
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: playerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Saved
 *       400:
 *         description: Bad value or tag, or yourself
 *       404:
 *         description: Not both in that match
 *       409:
 *         description: The match has not ended, or the 24 hours are over
 */
router.put(
  '/matches/:slug/commends/:playerId',
  requirePlayer,
  sameSiteJson,
  handle('save the commend', async (req, res) => {
    const saved = await progressionService.commend(me(req), req.params.slug, req.params.playerId, req.body);
    return res.json({ success: true, ...saved });
  })
);

/**
 * @openapi
 * /api/matchmaking/players/{id}/progress:
 *   get:
 *     tags: [Matchmaking]
 *     summary: A player's level, XP and commends (experimental)
 *     description: 404 while matchmaking is off. Level, XP into the level, thumbs up and down totals and the most given tags; never who gave them.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The progress
 */
router.get(
  '/players/:id/progress',
  handle('read the progress', async (req, res) => {
    return res.json({ success: true, progress: await progressionService.progress(req.params.id) });
  })
);

/**
 * @openapi
 * /api/matchmaking/admin/players/{id}/xp:
 *   post:
 *     tags: [Matchmaking]
 *     summary: Add or remove XP by hand (experimental)
 *     description: Admin, same-site JSON. Body `{ amount, note }`; the total never goes below 0.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Saved
 *       400:
 *         description: amount is not a whole number other than 0
 */
router.post(
  '/admin/players/:id/xp',
  requireAuth,
  sameSiteJson,
  handle('adjust the XP', async (req, res) => {
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    await progressionService.adjustXp(req.params.id, Number(req.body?.amount), note);
    log.info(`[AUDIT] ${req.body?.amount} XP for ${req.params.id} by ${requestActorId(req) ?? 'unknown'}: ${note}`);
    return res.json({ success: true, progress: await progressionService.progress(req.params.id) });
  })
);

/**
 * @openapi
 * /api/matchmaking/admin/settings:
 *   put:
 *     tags: [Matchmaking]
 *     summary: Matchmaking settings (experimental)
 *     description: Admin. `openToPlayers` lets every signed-in player use matchmaking.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               openToPlayers: { type: boolean }
 *     responses:
 *       200:
 *         description: Saved
 *       400:
 *         description: openToPlayers is not a boolean
 */
router.put(
  '/admin/settings',
  requireAuth,
  sameSiteJson,
  handle('save the settings', async (req, res) => {
    const open = req.body?.openToPlayers;
    if (typeof open !== 'boolean') return res.status(400).json({ success: false, error: 'openToPlayers must be a boolean' });
    await db.setAppSettingAsync(MM_OPEN_TO_PLAYERS, open ? '1' : null);
    log.info(`[AUDIT] Matchmaking ${open ? 'opened to players' : 'closed to players'} by ${requestActorId(req) ?? 'unknown'}`);
    return res.json({ success: true, openToPlayers: open });
  })
);

/**
 * @openapi
 * /api/matchmaking/admin/players/{id}/cooldown:
 *   delete:
 *     tags: [Matchmaking]
 *     summary: Clear a player's matchmaking cooldown (experimental)
 *     description: Admin, same-site JSON.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Cleared; `cleared` is how many penalties were lifted
 */
router.delete(
  '/admin/players/:id/cooldown',
  requireAuth,
  sameSiteJson,
  handle('clear the cooldown', async (req, res) => {
    const admin = requestActorId(req) ?? 'admin';
    const cleared = await matchmakingService.clearCooldown(req.params.id, admin);
    log.info(`[AUDIT] Matchmaking cooldown of ${req.params.id} cleared by ${admin} (${cleared})`);
    return res.json({ success: true, cleared });
  })
);

export default router;
