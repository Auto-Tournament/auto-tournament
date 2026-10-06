/**
 * Several tournaments (Vikunja 1840): the list, creating another one, and
 * which one is featured.
 *
 * Everything about one tournament stays on `/api/tournament/...`; a request
 * names the tournament it means with the `X-Tournament-Id` header (or
 * `?tournamentId=`), and one that names none gets the featured tournament
 * (services/currentTournament.ts).
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../config/database';
import { checkAdminAccess, requireAuth } from '../middleware/auth';
import {
  archiveTournament,
  nextTournamentId,
  setFeaturedTournament,
  TournamentArchiveError,
} from '../services/currentTournament';
import { tournamentService } from '../services/tournamentService';
import type { DbTournamentRow } from '../types/database.types';
import { log } from '../utils/logger';
import { resolveTournamentId, tournamentRowToResponse } from '../utils/tournamentRow';
import tournamentRoutes from './tournament';

const router = Router();

/** A tournament as the lists show it. */
export interface TournamentListItem {
  id: number;
  name: string;
  game: string;
  type: string;
  format: string;
  status: string;
  description: string | null;
  bannerUrl: string | null;
  /** Teams in it (players for a shuffle); for one with sign-up open, the teams signed up. */
  entries: number;
  maxEntries: number | null;
  registrationOpen: boolean;
  registrationClosesAt: number | null;
  /** When it starts: the first schedule entry, else when it was started. Unix seconds. */
  startsAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  winner: { id: string; name: string; tag?: string } | null;
  featured: boolean;
  archived: boolean;
  /** Setup with sign-up closed: only admins see it. */
  draft: boolean;
}

function startOf(settings: Record<string, unknown>, startedAt: number | undefined): number | null {
  const schedule = Array.isArray(settings.schedule) ? (settings.schedule as Array<{ at?: unknown }>) : [];
  const first = schedule
    .map((s) => (typeof s.at === 'string' || typeof s.at === 'number' ? Date.parse(String(s.at)) : NaN))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)[0];
  if (first !== undefined) return Math.floor(first / 1000);
  return startedAt ?? null;
}

async function listItems(includeDrafts: boolean): Promise<TournamentListItem[]> {
  const rows = await db.queryAsync<DbTournamentRow>('SELECT * FROM tournament ORDER BY id DESC');
  const featuredId = resolveTournamentId();
  const out: TournamentListItem[] = [];
  for (const row of rows) {
    const t = tournamentRowToResponse(row);
    const settings = (t.settings ?? {}) as unknown as Record<string, unknown>;
    const registrationOpen = settings.registrationOpen === true;
    const draft = t.status === 'setup' && !registrationOpen;
    if (draft && !includeDrafts) continue;

    let entries = t.teamIds?.length ?? 0;
    if (t.type === 'shuffle') {
      const r = await db.queryOneAsync<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM shuffle_tournament_players WHERE tournament_id = ?',
        [t.id]
      );
      entries = r?.n ?? 0;
    } else if (registrationOpen) {
      const r = await db.queryOneAsync<{ n: number }>(
        'SELECT COUNT(*)::int AS n FROM tournament_registrations WHERE tournament_id = ?',
        [t.id]
      );
      entries = Math.max(entries, r?.n ?? 0);
    }

    const winner =
      t.status === 'completed' ? await tournamentService.getTournamentWinner(t.id, t.type, []).catch(() => null) : null;

    out.push({
      id: t.id,
      name: t.name,
      game: t.game,
      type: t.type,
      format: t.format,
      status: t.status,
      description: typeof settings.description === 'string' ? settings.description : null,
      bannerUrl: (t as unknown as { bannerUrl?: string | null }).bannerUrl ?? null,
      entries,
      maxEntries: typeof settings.maxTeams === 'number' ? settings.maxTeams : null,
      registrationOpen,
      registrationClosesAt: typeof settings.registrationClosesAt === 'number' ? settings.registrationClosesAt : null,
      startsAt: startOf(settings, t.started_at),
      startedAt: t.started_at ?? null,
      completedAt: t.completed_at ?? null,
      winner,
      featured: t.id === featuredId,
      archived: Boolean(row.archived_at),
      draft,
    });
  }
  return out;
}

/**
 * @openapi
 * /api/tournaments:
 *   get:
 *     tags:
 *       - Tournament
 *     summary: Every tournament (public)
 *     description: |
 *       Newest first. Drafts (set up, sign-up closed) only for admins. Each
 *       says whether it is featured (the front page's big card) and archived
 *       (finished and off the front page's lists).
 *     responses:
 *       200:
 *         description: "{ tournaments, featuredId }"
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const admin = (await checkAdminAccess(req)).ok;
    return res.json({
      success: true,
      tournaments: await listItems(admin),
      featuredId: resolveTournamentId(),
      // The id a new tournament gets: the setup page creates at it.
      ...(admin ? { nextId: await nextTournamentId() } : {}),
    });
  } catch (error) {
    log.error('Error listing tournaments', { error });
    return res.status(500).json({ success: false, error: 'Failed to list tournaments' });
  }
});

/**
 * @openapi
 * /api/tournaments:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Create another tournament
 *     description: |
 *       The same body as `POST /api/tournament` (or `/api/tournament/shuffle`
 *       for `type: shuffle`), but it never replaces one: the new tournament
 *       gets the next id. `copyFrom` (a tournament id) starts from that
 *       tournament's format, maps, rules and page; teams, dates and sign-up
 *       start empty. Fields in the body win.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       201:
 *         description: The new tournament
 *       404:
 *         description: copyFrom not found
 */
router.post('/', requireAuth, async (req: Request, res: Response, next) => {
  try {
    const body = { ...((req.body ?? {}) as Record<string, unknown>) };
    const copyFrom = Number(body.copyFrom);
    delete body.copyFrom;
    if (Number.isInteger(copyFrom) && copyFrom > 0) {
      const source = await tournamentService.getTournament(copyFrom);
      if (!source) return res.status(404).json({ success: false, error: 'Tournament to copy not found' });
      const settings = { ...((source.settings ?? {}) as unknown as Record<string, unknown>) };
      for (const key of ['registrationOpen', 'registrationClosesAt', 'checkInOpensAt', 'checkInClosesAt', 'schedule']) {
        delete settings[key];
      }
      const bodySettings = (body.settings ?? {}) as Record<string, unknown>;
      Object.assign(body, {
        name: body.name ?? `${source.name} (copy)`,
        type: body.type ?? source.type,
        format: body.format ?? source.format,
        game: body.game ?? source.game,
        maps: body.maps ?? source.maps,
        mapSequence: body.mapSequence ?? source.mapSequence,
        maxRounds: body.maxRounds ?? source.maxRounds,
        overtimeMode: body.overtimeMode ?? source.overtimeMode,
        overtimeSegments: body.overtimeSegments ?? source.overtimeSegments,
        teamSize: body.teamSize ?? source.teamSize,
        teamIds: body.teamIds ?? [],
        settings: { ...settings, ...bodySettings },
      });
    }
    // Handled by the create route, at the next id: it never replaces one.
    const id = await nextTournamentId();
    req.body = body;
    req.headers['x-tournament-id'] = String(id);
    (req as Request & { atDraft?: boolean }).atDraft = true;
    req.url = body.type === 'shuffle' ? '/shuffle' : '/';
    return tournamentRoutes(req, res, next);
  } catch (error) {
    log.error('Error creating a tournament', { error });
    return res.status(500).json({ success: false, error: 'Failed to create the tournament' });
  }
});

/**
 * @openapi
 * /api/tournaments/{id}/feature:
 *   put:
 *     tags:
 *       - Tournament
 *     summary: Feature a tournament on the front page
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: "{ featuredId }"
 *       404:
 *         description: Not found
 *   delete:
 *     tags:
 *       - Tournament
 *     summary: Let the front page pick (running first, else the newest)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: "{ featuredId }"
 */
router.put('/:id/feature', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Bad tournament id' });
    return res.json({ success: true, featuredId: await setFeaturedTournament(id) });
  } catch (error) {
    if (error instanceof TournamentArchiveError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    log.error('Error featuring a tournament', { error });
    return res.status(500).json({ success: false, error: 'Failed to feature the tournament' });
  }
});

router.delete('/:id/feature', requireAuth, async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, featuredId: await setFeaturedTournament(null) });
  } catch (error) {
    log.error('Error clearing the featured tournament', { error });
    return res.status(500).json({ success: false, error: 'Failed to clear the featured tournament' });
  }
});

/**
 * @openapi
 * /api/tournaments/{id}/archive:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Archive a finished tournament (off the front page's lists, results kept)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: "{ archivedId, currentId }"
 *       404:
 *         description: Not found
 *       409:
 *         description: Not finished
 */
router.post('/:id/archive', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Bad tournament id' });
    return res.json({ success: true, ...(await archiveTournament(id)) });
  } catch (error) {
    if (error instanceof TournamentArchiveError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    log.error('Error archiving a tournament', { error });
    return res.status(500).json({ success: false, error: 'Failed to archive the tournament' });
  }
});

export default router;
