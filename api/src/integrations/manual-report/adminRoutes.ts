/**
 * The admin side of manual reporting, over HTTP (3.0 phase D, PR D5).
 *
 * Mounted at `/api/game/manual`, next to the captain routes (`./reportRoutes`,
 * PR D4). Everything here is behind `requireAuth`, which is what "admin" means
 * everywhere else in this API — a session, a signed cookie or a service token.
 *
 *   GET  /api/game/manual/disputes                      what is waiting for you
 *   POST /api/game/manual/matches/:slug/resolve         settle an open report
 *   POST /api/game/manual/matches/:slug/reopen          undo a finished match
 *   GET  /api/game/manual/tournaments/:id/fields        the extra fields asked for
 *   PUT  /api/game/manual/tournaments/:id/fields        set them
 *   POST /api/game/manual/teams/:teamId/captain         who may report for a team
 *
 * **The dispute queue** is everything an admin has to look at: a report the
 * opponent disagreed with, and a report whose deadline passed on a tournament
 * that escalates rather than auto-confirms (which leaves the report open and
 * the match `needs_decision`). Both arrive here; nothing else does.
 *
 * **Captains** is not an afterthought. D1's backfill found no captain
 * information anywhere in 2.x and created none, so on a real upgraded instance
 * `team_members` is all members and *nobody* can report. This is the route
 * that fixes that, and without it D4's routes are unreachable outside tests.
 *
 * `adminOverride` is deliberately **not** exposed. `resolve` with a result of
 * the admin's own covers settling an argument, and setting a result on a match
 * with no report at all is `reopen` followed by a report — one door, with the
 * downstream checks `reopen` makes, rather than two.
 */

import { Router, type Request, type Response } from 'express';
import { db } from '../../config/database';
import { requireAuth } from '../../middleware/auth';
import { emitTournament } from '../../services/socketService';
import { teamMembers, type TeamMemberRole } from '../../services/teamMembers';
import { NEEDS_DECISION_STATUS } from '../../utils/matchStatusHelpers';
import type { DbMatchRow } from '../../types/database.types';
import type { DbMatchReportRow } from '../../types/matchReport.types';
import { adminActor, answer, guarded, matchForRequest } from './http';
import { listFields, replaceFields, validateFields } from './fields';
import {
  adminResolve,
  isManualReportMatch,
  reopenMatch,
  type MatchReport,
} from './reports';

export const manualReportAdminRoutes = Router();

manualReportAdminRoutes.use(requireAuth);

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

interface DisputeRow extends DbMatchReportRow {
  match_status: string;
  match_round: number;
  match_bracket: string | null;
  tournament_id: number | null;
  team1_id: string | null;
  team2_id: string | null;
  config: string | null;
  slug: string;
}

/**
 * Every report waiting for an admin, oldest first.
 *
 * Two shapes qualify, and the query asks for both rather than for "disputed":
 * a disputed report, and one still `submitted` whose match has been parked at
 * `needs_decision` by an escalated timeout. Filter with `?tournamentId=`, and
 * cap with `?limit=` (50 by default).
 */
manualReportAdminRoutes.get('/disputes', async (req: Request, res: Response) => {
  await guarded(res, 'GET /disputes', async () => {
    const tournamentId = Number(req.query.tournamentId);
    const limitRaw = Number(req.query.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;

    const rows = await db.queryAsync<DisputeRow>(
      `SELECT r.*,
              m.slug AS slug,
              m.status AS match_status,
              m.round AS match_round,
              m.bracket AS match_bracket,
              m.tournament_id AS tournament_id,
              m.team1_id AS team1_id,
              m.team2_id AS team2_id,
              m.config AS config
         FROM match_reports r
         JOIN matches m ON m.slug = r.match_slug
        WHERE r.status IN ('submitted', 'disputed')
          AND (r.status = 'disputed' OR m.status = ?)
          AND (? = 0 OR m.tournament_id = ?)
        ORDER BY COALESCE(r.disputed_at, r.created_at), r.id
        LIMIT ?`,
      [
        NEEDS_DECISION_STATUS,
        Number.isInteger(tournamentId) && tournamentId > 0 ? tournamentId : 0,
        Number.isInteger(tournamentId) && tournamentId > 0 ? tournamentId : 0,
        limit,
      ]
    );

    // Only this module's matches. Read off the stored config rather than
    // through the registry, which an integration must not import.
    const mine = rows.filter((row) =>
      isManualReportMatch({ config: row.config ?? undefined } as DbMatchRow)
    );

    const teamIds = [...new Set(mine.flatMap((r) => [r.team1_id, r.team2_id]).filter(Boolean))];
    const teams = teamIds.length
      ? await db.queryAsync<{ id: string; name: string }>(
          'SELECT id, name FROM teams WHERE id = ANY(?::text[])',
          [teamIds]
        )
      : [];
    const nameOf = new Map(teams.map((t) => [t.id, t.name]));

    res.json({
      success: true,
      disputes: mine.map((row) => ({
        matchSlug: row.match_slug,
        tournamentId: row.tournament_id,
        matchStatus: row.match_status,
        round: row.match_round,
        bracket: row.match_bracket,
        team1: { id: row.team1_id, name: row.team1_id ? (nameOf.get(row.team1_id) ?? null) : null },
        team2: { id: row.team2_id, name: row.team2_id ? (nameOf.get(row.team2_id) ?? null) : null },
        // An escalated timeout leaves the report `submitted` with no deadline;
        // a real disagreement is `disputed`. Saying which saves the client a
        // guess at why it is here.
        reason: row.status === 'disputed' ? 'disputed' : 'timeout',
        report: reportOf(row),
      })),
    });
  });
});

/** The report fields of a joined row, as the captain routes return them. */
function reportOf(row: DisputeRow): Partial<MatchReport> & { revision: number } {
  let result: unknown = null;
  try {
    result = JSON.parse(row.result);
  } catch {
    result = null;
  }
  return {
    id: row.id,
    matchSlug: row.match_slug,
    revision: Number(row.revision),
    status: row.status as MatchReport['status'],
    source: row.source === 'admin' ? 'admin' : 'report',
    submittedByUid: row.submitted_by_uid,
    submittedByTeam: (row.submitted_by_team as MatchReport['submittedByTeam']) ?? null,
    result: result as MatchReport['result'],
    disputedByUid: row.disputed_by_uid,
    disputedAt: row.disputed_at === null ? null : Number(row.disputed_at),
    disputeReason: row.dispute_reason,
    createdAt: Number(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

/**
 * Settle the open report: as it stands, or with a result of the admin's own.
 *
 * With a `result` in the body the admin's version is stored as its own
 * revision (`source: 'admin'`) and the open one is superseded, so the
 * disagreement and its ruling are both on the record.
 */
manualReportAdminRoutes.post('/matches/:slug/resolve', async (req: Request, res: Response) => {
  await guarded(res, 'POST /matches/:slug/resolve', async () => {
    const match = await matchForRequest(req, res);
    if (!match) return;
    const body = (req.body ?? {}) as { result?: unknown };
    answer(
      res,
      await adminResolve({
        matchSlug: match.slug,
        actor: await adminActor(req),
        ...(body.result === undefined ? {} : { result: body.result }),
      })
    );
  });
});

/**
 * Undo a finished match so it can be reported again.
 *
 * Refused unless the tournament is still running, every match this one feeds
 * is still waiting, and no player in it has been rated since — `reopenMatch`
 * checks all three and explains which one stopped it.
 */
manualReportAdminRoutes.post('/matches/:slug/reopen', async (req: Request, res: Response) => {
  await guarded(res, 'POST /matches/:slug/reopen', async () => {
    const match = await matchForRequest(req, res);
    if (!match) return;
    answer(res, await reopenMatch({ matchSlug: match.slug, actor: await adminActor(req) }));
  });
});

// ---------------------------------------------------------------------------
// The extra fields a tournament asks for
// ---------------------------------------------------------------------------

async function tournamentOr404(req: Request, res: Response): Promise<number | null> {
  const id = Number(req.params.tournamentId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'tournamentId must be a positive integer' });
    return null;
  }
  const row = await db.queryOneAsync<{ id: number }>('SELECT id FROM tournament WHERE id = ?', [id]);
  if (!row) {
    res.status(404).json({ success: false, error: `Tournament ${id} not found` });
    return null;
  }
  return id;
}

manualReportAdminRoutes.get(
  '/tournaments/:tournamentId/fields',
  async (req: Request, res: Response) => {
    await guarded(res, 'GET /tournaments/:tournamentId/fields', async () => {
      const tournamentId = await tournamentOr404(req, res);
      if (tournamentId === null) return;
      res.json({ success: true, tournamentId, fields: await listFields(tournamentId) });
    });
  }
);

/**
 * Set the whole list. A field that keeps its key keeps its recorded values; a
 * key that is dropped takes them with it (see `replaceFields`).
 */
manualReportAdminRoutes.put(
  '/tournaments/:tournamentId/fields',
  async (req: Request, res: Response) => {
    await guarded(res, 'PUT /tournaments/:tournamentId/fields', async () => {
      const tournamentId = await tournamentOr404(req, res);
      if (tournamentId === null) return;

      const body = (req.body ?? {}) as { fields?: unknown };
      const check = validateFields(Array.isArray(body.fields) ? body.fields : body);
      if (!check.ok) {
        res.status(400).json({ success: false, error: check.error });
        return;
      }

      const fields = await replaceFields(tournamentId, check.fields);
      emitTournament(tournamentId, 'match:report-fields', { fields });
      res.json({ success: true, tournamentId, fields });
    });
  }
);

// ---------------------------------------------------------------------------
// Captains
// ---------------------------------------------------------------------------

interface TeamMemberView {
  accountUid: string;
  role: string;
  /** `players.id` — still the Steam id in 3.0, absent if the row has gone. */
  playerId: string | null;
  name: string | null;
}

/** A team's memberships with the person behind each one, captains first. */
async function membersOf(teamId: string): Promise<TeamMemberView[]> {
  const rows = await db.queryAsync<{
    account_uid: string;
    role: string;
    player_id: string | null;
    name: string | null;
  }>(
    `SELECT tm.account_uid, tm.role, p.id AS player_id, p.name AS name
       FROM team_members tm
       LEFT JOIN players p ON p.uid = tm.account_uid
      WHERE tm.team_id = ?
      ORDER BY (tm.role = 'captain') DESC, tm.created_at, tm.account_uid`,
    [teamId]
  );
  return rows.map((row) => ({
    accountUid: row.account_uid,
    role: row.role === 'captain' ? 'captain' : 'member',
    playerId: row.player_id,
    name: row.name,
  }));
}

/**
 * Say who may report for a team.
 *
 * `POST /api/game/manual/teams/:teamId/captain` with `{ uid, role }`, where
 * `uid` is a `players.uid` and `role` is `captain` or `member`. The account
 * has to be on the team already — `teams.players` is the roster of record and
 * `teamMembers.syncFromRoster` mirrors it, so this changes a role and never
 * adds a player to a team behind the roster's back.
 */
manualReportAdminRoutes.post('/teams/:teamId/captain', async (req: Request, res: Response) => {
  await guarded(res, 'POST /teams/:teamId/captain', async () => {
    const { teamId } = req.params;
    const body = (req.body ?? {}) as { uid?: unknown; role?: unknown };

    const uid = typeof body.uid === 'string' ? body.uid.trim() : '';
    if (!uid) {
      res.status(400).json({ success: false, error: 'uid is required (a players.uid)' });
      return;
    }
    const role: TeamMemberRole = body.role === 'member' ? 'member' : 'captain';

    const team = await db.queryOneAsync<{ id: string }>('SELECT id FROM teams WHERE id = ?', [teamId]);
    if (!team) {
      res.status(404).json({ success: false, error: `Team '${teamId}' not found` });
      return;
    }

    const current = await teamMembers.roleFor(teamId, uid);
    if (current === null) {
      res.status(409).json({
        success: false,
        error: `${uid} is not on team '${teamId}'. Add them to the roster first.`,
      });
      return;
    }

    const ok = await teamMembers.setRole(teamId, uid, role);
    if (!ok) {
      res.status(409).json({ success: false, error: `Could not make ${uid} a ${role} of '${teamId}'` });
      return;
    }
    res.json({ success: true, teamId, uid, role, members: await membersOf(teamId) });
  });
});

/**
 * Who may report for a team today.
 *
 * `team_members` is keyed on `players.uid`, which is the id the promote route
 * takes and the one nothing outside phase D exposes. Joining `players` here
 * is what lets an admin screen show "Ada (captain)" and send back a uid,
 * rather than asking whoever is at the keyboard to find one.
 */
manualReportAdminRoutes.get('/teams/:teamId/members', async (req: Request, res: Response) => {
  await guarded(res, 'GET /teams/:teamId/members', async () => {
    const { teamId } = req.params;
    const team = await db.queryOneAsync<{ id: string }>('SELECT id FROM teams WHERE id = ?', [teamId]);
    if (!team) {
      res.status(404).json({ success: false, error: `Team '${teamId}' not found` });
      return;
    }
    res.json({ success: true, teamId, members: await membersOf(teamId) });
  });
});
