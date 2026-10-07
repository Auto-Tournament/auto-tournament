/**
 * The platform's leaderboard: players ranked by their tournament rating in
 * one game (ratings are per game, services/gameRatings), with what they
 * played. Public, like the player and team directories.
 */
import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { getIntegration } from '../integrations/registry';
import { ratingGame } from '../services/gameRatings';

const router = Router();

/** At most this many players on the board. */
const LIMIT = 200;

function gameName(id: string): string {
  try {
    return getIntegration(id).displayName;
  } catch {
    return id;
  }
}

/**
 * @openapi
 * /api/leaderboard:
 *   get:
 *     tags: [Leaderboard]
 *     summary: Players ranked by their rating in one game
 *     description: >-
 *       The games with rated players (most players first), and the board for
 *       `game` (default: the first of them): rating, rated matches, wins and
 *       losses. Only players with at least one rated match in the game. Public.
 *     parameters:
 *       - { in: query, name: game, required: false, schema: { type: string } }
 *     responses:
 *       200: { description: The board }
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const games = (
      await db.queryAsync<{ game: string; players: number | string }>(
        `SELECT game, COUNT(*) AS players FROM player_game_ratings WHERE match_count > 0
          GROUP BY game ORDER BY COUNT(*) DESC, game`,
        []
      )
    ).map((g) => ({ id: g.game, name: gameName(g.game), players: Number(g.players) }));
    const asked = typeof req.query.game === 'string' && req.query.game.trim() ? ratingGame(req.query.game) : null;
    const game = asked ?? games[0]?.id ?? null;
    if (!game) return res.json({ success: true, games, game: null, players: [] });

    const rows = await db.queryAsync<{
      id: string;
      name: string;
      avatar_url: string | null;
      current_elo: number;
      match_count: number;
      wins: number | string;
      losses: number | string;
    }>(
      `SELECT p.id, p.name, p.avatar_url, g.current_elo, g.match_count,
              COUNT(*) FILTER (WHERE h.match_result = 'win') AS wins,
              COUNT(*) FILTER (WHERE h.match_result = 'loss') AS losses
         FROM player_game_ratings g
         JOIN players p ON p.id = g.player_id
         LEFT JOIN player_rating_history h
           ON h.player_id = g.player_id AND LOWER(TRIM(COALESCE(h.game, 'cs2'))) = g.game
        WHERE g.game = ? AND g.match_count > 0
        GROUP BY p.id, p.name, p.avatar_url, g.current_elo, g.match_count
        ORDER BY g.current_elo DESC, g.match_count DESC, p.name
        LIMIT ?`,
      [game, LIMIT]
    );
    return res.json({
      success: true,
      games,
      game,
      players: rows.map((r, i) => ({
        rank: i + 1,
        id: r.id,
        name: r.name,
        avatar: r.avatar_url || `/api/players/${r.id}/avatar.svg`,
        rating: Number(r.current_elo),
        matches: Number(r.match_count),
        wins: Number(r.wins),
        losses: Number(r.losses),
      })),
    });
  } catch (error) {
    log.error('Reading the leaderboard', error as Error);
    return res.status(500).json({ success: false, error: 'Could not read the leaderboard' });
  }
});

export default router;
