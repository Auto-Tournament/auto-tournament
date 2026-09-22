import { Router, Request, Response } from 'express';
import { validateServerToken } from '../../../middleware/serverAuth';
import { getUpdateHoldStatus } from '../services/updateHoldService';
import { resolveTournamentId } from '../../../utils/tournamentRow';
import { log } from '../../../utils/logger';

/**
 * The update hold CS2 Server Manager (csm) polls.
 *
 * **Why csm asks instead of MAT telling it.** A game host runs csm behind
 * whatever firewall the provider gives it and usually behind NAT; MAT has no
 * route in and no address to push to. Polling needs no inbound port on the
 * game server, no listener in csm and no service discovery. It also fails in
 * the right direction: csm holds updates whenever it cannot get an answer,
 * which a push cannot express — a push that never arrives looks exactly like
 * "nothing to say".
 *
 * **Credential.** The fleet-wide `SERVER_TOKEN`, presented as
 * `X-MatchZy-Token`, the same one the host's servers already use for event
 * ingest, demo upload and `GET /api/servers/:id/bootstrap`. No new secret.
 * The endpoint is read-only and returns no roster, score or address, so
 * widening that token's reach here costs nothing.
 */
const router = Router();

/**
 * @openapi
 * /api/servers/update-hold:
 *   get:
 *     tags:
 *       - Servers
 *     summary: Whether game hosts should pause automatic CS2 updates
 *     description: >
 *       Polled by CS2 Server Manager before it restarts an idle server for a
 *       Valve update. The hold is on while any match is loaded or live, and
 *       while the tournament is in progress — MAT's allocator may give any
 *       enabled server the next match at any moment, so the answer is
 *       fleet-wide. Requires the game server token (`X-MatchZy-Token`).
 *     security:
 *       - matchzyServerToken: []
 *     responses:
 *       200:
 *         description: The current hold state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 hold:
 *                   type: boolean
 *                   description: True when automatic updates must not restart a server.
 *                 reason:
 *                   type: string
 *                   description: One sentence explaining the answer, for the csm monitor log.
 *                 tournamentStatus:
 *                   type: string
 *                   nullable: true
 *                 activeMatches:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       slug:
 *                         type: string
 *                       serverId:
 *                         type: string
 *                         nullable: true
 *                       status:
 *                         type: string
 *                 checkedAt:
 *                   type: integer
 *                   description: Unix seconds when the answer was computed.
 *       401:
 *         description: Missing or invalid server token
 *       500:
 *         description: The hold could not be determined
 */
router.get('/update-hold', validateServerToken, async (req: Request, res: Response) => {
  try {
    const status = await getUpdateHoldStatus(resolveTournamentId(req));
    return res.json({ success: true, ...status });
  } catch (error) {
    // csm treats any non-200 as "hold", so a failure here pauses updates
    // rather than letting a host restart a server MAT cannot vouch for.
    log.error('[UPDATE HOLD] Failed to determine the update hold', error as Error);
    return res.status(500).json({
      success: false,
      error: 'Failed to determine the update hold',
    });
  }
});

export default router;
