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
import { SignupError, tournamentSignupService } from '../services/tournamentSignupService';
import type { DbTournamentRow } from '../types/database.types';
import { log } from '../utils/logger';
import { resolveTournamentId, tournamentRowToResponse } from '../utils/tournamentRow';
import { getEffectiveViewerSteamId } from '../utils/viewerIdentity';
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
  /** While it runs: the lowest round with a match not finished yet (the stage it is at). */
  currentRound: number | null;
  /** Matches loaded or live right now. */
  liveMatchCount: number;
  /** Players per team (5 for 5v5), when set. */
  teamSize: number | null;
  /** The viewer plays in it: their team is in it or signed up, or they are in a lineup or the shuffle pool. */
  mine: boolean;
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

/** The viewer's teams and the tournaments they are in by name (lineups, the shuffle pool). */
async function viewerEntries(steamId: string | null): Promise<{ teams: Set<string>; tournaments: Set<number> }> {
  if (!steamId) return { teams: new Set(), tournaments: new Set() };
  const teams = await db.queryAsync<{ team_id: string }>(
    'SELECT tm.team_id FROM team_members tm JOIN players p ON p.uid = tm.account_uid WHERE p.id = ?',
    [steamId]
  );
  const named = await db.queryAsync<{ tournament_id: number }>(
    `SELECT tournament_id FROM tournament_lineups WHERE player_id = ?
     UNION SELECT tournament_id FROM shuffle_tournament_players WHERE player_id = ?
     UNION SELECT r.tournament_id FROM tournament_registrations r
             JOIN team_members tm ON tm.team_id = r.team_id
             JOIN players p ON p.uid = tm.account_uid
            WHERE p.id = ?`,
    [steamId, steamId, steamId]
  );
  return { teams: new Set(teams.map((t) => t.team_id)), tournaments: new Set(named.map((n) => Number(n.tournament_id))) };
}

async function listItems(includeDrafts: boolean, viewerSteamId: string | null = null): Promise<TournamentListItem[]> {
  const viewer = await viewerEntries(viewerSteamId);
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
    const currentRound =
      t.status === 'in_progress'
        ? ((
            await db.queryOneAsync<{ r: number | null }>(
              `SELECT MIN(round) AS r FROM matches WHERE tournament_id = ? AND round > 0 AND status <> 'completed'`,
              [t.id]
            )
          )?.r ?? null)
        : null;
    const liveMatchCount =
      t.status === 'in_progress'
        ? ((
            await db.queryOneAsync<{ n: number }>(
              `SELECT COUNT(*)::int AS n FROM matches WHERE tournament_id = ? AND status IN ('loaded', 'live')`,
              [t.id]
            )
          )?.n ?? 0)
        : 0;
    const mine = viewer.tournaments.has(t.id) || (t.teamIds ?? []).some((id) => viewer.teams.has(id));

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
      currentRound: currentRound === null ? null : Number(currentRound),
      liveMatchCount,
      teamSize: typeof (t as { teamSize?: unknown }).teamSize === 'number' ? (t as { teamSize: number }).teamSize : null,
      mine,
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
      tournaments: await listItems(admin, await getEffectiveViewerSteamId(req)),
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

/**
 * @openapi
 * /api/tournaments/{id}/teams:
 *   post:
 *     tags:
 *       - Tournament
 *     summary: Add a team to a tournament by hand (before it starts), next to the teams that signed up
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [teamId], properties: { teamId: { type: string } } }
 *     responses:
 *       200:
 *         description: "{ teamIds }"
 *       404:
 *         description: No such tournament or team
 *       409:
 *         description: Already started
 * /api/tournaments/{id}/teams/{teamId}:
 *   delete:
 *     tags:
 *       - Tournament
 *     summary: Take a team out of a tournament (before it starts); its sign-up, lineup and check-ins go too
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: "{ teamIds }"
 *       409:
 *         description: Already started
 */
function teamAction(action: (id: number, teamId: string) => Promise<string[]>, teamIdOf: (req: Request) => unknown) {
  return async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      const teamId = teamIdOf(req);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Bad tournament id' });
      if (typeof teamId !== 'string' || !teamId) return res.status(400).json({ success: false, error: 'teamId is required' });
      return res.json({ success: true, teamIds: await action(id, teamId) });
    } catch (error) {
      if (error instanceof SignupError) return res.status(error.status).json({ success: false, error: error.message });
      log.error('Error changing a tournament\'s teams', { error });
      return res.status(500).json({ success: false, error: 'Failed to change the teams' });
    }
  };
}

router.post(
  '/:id/teams',
  requireAuth,
  teamAction((id, teamId) => tournamentSignupService.adminAdd(id, teamId), (req) => req.body?.teamId)
);
router.delete(
  '/:id/teams/:teamId',
  requireAuth,
  teamAction((id, teamId) => tournamentSignupService.adminRemove(id, teamId), (req) => req.params.teamId)
);

export default router;
