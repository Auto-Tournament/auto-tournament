/**
 * Test-only routes of the manual-report module, mounted at
 * `/api/test/integration/manual-report`.
 *
 * - `POST /tournament` creates a tournament whose `game` is a catalogue id the
 *   module runs ('rocket-league'), with the module's `manualReport` settings.
 *   The public create route always makes a CS2 tournament, so this is the only
 *   way to pick another game today — the same hole the fake integration's test
 *   route fills.
 * - `POST /teams/:teamId/captain` promotes an account to captain. 2.x has no
 *   captain concept at all (D1's backfill found none to migrate), so until the
 *   admin route in D5 there is no other way to make one.
 * - `POST /:slug/report`, `/confirm`, `/dispute`, `/withdraw`, `/resolve`,
 *   `/override`, `/reopen` and `GET /:slug/reports` drive the state machine
 *   (./reports). The real captain and admin routes are PR D4 and D5; these
 *   are how it is exercised against a live API until then.
 * - `POST /sweep` runs one timeout sweep now, instead of waiting for the
 *   60-second interval.
 *
 * Who a request acts as comes from `resolveViewerAccount`, so these helpers
 * take the same path the real routes will: a `players.uid`, never a Steam ID.
 *
 * Not in the API reference: `LegacyRouteMount.testOnly` keeps them out of the
 * generated docs and the OpenAPI spec.
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../../config/database';
import { requireAuth } from '../../middleware/auth';
import { log } from '../../utils/logger';
import { resolveViewerAccount } from '../../utils/viewerIdentity';
import { teamMembers } from '../../services/teamMembers';
import type {
  CreateTournamentInput,
  MatchFormat,
  TournamentType,
} from '../../types/tournament.types';
import type { DbMatchRow } from '../../types/database.types';
import { MANUAL_REPORT_GAME_ID, runsPack } from './catalog';
import { validateSetup } from './setup';
import {
  adminOverride,
  adminResolve,
  confirmReport,
  disputeReport,
  listReports,
  openReport,
  reopenMatch,
  resolveActor,
  submitReport,
  withdrawReport,
  type ReportActor,
  type ReportOutcome,
} from './reports';
import { sweepOnce } from './sweeper';

export const manualReportTestRoutes = Router();

const TOURNAMENT_TYPES = ['single_elimination', 'double_elimination', 'round_robin', 'swiss'];
const FORMATS = ['bo1', 'bo3', 'bo5'];

/** The E2E test endpoints switch, the same gate `routes/test.ts` uses. */
function isEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const flag = (process.env.ENABLE_TEST_ENDPOINTS || '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

manualReportTestRoutes.use(requireAuth, (_req, res, next) => {
  if (!isEnabled()) {
    res.status(403).json({ success: false, error: 'Disabled in production' });
    return;
  }
  next();
});

manualReportTestRoutes.post('/tournament', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    name?: unknown;
    type?: unknown;
    format?: unknown;
    game?: unknown;
    teamIds?: unknown;
    settings?: unknown;
  };
  const teamIds = Array.isArray(body.teamIds)
    ? body.teamIds.filter((id): id is string => typeof id === 'string')
    : [];

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  if (typeof body.type !== 'string' || !TOURNAMENT_TYPES.includes(body.type)) {
    return res
      .status(400)
      .json({ success: false, error: `type must be one of ${TOURNAMENT_TYPES.join(', ')}` });
  }
  if (typeof body.format !== 'string' || !FORMATS.includes(body.format)) {
    return res
      .status(400)
      .json({ success: false, error: `format must be one of ${FORMATS.join(', ')}` });
  }
  if (teamIds.length < 2) {
    return res.status(400).json({ success: false, error: 'At least 2 teams are required' });
  }

  // `game` is a catalogue id the module runs ('rocket-league'), not the module
  // id: that is the whole point of `runsAnyCatalogGame`. It defaults to the
  // module's own id, which means "a game with no catalogue row here".
  const game =
    typeof body.game === 'string' && body.game.trim()
      ? body.game.trim().toLowerCase()
      : MANUAL_REPORT_GAME_ID;

  // Only an installed game this module runs, or the module itself. The
  // registry would answer this for any catalogue id, but an integration must
  // not import it (eslint-rules/integration-boundaries.mjs), and a test helper
  // has no business creating a tournament for someone else's game anyway.
  const runnable = game === MANUAL_REPORT_GAME_ID || runsPack(game);
  if (!runnable) {
    return res.status(409).json({
      success: false,
      error: `Game '${game}' is not an installed pack this module runs; add it from the Modules page`,
    });
  }

  const settings = (body.settings ?? {}) as CreateTournamentInput['settings'];
  const check = validateSetup({ settings });
  if (!check.valid) {
    return res.status(400).json({ success: false, error: check.errors.join('; ') });
  }

  try {
    const { tournamentService } = await import('../../services/tournamentService');
    const { resolveTournamentId } = await import('../../utils/tournamentRow');
    const tournament = await tournamentService.createTournament(
      resolveTournamentId(req),
      {
        name: body.name,
        type: body.type as TournamentType,
        format: body.format as MatchFormat,
        maps: [],
        teamIds,
        ...(settings ? { settings } : {}),
      },
      { game }
    );
    return res.json({ success: true, tournament });
  } catch (error) {
    log.error('[MANUAL-REPORT] Failed to create tournament', error);
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create tournament',
    });
  }
});

// ---------------------------------------------------------------------------
// Captains
// ---------------------------------------------------------------------------

/**
 * Promote an account to captain of a team.
 *
 * 2.x has no captain concept anywhere — D1's backfill found none to migrate
 * and made every roster player a member — so without this there is nobody who
 * may report. The admin route that does this properly is PR D5.
 */
manualReportTestRoutes.post('/teams/:teamId/captain', async (req: Request, res: Response) => {
  const { teamId } = req.params;
  const body = (req.body ?? {}) as { steamId?: unknown; uid?: unknown };

  let uid: string | null = typeof body.uid === 'string' ? body.uid : null;
  if (!uid && typeof body.steamId === 'string') {
    const row = await db.queryOneAsync<{ uid: string }>('SELECT uid FROM players WHERE id = ?', [
      body.steamId,
    ]);
    uid = row?.uid ?? null;
  }
  if (!uid) {
    return res.status(400).json({ success: false, error: 'uid, or a steamId with a player row' });
  }

  const ok = await teamMembers.setRole(teamId, uid, 'captain');
  if (!ok) {
    return res
      .status(409)
      .json({ success: false, error: `Could not make ${uid} a captain of '${teamId}'` });
  }
  return res.json({ success: true, teamId, uid, role: 'captain' });
});

// ---------------------------------------------------------------------------
// The report state machine
// ---------------------------------------------------------------------------

/** The response shape every state-machine route answers with. */
function answer(res: Response, outcome: ReportOutcome) {
  if (!outcome.ok) {
    return res.status(outcome.status).json({ success: false, error: outcome.error });
  }
  return res.json({ success: true, report: outcome.report, finalized: outcome.finalized });
}

/**
 * Who this request acts for in this match. Admins are admins; everyone else
 * has to captain one of the two teams. `?as=captain` makes an admin act as the
 * captain they are, so one signed-in admin can play both sides in a test.
 */
async function actorFor(req: Request, match: DbMatchRow): Promise<ReportActor | null> {
  const viewer = await resolveViewerAccount(req);
  const asCaptain = req.query.as === 'captain';
  return resolveActor(match, viewer.uid, { isAdmin: viewer.isAdmin && !asCaptain });
}

async function matchOr404(req: Request, res: Response): Promise<DbMatchRow | null> {
  const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
    req.params.slug,
  ]);
  if (!match) {
    res.status(404).json({ success: false, error: `Match '${req.params.slug}' not found` });
    return null;
  }
  return match;
}

/** Every report for a match, newest first, plus the one that is open. */
manualReportTestRoutes.get('/:slug/reports', async (req: Request, res: Response) => {
  const match = await matchOr404(req, res);
  if (!match) return;
  return res.json({
    success: true,
    matchStatus: match.status,
    winnerId: match.winner_id,
    open: await openReport(match.slug),
    reports: await listReports(match.slug),
  });
});

const actions: Array<{
  path: string;
  run: (match: DbMatchRow, actor: ReportActor, body: Record<string, unknown>) => Promise<ReportOutcome>;
}> = [
  {
    path: '/:slug/report',
    run: (match, actor, body) =>
      submitReport({
        matchSlug: match.slug,
        actor,
        result: body.result ?? body,
        // Custom stat values ride with the report (PR D6); the helpers take
        // them too, so the state machine is driven the same way here.
        ...(body.stats === undefined ? {} : { stats: body.stats }),
      }),
  },
  { path: '/:slug/confirm', run: (match, actor) => confirmReport({ matchSlug: match.slug, actor }) },
  {
    path: '/:slug/dispute',
    run: (match, actor, body) =>
      disputeReport({
        matchSlug: match.slug,
        actor,
        ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
      }),
  },
  { path: '/:slug/withdraw', run: (match, actor) => withdrawReport({ matchSlug: match.slug, actor }) },
  {
    path: '/:slug/resolve',
    run: (match, actor, body) =>
      adminResolve({
        matchSlug: match.slug,
        actor,
        ...(body.result !== undefined ? { result: body.result } : {}),
        ...(body.stats === undefined ? {} : { stats: body.stats }),
      }),
  },
  {
    path: '/:slug/override',
    run: (match, actor, body) =>
      adminOverride({
        matchSlug: match.slug,
        actor,
        result: body.result ?? body,
        ...(body.stats === undefined ? {} : { stats: body.stats }),
      }),
  },
  { path: '/:slug/reopen', run: (match, actor) => reopenMatch({ matchSlug: match.slug, actor }) },
];

for (const { path, run } of actions) {
  manualReportTestRoutes.post(path, async (req: Request, res: Response) => {
    const match = await matchOr404(req, res);
    if (!match) return;
    const actor = await actorFor(req, match);
    if (!actor) {
      return res.status(403).json({
        success: false,
        error: 'That account captains neither team and is not an admin',
      });
    }
    try {
      return answer(res, await run(match, actor, (req.body ?? {}) as Record<string, unknown>));
    } catch (error) {
      log.error(`[MANUAL-REPORT] ${path} failed`, error, { slug: match.slug });
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Report action failed',
      });
    }
  });
}

/**
 * Run one timeout sweep now, rather than waiting for the 60-second interval.
 * A test sets a deadline in the past and calls this.
 */
manualReportTestRoutes.post('/sweep', async (_req: Request, res: Response) => {
  await sweepOnce();
  return res.json({ success: true });
});

/**
 * Move an open report's deadline, so a test does not have to wait hours for
 * one to pass. `minutesFromNow` may be negative, which is the point.
 */
manualReportTestRoutes.post('/:slug/deadline', async (req: Request, res: Response) => {
  const match = await matchOr404(req, res);
  if (!match) return;
  const open = await openReport(match.slug);
  if (!open) {
    return res.status(404).json({ success: false, error: 'No open report' });
  }
  const body = (req.body ?? {}) as { minutesFromNow?: unknown };
  const minutes = Number(body.minutesFromNow);
  if (!Number.isFinite(minutes)) {
    return res.status(400).json({ success: false, error: 'minutesFromNow must be a number' });
  }
  const deadline = Math.floor(Date.now() / 1000) + Math.round(minutes * 60);
  await db.updateAsync('match_reports', { confirm_deadline: deadline }, 'id = ?', [open.id]);
  return res.json({ success: true, confirmDeadline: deadline });
});
