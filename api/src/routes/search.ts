/**
 * Search across the platform (the search box in the top bar): players, teams,
 * tournaments and played matches by name, fuzzily (utils/fuzzy.ts, the same
 * scoring as the browser's page search). Public, like the lists it searches
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
import { scoreFields, words } from '../utils/fuzzy';

const router = Router();

const PER_KIND = 6;
/** Rows a kind's candidate query may bring back before they are ranked. */
const CANDIDATES = 300;

/** `text` for ILIKE: its own % and _ match themselves. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * ILIKE patterns that catch typos: per query word, the word itself and its
 * first and last three letters ("leaderbaord" → %lea%, %ord%), so a row with
 * one typo still comes back to be ranked.
 */
function candidatePatterns(q: string): string[] {
  const out = new Set<string>();
  for (const w of words(q)) {
    out.add(`%${escapeLike(w)}%`);
    if (w.length >= 5) {
      out.add(`%${escapeLike(w.slice(0, 3))}%`);
      out.add(`%${escapeLike(w.slice(-3))}%`);
    }
  }
  return [...out];
}

/** `rows`, best match first, those that match at all, at most `limit`. */
function rank<T>(
  q: string,
  rows: T[],
  fields: (row: T) => Array<{ text: string; weight: number }>,
  limit = PER_KIND
): T[] {
  return rows
    .map((row, i) => ({ row, i, score: scoreFields(q, fields(row)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.row);
}

/**
 * @openapi
 * /api/search:
 *   get:
 *     tags: [Search]
 *     summary: Search players, teams, tournaments and played matches by name
 *     description: |
 *       Public. `q` (2 to 100 characters) is matched fuzzily, case and accent
 *       insensitive: every word must match a word of the name, from its
 *       start, inside it or with a typo; a SteamID64 finds that player. Up to
 *       6 of each kind, the closest first. Banned and deleted players are
 *       left out, and a tournament still being set up is only found by an
 *       admin.
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
  if (q.length < 2 || words(q).length === 0) {
    return res.json({ success: true, players: [], teams: [], tournaments: [], matches: [] });
  }
  try {
    const admin = (await checkAdminAccess(req)).ok;
    const patterns = candidatePatterns(q);
    const anyOf = (column: string) => patterns.map(() => `${column} ILIKE ?`).join(' OR ');

    const playerRows = await db.queryAsync<{ id: string; name: string; avatar_url: string | null }>(
      `SELECT id, name, avatar_url FROM players
        WHERE deleted_at IS NULL AND banned_at IS NULL AND (id = ? OR ${anyOf('name')})
        ORDER BY match_count DESC, name
        LIMIT ?`,
      [q, ...patterns, CANDIDATES]
    );
    const byId = playerRows.find((p) => p.id === q);
    const players = byId ? [byId] : rank(q, playerRows, (p) => [{ text: p.name, weight: 1 }]);

    // Teams and tournaments are few: rank them all.
    const teamRows = await db.queryAsync<{ id: string; name: string; tag: string | null }>(
      'SELECT id, name, tag FROM teams ORDER BY name LIMIT 5000'
    );
    const teamMatches = rank(
      q,
      teamRows,
      (t) => [
        { text: t.name, weight: 1 },
        { text: t.tag ?? '', weight: 0.95 },
      ],
      50
    );
    const teams = teamMatches.slice(0, PER_KIND);

    const tournamentRows = (
      await db.queryAsync<DbTournamentRow>('SELECT * FROM tournament ORDER BY id DESC LIMIT 2000')
    )
      .map(tournamentRowToResponse)
      .filter((t) => {
        if (admin) return true;
        const settings = (t.settings ?? {}) as unknown as Record<string, unknown>;
        return !(t.status === 'setup' && settings.registrationOpen !== true);
      });
    const tournamentMatches = rank(q, tournamentRows, (t) => [{ text: t.name, weight: 1 }], 50);
    const tournaments = tournamentMatches
      .slice(0, PER_KIND)
      .map((t) => ({ id: t.id, name: t.name, status: t.status }));

    // Played matches: those of the teams and tournaments found, or whose
    // event (an imported match's) or slug matches; then ranked.
    const teamIds = teamMatches.map((t) => t.id);
    const tournamentIds = tournamentMatches.map((t) => t.id);
    const inList = (n: number) => (n ? Array(n).fill('?').join(', ') : 'NULL');
    const matchRows = await db.queryAsync<{
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
          AND (m.team1_id IN (${inList(teamIds.length)}) OR m.team2_id IN (${inList(teamIds.length)})
            OR m.tournament_id IN (${inList(tournamentIds.length)})
            OR ${anyOf('m.played_in')} OR ${anyOf('m.slug')})
        ORDER BY m.completed_at DESC NULLS LAST, m.id DESC
        LIMIT ?`,
      [...teamIds, ...teamIds, ...tournamentIds, ...patterns, ...patterns, CANDIDATES]
    );
    const matches = rank(q, matchRows, (m) => [
      { text: `${m.team1 ?? ''} ${m.team2 ?? ''}`, weight: 1 },
      { text: m.event ?? '', weight: 0.9 },
      { text: m.slug, weight: 0.8 },
    ]);

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
