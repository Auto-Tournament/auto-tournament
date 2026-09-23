/**
 * What every manual-report HTTP route needs before it can act (3.0 phase D,
 * PR D4).
 *
 * The state machine in `./reports` takes a `ReportActor` — an account uid, a
 * role and, for a captain, which of the two sides they are. This turns an
 * Express request into one, and answers the request itself when it cannot.
 *
 * Three rules shape it:
 *
 * - **Everything is keyed on `players.uid`.** `resolveViewerAccount` is the one
 *   place that turns whatever a request signed in with into an account, so no
 *   Steam ID reaches the state machine. When `players.id` stops being a Steam
 *   ID in 3.1, nothing here changes.
 * - **Which team the caller is on comes from the match row**, the same shape
 *   the CS2 veto routes use (`integrations/cs2/veto/routes.ts`): the two team
 *   ids on the match, and membership looked up against each. Veto reads the
 *   roster because a veto is played by whoever turns up; reporting a result is
 *   an act with consequences, so it goes through `team_members` and its
 *   captain role instead (`resolveActor`).
 * - **Captain first, admin second.** An admin who captains one of the two
 *   teams acts as that captain on the captain routes, not as an admin, so an
 *   admin walking a real team through a report produces a real team's report
 *   that the opponent still has to answer. Every admin-only route checks
 *   `isAdmin` outright and never takes this path.
 *
 * `isAdmin` is the *real* signed-in user's flag: impersonation never grants
 * admin (see `resolveViewerIdentity`), and an admin impersonating a captain is
 * that captain here, which is how the API tests play both sides of a match.
 */

import type { Request, Response } from 'express';
import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { resolveViewerAccount, type ViewerAccount } from '../../utils/viewerIdentity';
import type { DbMatchRow } from '../../types/database.types';
import {
  isManualReportMatch,
  resolveActor,
  type ReportActor,
  type ReportOutcome,
} from './reports';

/** The response body every state-machine route answers with. */
export function answer(res: Response, outcome: ReportOutcome): Response {
  if (!outcome.ok) {
    return res.status(outcome.status).json({ success: false, error: outcome.error });
  }
  return res.json({ success: true, report: outcome.report, finalized: outcome.finalized });
}

/**
 * The match this route is about, or null once the 404 has been sent.
 *
 * A match another module owns is refused rather than reported on: this router
 * is mounted for everyone, and a CS2 match's result comes from the game.
 */
export async function matchForRequest(
  req: Request,
  res: Response,
  opts: { requireManualReport?: boolean } = {}
): Promise<DbMatchRow | null> {
  const slug = req.params.slug;
  const match = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug]);
  if (!match) {
    res.status(404).json({ success: false, error: `Match '${slug}' not found` });
    return null;
  }
  if (opts.requireManualReport !== false && !isManualReportMatch(match)) {
    res.status(409).json({
      success: false,
      error: `Match '${match.slug}' is not reported manually`,
    });
    return null;
  }
  return match;
}

/** Who this request is, and what they may do in this match. */
export interface MatchViewer {
  account: ViewerAccount;
  actor: ReportActor;
}

/**
 * Resolve the caller as an actor in this match, or answer the request.
 *
 * - not signed in at all → **401**
 * - signed in, but on neither team and not an admin → **403**
 *
 * The same two codes the rest of the API uses for "who are you" and "not you"
 * (`routes/me.ts`).
 */
export async function viewerForMatch(
  req: Request,
  res: Response,
  match: DbMatchRow,
  what: string
): Promise<MatchViewer | null> {
  const account = await resolveViewerAccount(req);
  if (!account.playerId && !account.isAdmin) {
    res.status(401).json({ success: false, error: `Sign in to ${what}` });
    return null;
  }

  // Captain first: an admin who captains one of these teams is that captain
  // here, so the opponent still has to answer their report.
  const asCaptain = await resolveActor(match, account.uid);
  const actor: ReportActor | null =
    asCaptain ?? (account.isAdmin ? { uid: account.uid, role: 'admin', team: null } : null);

  if (!actor) {
    res.status(403).json({
      success: false,
      error: 'You captain neither team in this match, so you cannot act on its result',
    });
    return null;
  }
  return { account, actor };
}

/**
 * Admin-only routes still need the acting account, so the audit trail records
 * a person rather than "an admin". `requireAuth` has already let the request
 * through; a service token has no account, and is recorded as one.
 */
export async function adminActor(req: Request): Promise<ReportActor> {
  const account = await resolveViewerAccount(req);
  return { uid: account.uid, role: 'admin', team: null };
}

/** Run a route body, turning anything thrown into a 500 rather than a hang. */
export async function guarded(
  res: Response,
  where: string,
  run: () => Promise<unknown>
): Promise<void> {
  try {
    await run();
  } catch (error) {
    log.error(`[manual-report] ${where} failed`, error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Manual reporting failed',
      });
    }
  }
}

/**
 * The tournament a `/tournaments/:tournamentId/...` route is about, or null
 * once the 400 or 404 has been sent. Shared by the fields routes (PR D5) and
 * the stats listing (PR D6) so they cannot disagree about what a bad id is.
 */
export async function tournamentForRequest(req: Request, res: Response): Promise<number | null> {
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

/** A positive integer from a request body, or undefined when it is absent. */
export function readRevision(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/** One person who may have a per-player number recorded against them. */
export interface RosterMember {
  /** `players.uid` — what a stat value is filed against, and nothing else. */
  accountUid: string;
  role: 'captain' | 'member';
  /** `players.id`, still a Steam id in 3.0; null when the row has gone. */
  playerId: string | null;
  name: string | null;
}

/**
 * Who is on each side of a match (3.0 phase D, PR D8).
 *
 * A per-player custom stat field is filed against a `players.uid`
 * (`./statValues`), and until now nothing a **captain** could call handed one
 * out — `GET /teams/:id/members` is on the admin router. So a report form had
 * no way to offer "goals, per player" to the person filling it in. This is
 * that list, and it rides on the match view, which is already guarded to the
 * two captains and an admin: the uids of the ten people in a match are not a
 * secret from the two captains playing it.
 *
 * `team_members` rather than `teams.players`, because that is what a value is
 * checked against — a roster entry with no membership row could never carry a
 * number, so offering it would be a form that cannot be submitted.
 */
export async function teamRosters(match: DbMatchRow): Promise<Map<string, RosterMember[]>> {
  const ids = [match.team1_id, match.team2_id].filter((id): id is string => Boolean(id));
  const byTeam = new Map<string, RosterMember[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return byTeam;

  const rows = await db.queryAsync<{
    team_id: string;
    account_uid: string;
    role: string;
    player_id: string | null;
    name: string | null;
  }>(
    `SELECT tm.team_id, tm.account_uid, tm.role, p.id AS player_id, p.name AS name
       FROM team_members tm
       LEFT JOIN players p ON p.uid = tm.account_uid
      WHERE tm.team_id = ANY(?::text[])
      ORDER BY (tm.role = 'captain') DESC, p.name NULLS LAST, tm.account_uid`,
    [ids]
  );
  for (const row of rows) {
    byTeam.get(row.team_id)?.push({
      accountUid: row.account_uid,
      role: row.role === 'captain' ? 'captain' : 'member',
      playerId: row.player_id,
      name: row.name,
    });
  }
  return byTeam;
}

/** The two teams of a match, by name, for a client that has only the slugs. */
export async function teamNames(
  match: DbMatchRow
): Promise<{ team1: { id: string | null; name: string | null }; team2: { id: string | null; name: string | null } }> {
  const ids = [match.team1_id ?? null, match.team2_id ?? null];
  const rows = ids.some(Boolean)
    ? await db.queryAsync<{ id: string; name: string }>(
        'SELECT id, name FROM teams WHERE id = ANY(?::text[])',
        [ids.filter((id): id is string => Boolean(id))]
      )
    : [];
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return {
    team1: { id: ids[0], name: ids[0] ? (byId.get(ids[0]) ?? match.team1_name ?? null) : null },
    team2: { id: ids[1], name: ids[1] ? (byId.get(ids[1]) ?? match.team2_name ?? null) : null },
  };
}
