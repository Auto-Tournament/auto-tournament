/**
 * Each player's numbers summed over tournaments or matches, for integrators
 * (../statTotals.ts).
 *
 *   GET /api/integrations/player-stats   ?tournament=4,5 | match=<slug>,... | event=<name>  (integrator token)
 */

import { Router, type Request, type Response } from 'express';
import { requireIntegratorAuth } from '../../../middleware/auth';
import { log } from '../../../utils/logger';
import { playerStatTotals } from '../statTotals';

/** At most this many tournaments or matches in one read. */
export const SCOPE_MAX = 200;

export const integrationPlayerStatsRouter = Router();

integrationPlayerStatsRouter.use(requireIntegratorAuth);

/**
 * @openapi
 * /api/integrations/player-stats:
 *   get:
 *     tags: [Integrations: player stats]
 *     summary: Each player's numbers summed over tournaments or matches
 *     description: |
 *       One row per player, summed over every match the filters take (a match
 *       is in when any of `tournament`, `match` or `event` takes it; at least
 *       one is required). Read the whole answer each time: a re-parsed demo or
 *       a changed map result shows in the next read.
 *
 *       Only finished series count (an imported match once its last map is
 *       in), never a simulation or a bot-filled match, and of those only the
 *       maps with a result. Warmup is never in the numbers; the kill feed's
 *       knife round is left out. `matchesPlayed` and `matchesWon` count series
 *       (a Bo3 is one), `adr` is damage per round, `kast` the percentage of
 *       rounds with a kill, an assist, a survival or a trade, `clutches` the
 *       rounds won as the last player alive against one or more,
 *       `multiKills5k` aces, `firstKills` the round's opening kills.
 *
 *       **null means not measured, never 0.** A number is null for a player
 *       when one of their matches has no source for it: `mvps`, `score` and
 *       `flashAssists` come from the series result the game server sends, so
 *       they are null for imported matches; `knifeKills` and `teamKills` come
 *       from the demo's kill feed, so they are null when a map's demo wasn't
 *       analyzed; `kast`, `firstKills`, `clutches`, `multiKills5k` and the
 *       flashes are null for a match from a plugin (MatchZy Enhanced) server.
 *
 *       Integrator token (API_TOKENS_INTEGRATOR), read-only or admin token,
 *       or an admin session.
 *     parameters:
 *       - in: query
 *         name: tournament
 *         schema: { type: string, example: '4,5' }
 *         description: Tournament ids, comma-separated (and played matches kept from them). Summed over all of them.
 *       - in: query
 *         name: match
 *         schema: { type: string, example: 'import-9080a5c286,import-ca96f894f8' }
 *         description: Match slugs, comma-separated.
 *       - in: query
 *         name: event
 *         schema: { type: string, example: 'NTLAN 2026-03' }
 *         description: The event name of matches in no tournament (an import's event), any case.
 *     responses:
 *       200:
 *         description: Every player's numbers, most kills first.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 tournaments: { type: array, items: { type: integer }, description: The tournament ids asked for }
 *                 players:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       steamId: { type: string, example: '76561198157519659' }
 *                       name: { type: string, nullable: true }
 *                       matchesPlayed: { type: integer }
 *                       matchesWon: { type: integer }
 *                       roundsPlayed: { type: integer }
 *                       kills: { type: integer }
 *                       deaths: { type: integer }
 *                       assists: { type: integer }
 *                       headshotKills: { type: integer }
 *                       totalDamage: { type: integer }
 *                       utilityDamage: { type: integer, nullable: true }
 *                       flashAssists: { type: integer, nullable: true }
 *                       mvps: { type: integer, nullable: true }
 *                       score: { type: integer, nullable: true }
 *                       adr: { type: number, nullable: true, example: 95.0 }
 *                       kast: { type: number, nullable: true, example: 74.0 }
 *                       teamKills: { type: integer, nullable: true }
 *                       friendliesFlashed: { type: integer, nullable: true }
 *                       enemiesFlashed: { type: integer, nullable: true }
 *                       knifeKills: { type: integer, nullable: true }
 *                       firstKills: { type: integer, nullable: true }
 *                       clutches: { type: integer, nullable: true }
 *                       multiKills5k: { type: integer, nullable: true }
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   description: The newest change to the numbers counted (a series finished, a map analyzed); null when nothing is counted.
 *       400: { description: A bad parameter, or none of tournament, match and event }
 *       401: { description: No or a wrong token }
 */
integrationPlayerStatsRouter.get('/', async (req: Request, res: Response) => {
  const list = (v: unknown) =>
    typeof v === 'string'
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const tournamentArgs = list(req.query.tournament);
  const tournaments = tournamentArgs.map(Number);
  if (req.query.tournament !== undefined && typeof req.query.tournament !== 'string') {
    return res.status(400).json({ success: false, error: 'Give tournament once, comma-separated' });
  }
  if (
    tournaments.some((t) => !(Number.isInteger(t) && t > 0 && t < 2 ** 31)) ||
    (req.query.tournament !== undefined && tournaments.length === 0)
  ) {
    return res
      .status(400)
      .json({ success: false, error: 'tournament must be tournament ids, comma-separated' });
  }
  const matches = list(req.query.match);
  if (req.query.match !== undefined && (typeof req.query.match !== 'string' || !matches.length)) {
    return res
      .status(400)
      .json({ success: false, error: 'match must be match slugs, comma-separated' });
  }
  if (tournaments.length > SCOPE_MAX || matches.length > SCOPE_MAX) {
    return res
      .status(400)
      .json({ success: false, error: `At most ${SCOPE_MAX} tournaments or matches` });
  }
  const event =
    typeof req.query.event === 'string' && req.query.event.trim()
      ? req.query.event.trim().slice(0, 100)
      : undefined;
  if (req.query.event !== undefined && !event) {
    return res.status(400).json({ success: false, error: 'event must be an event name' });
  }
  if (!tournaments.length && !matches.length && !event) {
    return res.status(400).json({ success: false, error: 'Give tournament, match or event' });
  }
  try {
    const result = await playerStatTotals({ tournaments, matches, event });
    return res.json({
      success: true,
      tournaments: [...new Set(tournaments)],
      players: result.players,
      updatedAt: result.updatedAt ? new Date(result.updatedAt * 1000).toISOString() : null,
    });
  } catch (error) {
    log.error('[Integrations] Player stats API failed', error);
    return res.status(500).json({ success: false, error: 'Could not read the player stats' });
  }
});
