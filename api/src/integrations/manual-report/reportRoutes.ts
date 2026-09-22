/**
 * The captain side of manual reporting, over HTTP (3.0 phase D, PR D4).
 *
 * Mounted at `/api/game/manual`. The state machine (`./reports`) has been
 * callable since D3; this is the door onto it for the two people who actually
 * know the score.
 *
 *   GET  /api/game/manual/matches/:slug            what the report page shows
 *   POST /api/game/manual/matches/:slug/report     a captain reports a result
 *   POST /api/game/manual/matches/:slug/confirm    the opponent agrees
 *   POST /api/game/manual/matches/:slug/dispute    the opponent disagrees
 *   POST /api/game/manual/matches/:slug/withdraw   the reporter takes it back
 *
 * **Answering names a revision.** `confirm` must carry the revision it is
 * answering and `dispute`/`withdraw` may; a number that is no longer the open
 * report's comes back **409**. Two captains on the same match race otherwise:
 * a second report supersedes the first and takes the next revision, and
 * without the check the opponent would confirm a result they never read.
 *
 * **Who may act** comes from `./http`: the account is a `players.uid` from
 * `resolveViewerAccount`, the side is looked up against the match's two team
 * ids, and a caller who captains neither team is refused — 401 when they are
 * not signed in at all, 403 when they are simply not in this match. A captain
 * of a team in *another* tournament is the same 403: they captain neither of
 * these two teams.
 *
 * Nothing here emits: every transition the state machine makes announces
 * itself with `emitTournament(tournamentId, 'match:report', …)`, on the
 * tournament the match row names.
 *
 * The admin side — resolve, reopen, the dispute queue and the tournament's
 * custom fields — is PR D5 (`./adminRoutes`). No client UI yet: D7 and D8.
 */

import { Router, type Request, type Response } from 'express';
import {
  answer,
  guarded,
  matchForRequest,
  readRevision,
  teamNames,
  viewerForMatch,
} from './http';
import {
  confirmReport,
  disputeReport,
  listReports,
  openReport,
  reportingRules,
  submitReport,
  withdrawReport,
  type ReportActor,
  type ReportOutcome,
} from './reports';

export const manualReportRoutes = Router();

/**
 * Everything a report page needs for one match: where the match is, the rules
 * it was built with, every report made for it, and what this viewer may do
 * next.
 *
 * Guarded like the actions rather than left public: a match's disputed and
 * withdrawn reports are an argument between two teams, not a scoreboard.
 */
manualReportRoutes.get('/matches/:slug', async (req: Request, res: Response) => {
  await guarded(res, 'GET /matches/:slug', async () => {
    const match = await matchForRequest(req, res);
    if (!match) return;
    const viewer = await viewerForMatch(req, res, match, 'see this match');
    if (!viewer) return;

    const [open, reports, teams] = await Promise.all([
      openReport(match.slug),
      listReports(match.slug),
      teamNames(match),
    ]);

    const { actor } = viewer;
    const isCaptain = actor.role === 'captain' && actor.team !== null;
    // The opponent answers, never the reporter — the same rule `mayAnswer`
    // applies, reported here so the page can grey the buttons out rather than
    // offer an action that is going to come back 403.
    const mayAnswer =
      open !== null &&
      open.status === 'submitted' &&
      (actor.role === 'admin' ||
        (isCaptain && open.submittedByTeam !== null && actor.team !== open.submittedByTeam));

    res.json({
      success: true,
      match: {
        slug: match.slug,
        status: match.status,
        round: match.round,
        bracket: match.bracket ?? null,
        tournamentId: match.tournament_id,
        winnerId: match.winner_id ?? null,
        ...teams,
      },
      rules: reportingRules(match),
      viewer: {
        team: actor.team,
        role: actor.role,
        canReport: open === null || open.status === 'submitted',
        canConfirm: mayAnswer,
        canDispute: mayAnswer,
        canWithdraw:
          open !== null &&
          open.status === 'submitted' &&
          (actor.role === 'admin' || (isCaptain && actor.team === open.submittedByTeam)),
      },
      open,
      reports,
    });
  });
});

/**
 * Report a result.
 *
 * The body is `{ result: { maps: [...], note? } }`, checked against the
 * match's own rules by `validateResult` — 400 for anything a best-of-N cannot
 * be. An open report from before is superseded, not replaced.
 */
manualReportRoutes.post('/matches/:slug/report', async (req: Request, res: Response) => {
  await guarded(res, 'POST /matches/:slug/report', async () => {
    const match = await matchForRequest(req, res);
    if (!match) return;
    const viewer = await viewerForMatch(req, res, match, 'report a result');
    if (!viewer) return;

    const body = (req.body ?? {}) as { result?: unknown };
    answer(
      res,
      await submitReport({
        matchSlug: match.slug,
        actor: viewer.actor,
        result: body.result ?? body,
      })
    );
  });
});

/** The three ways to answer an open report, which differ only in what they call. */
interface AnswerRoute {
  path: string;
  /** Finishes the "Sign in to …" of a 401. */
  what: string;
  /**
   * Whether the caller has to name the revision. Confirming means agreeing to
   * a result, so it does; taking your own report back or saying it is wrong
   * does not need you to have read the latest one, though it is checked when
   * given.
   */
  revisionRequired: boolean;
  run: (
    slug: string,
    revision: number | undefined,
    actor: ReportActor,
    body: { reason?: unknown }
  ) => Promise<ReportOutcome>;
}

const answers: AnswerRoute[] = [
  {
    path: '/matches/:slug/confirm',
    what: 'confirm a result',
    revisionRequired: true,
    run: (matchSlug, revision, actor) =>
      confirmReport({
        matchSlug,
        actor,
        ...(revision === undefined ? {} : { expectedRevision: revision }),
      }),
  },
  {
    path: '/matches/:slug/dispute',
    what: 'dispute a result',
    revisionRequired: false,
    run: (matchSlug, revision, actor, body) =>
      disputeReport({
        matchSlug,
        actor,
        ...(revision === undefined ? {} : { expectedRevision: revision }),
        ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
      }),
  },
  {
    path: '/matches/:slug/withdraw',
    what: 'withdraw a report',
    revisionRequired: false,
    run: (matchSlug, revision, actor) =>
      withdrawReport({
        matchSlug,
        actor,
        ...(revision === undefined ? {} : { expectedRevision: revision }),
      }),
  },
];

for (const { path, what, revisionRequired, run } of answers) {
  manualReportRoutes.post(path, async (req: Request, res: Response) => {
    await guarded(res, `POST ${path}`, async () => {
      const match = await matchForRequest(req, res);
      if (!match) return;
      const viewer = await viewerForMatch(req, res, match, what);
      if (!viewer) return;

      const body = (req.body ?? {}) as { revision?: unknown; reason?: unknown };
      const revision = readRevision(body.revision);
      if (revision === null) {
        res
          .status(400)
          .json({ success: false, error: 'revision must be the number of the report you are answering' });
        return;
      }
      if (revisionRequired && revision === undefined) {
        res.status(400).json({
          success: false,
          error: 'revision is required, so you cannot confirm a report you have not read',
        });
        return;
      }

      answer(res, await run(match.slug, revision, viewer.actor, body));
    });
  });
}
