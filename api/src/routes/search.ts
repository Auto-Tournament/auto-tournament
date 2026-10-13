/**
 * Search across the platform (the search box in the top bar): players, teams,
 * tournaments and played matches by name, and what each installed game adds
 * (`siteSearch`; CS2: highlights, maps, and for admins servers and recorders).
 * Fuzzy (utils/fuzzy.ts): typos, partial words, any word order, no diacritics.
 * Public, like the lists it searches (the player and team directories, Browse,
 * match pages): no banned or deleted players, and a tournament still being set
 * up only for admins. The site's pages, tabs and actions are searched in the
 * browser (client/src/search/siteIndex.ts).
 */
import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { checkAdminAccess } from '../middleware/auth';
import { tournamentRowToResponse } from '../utils/tournamentRow';
import { fuzzyRank } from '../utils/fuzzy';
import { listIntegrations } from '../integrations/registry';
import type { SiteSearchHit } from '../integrations/types';
import type { DbTournamentRow } from '../types/database.types';

const router = Router();

const PER_KIND = 6;
const MODULE_HITS = 12;
/** How many of each kind are searched: the most played players, the newest tournaments and matches. */
const CANDIDATES = 5000;

interface Candidates {
  players: Array<{ id: string; name: string; avatar_url: string | null }>;
  teams: Array<{ id: string; name: string; tag: string | null }>;
  tournaments: Array<{ id: number; name: string; status: string; hidden: boolean }>;
  matches: Array<{
    slug: string;
    team1: string | null;
    team2: string | null;
    event: string | null;
    completed_at: number | null;
  }>;
}

/**
 * What the search looks through. Fuzzy matching runs here rather than in SQL,
 * so typos and diacritics work without database extensions; the names alone
 * are small even at the limit.
 */
async function candidates(): Promise<Candidates> {
  const players = await db.queryAsync<Candidates['players'][number]>(
    `SELECT id, name, avatar_url FROM players
      WHERE deleted_at IS NULL AND banned_at IS NULL AND name IS NOT NULL
      ORDER BY match_count DESC, name LIMIT ?`,
    [CANDIDATES]
  );
  const teams = await db.queryAsync<Candidates['teams'][number]>(
    'SELECT id, name, tag FROM teams ORDER BY name LIMIT ?',
    [CANDIDATES]
  );
  const tournamentRows = await db.queryAsync<DbTournamentRow>(
    'SELECT * FROM tournament ORDER BY id DESC LIMIT ?',
    [CANDIDATES]
  );
  const tournaments = tournamentRows.map(tournamentRowToResponse).map((t) => {
    const settings = (t.settings ?? {}) as unknown as Record<string, unknown>;
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      hidden: t.status === 'setup' && settings.registrationOpen !== true,
    };
  });
  const matches = await db.queryAsync<Candidates['matches'][number]>(
    `SELECT m.slug, t1.name AS team1, t2.name AS team2, COALESCE(tr.name, m.played_in) AS event, m.completed_at
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id
      WHERE m.status = 'completed'
      ORDER BY m.completed_at DESC NULLS LAST, m.id DESC
      LIMIT ?`,
    [CANDIDATES]
  );
  return { players, teams, tournaments, matches };
}

/**
 * @openapi
 * /api/search:
 *   get:
 *     tags: [Search]
 *     summary: Search players, teams, tournaments, played matches and what each game adds
 *     description: |
 *       Public. `q` (2 to 100 characters) is matched fuzzily: every word has
 *       to match a word of the name (exactly, its start, inside it, or with a
 *       typo), in any order, ignoring case and diacritics; a SteamID64 finds
 *       that player. Up to 6 of each kind, the best match first. `modules` is
 *       what the installed games add (CS2: highlights, maps; for admins
 *       servers and recorders), up to 12. Banned and deleted players are left
 *       out, and a tournament still being set up is only found by an admin.
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: "`players`, `teams`, `tournaments`, `matches`, `modules`"
 */
router.get('/', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q.length < 2) {
    return res.json({
      success: true,
      players: [],
      teams: [],
      tournaments: [],
      matches: [],
      modules: [],
    });
  }
  try {
    const admin = (await checkAdminAccess(req)).ok;
    const all = await candidates();

    const byId = all.players.find((p) => p.id === q);
    const players = byId
      ? [byId]
      : fuzzyRank(q, all.players, (p) => [p.name], PER_KIND).map((r) => r.item);
    const teams = fuzzyRank(
      q,
      all.teams,
      (t) => [t.name, { text: t.tag ?? '', weight: 0.9 }],
      PER_KIND
    ).map((r) => r.item);
    const tournaments = fuzzyRank(
      q,
      all.tournaments.filter((t) => admin || !t.hidden),
      (t) => [t.name],
      PER_KIND
    ).map(({ item: t }) => ({ id: t.id, name: t.name, status: t.status }));
    const matches = fuzzyRank(
      q,
      all.matches,
      (m) => [
        `${m.team1 ?? ''} ${m.team2 ?? ''}`,
        { text: m.event ?? '', weight: 0.8 },
        { text: m.slug, weight: 0.8 },
      ],
      PER_KIND
    ).map((r) => r.item);

    const modules: SiteSearchHit[] = [];
    for (const integration of listIntegrations()) {
      if (!integration.siteSearch) continue;
      try {
        modules.push(
          ...(await integration.siteSearch({
            q,
            admin,
            rank: (items, fieldsOf, limit) => fuzzyRank(q, items, fieldsOf, limit),
          }))
        );
      } catch (error) {
        log.warn(`[SEARCH] ${integration.id} search failed`, { error: String(error) });
      }
    }
    modules.sort((a, b) => b.score - a.score);

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
      modules: modules.slice(0, MODULE_HITS).map(({ score: _score, ...hit }) => hit),
    });
  } catch (error) {
    log.error('[SEARCH] Search failed', error as Error);
    return res.status(500).json({ success: false, error: 'Search failed' });
  }
});

export default router;
