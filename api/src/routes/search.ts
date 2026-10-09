/**
 * Search across the platform (the search box in the top bar): players, teams,
 * tournaments and played matches by name. Public, like the lists it searches
 * (the player and team directories, Browse, match pages): no banned or
 * deleted players, and a tournament still being set up only for admins. The
 * admin pages and settings are searched in the browser (client/src/search).
 */
import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { checkAdminAccess } from '../middleware/auth';
import { tournamentRowToResponse } from '../utils/tournamentRow';
import type { DbTournamentRow } from '../types/database.types';

const router = Router();

const PER_KIND = 6;

/** `q` for ILIKE: its own % and _ match themselves. */
function likeOf(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * @openapi
 * /api/search:
 *   get:
 *     tags: [Search]
 *     summary: Search players, teams, tournaments and played matches by name
 *     description: |
 *       Public. `q` (2 to 100 characters) matches anywhere in a name, case
 *       insensitive; a SteamID64 finds that player. Up to 6 of each kind, the
 *       closest first. Banned and deleted players are left out, and a
 *       tournament still being set up is only found by an admin.
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "`players`, `teams`, `tournaments`, `matches`"
 */
router.get('/', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q.length < 2) {
    return res.json({ success: true, players: [], teams: [], tournaments: [], matches: [] });
  }
  try {
    const like = likeOf(q);
    const admin = (await checkAdminAccess(req)).ok;

    const players = await db.queryAsync<{ id: string; name: string; avatar_url: string | null }>(
      `SELECT id, name, avatar_url FROM players
        WHERE deleted_at IS NULL AND banned_at IS NULL AND (name ILIKE ? OR id = ?)
        ORDER BY (LOWER(name) = LOWER(?)) DESC, (name ILIKE ?) DESC, match_count DESC, name
        LIMIT ?`,
      [like, q, q, `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, PER_KIND]
    );

    const teams = await db.queryAsync<{ id: string; name: string; tag: string | null }>(
      `SELECT id, name, tag FROM teams WHERE name ILIKE ? OR tag ILIKE ?
        ORDER BY (LOWER(name) = LOWER(?)) DESC, name LIMIT ?`,
      [like, like, q, PER_KIND]
    );

    const tournamentRows = await db.queryAsync<DbTournamentRow>(
      'SELECT * FROM tournament WHERE name ILIKE ? ORDER BY id DESC LIMIT 30',
      [like]
    );
    const tournaments = tournamentRows
      .map(tournamentRowToResponse)
      .filter((t) => {
        if (admin) return true;
        const settings = (t.settings ?? {}) as unknown as Record<string, unknown>;
        return !(t.status === 'setup' && settings.registrationOpen !== true);
      })
      .slice(0, PER_KIND)
      .map((t) => ({ id: t.id, name: t.name, status: t.status }));

    const matches = await db.queryAsync<{
      slug: string;
      team1: string | null;
      team2: string | null;
      event: string | null;
      completed_at: number | null;
    }>(
      `SELECT m.slug, t1.name AS team1, t2.name AS team2, COALESCE(tr.name, m.played_in) AS event, m.completed_at
         FROM matches m
         LEFT JOIN teams t1 ON t1.id = m.team1_id
         LEFT JOIN teams t2 ON t2.id = m.team2_id
         LEFT JOIN tournament tr ON tr.id = m.tournament_id
        WHERE m.status = 'completed'
          AND (t1.name ILIKE ? OR t2.name ILIKE ? OR COALESCE(tr.name, m.played_in) ILIKE ? OR m.slug ILIKE ?)
        ORDER BY m.completed_at DESC NULLS LAST, m.id DESC
        LIMIT ?`,
      [like, like, like, like, PER_KIND]
    );

    return res.json({
      success: true,
      players: players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar_url })),
      teams,
      tournaments,
      matches: matches.map((m) => ({
        slug: m.slug,
        team1: m.team1,
        team2: m.team2,
        event: m.event,
        completedAt: m.completed_at != null ? Number(m.completed_at) : null,
      })),
    });
  } catch (error) {
    log.error('[SEARCH] Search failed', error as Error);
    return res.status(500).json({ success: false, error: 'Search failed' });
  }
});

export default router;
