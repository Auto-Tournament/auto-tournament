/**
 * The manual-report state machine (3.0 phase D, PR D3).
 *
 * A game with no servers and no events still has two teams who know the score.
 * This is what happens between them typing it in and the bracket moving:
 *
 *                      submit
 *                        |
 *                   [submitted] --- withdraw ---> [withdrawn]
 *                    /   |   \ \
 *          confirm  /    |    \ `--- submit (again) ---> [superseded]
 *                  /  dispute  \
 *                 /      |      `--- deadline, timeout_action:
 *                /       |            auto_confirm -> confirm
 *        [confirmed]  [disputed]      escalate     -> match needs_decision,
 *              |          |                           report stays open
 *              |     admin resolve
 *              |          |
 *              `----------'
 *                    |
 *            applySeriesResult
 *
 * Rules that shape it:
 *
 * - **At most one open report per match** (`submitted` or `disputed`), enforced
 *   by a partial unique index from D1. A new report does not replace the open
 *   one, it supersedes it, so the history and the audit trail stay whole.
 * - **Every account is a `players.uid`**, never a Steam ID, so a 3.1 account
 *   with no Steam account can captain a team and report a result. Who may act
 *   comes from `team_members` (D1), through `resolveActor`.
 * - **Confirmation comes from the opponent**, never from the side that
 *   reported: the point of asking is that someone else agrees.
 * - **Finalizing always goes through `matchLifecycle.applySeriesResult`**, the
 *   same call CS2's `series.ended` makes, with `source: 'report' | 'admin'`.
 *   Bracket progression, ratings, Swiss pairing and tournament completion then
 *   run exactly as they do for a watched game. Final scores are written to
 *   `match_map_results` by that call; a game with no maps stores `map_name`
 *   NULL.
 * - **The tournament comes from the match row** (`tournamentIdForMatch`), not
 *   from a "the tournament" lookup, and socket events are emitted with
 *   `emitTournament(tournamentId, …)`, both for 3.1.
 *
 * Timeouts are swept by `./sweeper`, not by a timer per report, so a deadline
 * that passed while the API was down is still acted on at the next sweep.
 *
 * The captain and admin HTTP routes are PR D4 and D5. Everything here is
 * callable and tested without them.
 */

import { db } from '../../config/database';
import { log } from '../../utils/logger';
import { emitMatchUpdate, emitBracketUpdate, emitTournament } from '../../services/socketService';
import { matchLifecycle } from '../../core/matchLifecycle';
import { teamMembers } from '../../services/teamMembers';
import { tournamentIdForMatch } from '../../utils/tournamentRow';
import { NEEDS_DECISION_STATUS } from '../../utils/matchStatusHelpers';
import type { DbMatchRow } from '../../types/database.types';
import type {
  DbMatchReportRow,
  MatchReportAction,
  MatchReportActorRole,
  MatchReportConfirmation,
  MatchReportStatus,
  MatchReportTimeoutAction,
  ReportedMapResult,
  ReportedResult,
} from '../../types/matchReport.types';
import type { GameResult, SeriesResult, TeamSide } from '../types';
import { MANUAL_REPORT_GAME_ID } from './catalog';

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** Who is acting, and for which side. `team` is null for an admin or the sweeper. */
export interface ReportActor {
  /** `players.uid`; null only for the sweeper. */
  uid: string | null;
  role: MatchReportActorRole;
  team: TeamSide | null;
}

export const SYSTEM_ACTOR: ReportActor = { uid: null, role: 'system', team: null };

/** A report as the rest of the app sees it: the row, with its JSON parsed. */
export interface MatchReport {
  id: number;
  matchSlug: string;
  revision: number;
  status: MatchReportStatus;
  source: 'report' | 'admin';
  submittedByUid: string | null;
  submittedByTeam: TeamSide | null;
  result: ReportedResult;
  confirmation: MatchReportConfirmation;
  confirmDeadline: number | null;
  timeoutAction: MatchReportTimeoutAction | null;
  confirmedByUid: string | null;
  confirmedAt: number | null;
  disputedByUid: string | null;
  disputedAt: number | null;
  disputeReason: string | null;
  resolvedByUid: string | null;
  resolvedAt: number | null;
  createdAt: number;
}

export type ReportOutcome =
  | {
      ok: true;
      report: MatchReport;
      /** The series was finished through `applySeriesResult` by this call. */
      finalized: boolean;
    }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ReportOutcome => ({ ok: false, status, error });

/** Statuses a match can take a report in. A finished one needs a reopen first. */
const REPORTABLE_STATUSES = new Set(['ready', 'loaded', 'live', NEEDS_DECISION_STATUS]);

const now = (): number => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function parseResult(json: string): ReportedResult {
  try {
    const value: unknown = JSON.parse(json);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const r = value as Partial<ReportedResult>;
      return {
        maps: Array.isArray(r.maps) ? r.maps : [],
        seriesTeam1Score: Number(r.seriesTeam1Score) || 0,
        seriesTeam2Score: Number(r.seriesTeam2Score) || 0,
        winner: r.winner ?? null,
        note: r.note ?? null,
      };
    }
  } catch {
    // A stored result that will not parse describes as an empty series rather
    // than throwing: reading a match's history must never fail on one row.
  }
  return { maps: [], seriesTeam1Score: 0, seriesTeam2Score: 0, winner: null, note: null };
}

function toReport(row: DbMatchReportRow): MatchReport {
  return {
    id: row.id,
    matchSlug: row.match_slug,
    revision: Number(row.revision),
    status: row.status as MatchReportStatus,
    source: row.source === 'admin' ? 'admin' : 'report',
    submittedByUid: row.submitted_by_uid,
    submittedByTeam: (row.submitted_by_team as TeamSide | null) ?? null,
    result: parseResult(row.result),
    confirmation: row.confirmation === 'none' ? 'none' : 'opponent',
    confirmDeadline: row.confirm_deadline === null ? null : Number(row.confirm_deadline),
    timeoutAction: (row.timeout_action as MatchReportTimeoutAction | null) ?? null,
    confirmedByUid: row.confirmed_by_uid,
    confirmedAt: row.confirmed_at === null ? null : Number(row.confirmed_at),
    disputedByUid: row.disputed_by_uid,
    disputedAt: row.disputed_at === null ? null : Number(row.disputed_at),
    disputeReason: row.dispute_reason,
    resolvedByUid: row.resolved_by_uid,
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
    createdAt: Number(row.created_at),
  };
}

/** Every report for a match, newest revision first. */
export async function listReports(matchSlug: string): Promise<MatchReport[]> {
  const rows = await db.queryAsync<DbMatchReportRow>(
    'SELECT * FROM match_reports WHERE match_slug = ? ORDER BY revision DESC',
    [matchSlug]
  );
  return rows.map(toReport);
}

/** The one open report (`submitted` or `disputed`), or null. */
export async function openReport(matchSlug: string): Promise<MatchReport | null> {
  const row = await db.queryOneAsync<DbMatchReportRow>(
    `SELECT * FROM match_reports
      WHERE match_slug = ? AND status IN ('submitted', 'disputed')`,
    [matchSlug]
  );
  return row ? toReport(row) : null;
}

/** The report a match's result was taken from, if any. */
export async function confirmedReport(matchSlug: string): Promise<MatchReport | null> {
  const row = await db.queryOneAsync<DbMatchReportRow>(
    `SELECT * FROM match_reports
      WHERE match_slug = ? AND status = 'confirmed'
      ORDER BY revision DESC LIMIT 1`,
    [matchSlug]
  );
  return row ? toReport(row) : null;
}

async function matchFor(slug: string): Promise<DbMatchRow | null> {
  return (
    (await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [slug])) ?? null
  );
}

/** The match's stored config, which this module wrote. */
interface StoredConfig {
  game?: string;
  seriesLength?: number;
  allowDraw?: boolean;
  confirmation?: MatchReportConfirmation;
  confirmTimeoutMin?: number;
  timeoutAction?: MatchReportTimeoutAction;
}

function configOf(match: DbMatchRow): StoredConfig {
  try {
    const value: unknown = JSON.parse(match.config || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as StoredConfig) : {};
  } catch {
    return {};
  }
}

/**
 * Whether this match is one of ours.
 *
 * Read off the stored config rather than through the registry, because an
 * integration must not import it (eslint-rules/integration-boundaries.mjs).
 * The config is the one this module built, so its `game` field is the module's
 * id whatever catalogue id the row carries.
 */
export function isManualReportMatch(match: DbMatchRow): boolean {
  return configOf(match).game === MANUAL_REPORT_GAME_ID;
}

/** The reporting rules a match was built with, as a report form needs them. */
export interface ReportingRules {
  seriesLength: number;
  allowDraw: boolean;
  confirmation: MatchReportConfirmation;
  /** Minutes the opponent has to answer, or null when nothing expires. */
  confirmTimeoutMin: number | null;
  timeoutAction: MatchReportTimeoutAction;
}

/**
 * The rules this match was built with, read off its stored config.
 *
 * The same defaults `submitReport` applies, in one place, so the form a captain
 * fills in and the check their report is measured against cannot disagree.
 */
export function reportingRules(match: DbMatchRow): ReportingRules {
  const config = configOf(match);
  const timeoutMin = Number(config.confirmTimeoutMin);
  return {
    seriesLength: Number(config.seriesLength) > 0 ? Number(config.seriesLength) : 1,
    allowDraw: config.allowDraw === true,
    confirmation: config.confirmation === 'none' ? 'none' : 'opponent',
    confirmTimeoutMin: Number.isFinite(timeoutMin) && timeoutMin > 0 ? Math.floor(timeoutMin) : null,
    timeoutAction: config.timeoutAction === 'escalate' ? 'escalate' : 'auto_confirm',
  };
}

/**
 * Refuse an answer aimed at a report that has moved on (3.0 phase D, PR D4).
 *
 * The HTTP routes make a caller name the revision they are answering, because
 * a captain reading a match page and a captain reporting over it race: a newer
 * report supersedes the open one and takes the next revision, so the number
 * the client is holding stops matching. Without this, the second captain would
 * silently confirm a result they never saw.
 *
 * `undefined` means the caller did not say, and nothing is checked — the
 * state machine stays callable without a revision, as the sweeper needs.
 */
function revisionMismatch(open: MatchReport, expected: number | undefined): ReportOutcome | null {
  if (expected === undefined) return null;
  if (Number(expected) === open.revision) return null;
  return fail(
    409,
    `This match is at report revision ${open.revision}, not ${expected}; reload it and look again`
  );
}

// ---------------------------------------------------------------------------
// Who may act
// ---------------------------------------------------------------------------

/**
 * What an account may do for a match: captain of one of its two teams, or
 * (with `isAdmin`) an admin. An account that captains neither side gets
 * `null`, whatever else it is.
 */
export async function resolveActor(
  match: DbMatchRow,
  accountUid: string | null,
  opts: { isAdmin?: boolean } = {}
): Promise<ReportActor | null> {
  if (opts.isAdmin) return { uid: accountUid, role: 'admin', team: null };
  if (!accountUid) return null;

  for (const [side, teamId] of [
    ['team1', match.team1_id],
    ['team2', match.team2_id],
  ] as const) {
    if (!teamId) continue;
    if (await teamMembers.isCaptain(teamId, accountUid)) {
      return { uid: accountUid, role: 'captain', team: side };
    }
  }
  return null;
}

/** The side that is not `team`. */
const otherSide = (team: TeamSide): TeamSide => (team === 'team1' ? 'team2' : 'team1');

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Check a reported result against the match's own rules: the right number of
 * games, a winner per game unless the tournament allows a draw, and a series
 * score that matches the games. Returns the normalized result, or an error.
 */
export function validateResult(
  input: unknown,
  rules: { seriesLength: number; allowDraw: boolean }
): { ok: true; result: ReportedResult } | { ok: false; error: string } {
  const body = (input ?? {}) as Partial<ReportedResult>;
  const maps = Array.isArray(body.maps) ? body.maps : null;
  if (!maps || maps.length === 0) return { ok: false, error: 'At least one game must be reported' };
  if (maps.length > rules.seriesLength) {
    return {
      ok: false,
      error: `A best-of-${rules.seriesLength} has at most ${rules.seriesLength} games, not ${maps.length}`,
    };
  }

  const games: ReportedMapResult[] = [];
  let team1Maps = 0;
  let team2Maps = 0;

  for (const [index, raw] of maps.entries()) {
    const game = (raw ?? {}) as Partial<ReportedMapResult>;
    const team1Score = Number(game.team1Score);
    const team2Score = Number(game.team2Score);
    if (!Number.isFinite(team1Score) || !Number.isFinite(team2Score)) {
      return { ok: false, error: `Game ${index + 1}: both scores must be numbers` };
    }
    if (team1Score < 0 || team2Score < 0) {
      return { ok: false, error: `Game ${index + 1}: scores cannot be negative` };
    }

    // A winner the reporter states wins over the scores: a forfeit is 0-0 for
    // one side, and some games are decided on something we never see.
    let winner: 'team1' | 'team2' | null;
    if (game.winner === 'team1' || game.winner === 'team2') {
      winner = game.winner;
    } else if (game.winner === null || game.winner === undefined) {
      winner = team1Score === team2Score ? null : team1Score > team2Score ? 'team1' : 'team2';
    } else {
      return { ok: false, error: `Game ${index + 1}: winner must be team1, team2 or null` };
    }
    if (winner === null && !rules.allowDraw) {
      return { ok: false, error: `Game ${index + 1} has no winner, and this tournament allows no draw` };
    }

    if (winner === 'team1') team1Maps += 1;
    if (winner === 'team2') team2Maps += 1;
    games.push({
      mapNumber: index + 1,
      // A game with no maps stores no map name; `applySeriesResult` writes
      // `match_map_results.map_name` NULL for it.
      mapName: typeof game.mapName === 'string' && game.mapName.trim() ? game.mapName.trim() : null,
      team1Score,
      team2Score,
      winner,
    });
  }

  // Enough games must have been played to decide the series. A report that
  // stops one game short ("we won the first, then went home") would otherwise
  // finish a best-of-three on one game.
  const needed = Math.floor(rules.seriesLength / 2) + 1;
  const decided = team1Maps >= needed || team2Maps >= needed;
  const level = team1Maps === team2Maps;
  if (!decided && !level) {
    return { ok: false, error: `Neither side has won ${needed} of ${rules.seriesLength} games` };
  }

  const seriesWinner: 'team1' | 'team2' | null =
    team1Maps > team2Maps ? 'team1' : team2Maps > team1Maps ? 'team2' : null;
  // A level series is only a result where the tournament says a draw is one.
  if (seriesWinner === null && !rules.allowDraw) {
    return { ok: false, error: 'The series is level, and this tournament allows no draw' };
  }

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  return {
    ok: true,
    result: {
      maps: games,
      seriesTeam1Score: team1Maps,
      seriesTeam2Score: team2Maps,
      winner: seriesWinner,
      note,
    },
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function recordAction(
  report: { id: number | null; matchSlug: string },
  action: MatchReportAction,
  actor: ReportActor,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    await db.insertAsync('match_report_actions', {
      report_id: report.id,
      match_slug: report.matchSlug,
      action,
      actor_uid: actor.uid,
      actor_role: actor.role,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    // The audit trail must not be the reason a report fails to move.
    log.warn(`[manual-report] Could not record '${action}' for ${report.matchSlug}`, {
      error: (err as Error).message,
    });
  }
}

async function reportById(id: number): Promise<MatchReport> {
  const row = await db.queryOneAsync<DbMatchReportRow>('SELECT * FROM match_reports WHERE id = ?', [
    id,
  ]);
  if (!row) throw new Error(`Report ${id} disappeared while it was being written`);
  return toReport(row);
}

/** Close the open report, if there is one, because a newer one replaces it. */
async function supersedeOpen(matchSlug: string, actor: ReportActor): Promise<void> {
  const open = await openReport(matchSlug);
  if (!open) return;
  await db.updateAsync(
    'match_reports',
    { status: 'superseded', updated_at: now() },
    'id = ?',
    [open.id]
  );
  await recordAction({ id: open.id, matchSlug }, 'supersede', actor, { revision: open.revision });
}

/** Tell everyone watching this tournament that a report moved. */
async function announce(match: DbMatchRow, report: MatchReport, action: MatchReportAction): Promise<void> {
  emitTournament(tournamentIdForMatch(match), 'match:report', {
    matchSlug: match.slug,
    action,
    status: report.status,
    revision: report.revision,
    reportedBy: report.submittedByTeam,
  });
}

// ---------------------------------------------------------------------------
// Finalizing
// ---------------------------------------------------------------------------

function toSeriesResult(result: ReportedResult): SeriesResult {
  const games: GameResult[] = result.maps.map((map) => ({
    gameNumber: map.mapNumber,
    ...(map.mapName ? { mapName: map.mapName } : {}),
    team1Score: map.team1Score,
    team2Score: map.team2Score,
    winner: map.winner ?? 'draw',
  }));
  return {
    games,
    team1Score: result.seriesTeam1Score,
    team2Score: result.seriesTeam2Score,
    winner: result.winner ?? 'none',
  };
}

/**
 * Finish the series from a confirmed report.
 *
 * One call, `matchLifecycle.applySeriesResult`, the same one CS2's
 * `series.ended` makes: the games become `match_map_results` rows, the match
 * is completed, the bracket advances, ratings and stats are written and the
 * tournament is checked for completion. `source` says where the result came
 * from and is recorded as a `series_result` event.
 */
async function finalize(match: DbMatchRow, report: MatchReport): Promise<boolean> {
  const outcome = await matchLifecycle.applySeriesResult(
    match.slug,
    toSeriesResult(report.result),
    { source: report.source === 'admin' ? 'admin' : 'report', actorId: report.resolvedByUid ?? report.submittedByUid }
  );
  if (!outcome.applied) {
    log.warn(`[manual-report] ${match.slug} was not finished by its confirmed report`, {
      reason: outcome.reason,
      reportId: report.id,
    });
  }
  return outcome.applied;
}

/** Park the match for an admin: a dispute, or an escalated timeout. */
async function parkForAdmin(match: DbMatchRow): Promise<void> {
  await db.updateAsync('matches', { status: NEEDS_DECISION_STATUS }, 'id = ?', [match.id]);
  emitMatchUpdate({ id: match.id, slug: match.slug, status: NEEDS_DECISION_STATUS });
  emitBracketUpdate({
    action: 'match_status',
    matchSlug: match.slug,
    status: NEEDS_DECISION_STATUS,
  });
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

export interface SubmitInput {
  matchSlug: string;
  actor: ReportActor;
  /** The reported games; checked by `validateResult` against the match's rules. */
  result: unknown;
}

/**
 * Report a result.
 *
 * A captain reports for their own side; an admin reports for the match, which
 * counts as decided at once (there is nobody to ask). An open report from
 * before is superseded rather than replaced, so the history stays.
 */
export async function submitReport(input: SubmitInput): Promise<ReportOutcome> {
  const match = await matchFor(input.matchSlug);
  if (!match) return fail(404, `Match '${input.matchSlug}' not found`);
  if (!isManualReportMatch(match)) {
    return fail(409, `Match '${match.slug}' is not reported manually`);
  }
  if (input.actor.role === 'captain' && !input.actor.team) {
    return fail(403, 'Only a captain of one of the two teams may report this match');
  }
  if (input.actor.role === 'system') return fail(403, 'The sweeper does not report results');
  if (!REPORTABLE_STATUSES.has(match.status)) {
    return fail(409, `Match is ${match.status}; a finished match has to be reopened first`);
  }

  const config = configOf(match);
  const check = validateResult(input.result, {
    seriesLength: Number(config.seriesLength) > 0 ? Number(config.seriesLength) : 1,
    allowDraw: config.allowDraw === true,
  });
  if (!check.ok) return fail(400, check.error);

  // An admin's own report needs nobody's agreement; a captain's follows the
  // tournament's rule, as it stood when the match was built.
  const byAdmin = input.actor.role === 'admin';
  const confirmation: MatchReportConfirmation = byAdmin
    ? 'none'
    : config.confirmation === 'none'
      ? 'none'
      : 'opponent';
  const timeoutMin = Number(config.confirmTimeoutMin);
  const timeoutAction: MatchReportTimeoutAction =
    config.timeoutAction === 'escalate' ? 'escalate' : 'auto_confirm';
  const at = now();
  const deadline =
    confirmation === 'opponent' && Number.isFinite(timeoutMin) && timeoutMin > 0
      ? at + Math.floor(timeoutMin) * 60
      : null;

  await supersedeOpen(match.slug, input.actor);

  const highest = await db.queryOneAsync<{ max: number | string | null }>(
    'SELECT MAX(revision) as max FROM match_reports WHERE match_slug = ?',
    [match.slug]
  );
  const revision = (Number(highest?.max) || 0) + 1;
  const decided = confirmation === 'none';

  const inserted = await db.insertAsync('match_reports', {
    match_slug: match.slug,
    revision,
    status: decided ? 'confirmed' : 'submitted',
    source: byAdmin ? 'admin' : 'report',
    submitted_by_uid: input.actor.uid,
    submitted_by_team: input.actor.team,
    result: JSON.stringify(check.result),
    confirmation,
    confirm_deadline: deadline,
    timeout_action: deadline === null ? null : timeoutAction,
    ...(decided ? { confirmed_by_uid: input.actor.uid, confirmed_at: at } : {}),
    created_at: at,
    updated_at: at,
  });

  const report = await reportById(inserted.lastInsertRowid as number);
  await recordAction(report, 'submit', input.actor, {
    revision,
    confirmation,
    ...(deadline ? { confirmDeadline: deadline, timeoutAction } : {}),
  });
  await announce(match, report, 'submit');

  if (!decided) return { ok: true, report, finalized: false };
  await recordAction(report, 'confirm', input.actor, { reason: 'no confirmation required' });
  return { ok: true, report, finalized: await finalize(match, report) };
}

/** The opponent agrees: the series is over. */
export async function confirmReport(input: {
  matchSlug: string;
  actor: ReportActor;
  /** The revision the caller is answering; 409 when it is no longer the open one. */
  expectedRevision?: number;
}): Promise<ReportOutcome> {
  const match = await matchFor(input.matchSlug);
  if (!match) return fail(404, `Match '${input.matchSlug}' not found`);
  const open = await openReport(match.slug);
  if (!open) return fail(404, `Match '${match.slug}' has no open report`);
  const stale = revisionMismatch(open, input.expectedRevision);
  if (stale) return stale;
  if (open.status !== 'submitted') {
    return fail(409, `That report is ${open.status}, so it cannot be confirmed`);
  }

  const allowed = await mayAnswer(input.actor, open);
  if (!allowed.ok) return allowed.outcome;

  const at = now();
  await db.updateAsync(
    'match_reports',
    {
      status: 'confirmed',
      confirmed_by_uid: input.actor.uid,
      confirmed_at: at,
      confirm_deadline: null,
      updated_at: at,
    },
    'id = ?',
    [open.id]
  );
  const report = await reportById(open.id);
  await recordAction(report, 'confirm', input.actor);
  await announce(match, report, 'confirm');
  return { ok: true, report, finalized: await finalize(match, report) };
}

/** The opponent disagrees: the match waits for an admin. */
export async function disputeReport(input: {
  matchSlug: string;
  actor: ReportActor;
  reason?: string;
  /** The revision the caller is answering; 409 when it is no longer the open one. */
  expectedRevision?: number;
}): Promise<ReportOutcome> {
  const match = await matchFor(input.matchSlug);
  if (!match) return fail(404, `Match '${input.matchSlug}' not found`);
  const open = await openReport(match.slug);
  if (!open) return fail(404, `Match '${match.slug}' has no open report`);
  const stale = revisionMismatch(open, input.expectedRevision);
  if (stale) return stale;
  if (open.status !== 'submitted') {
    return fail(409, `That report is ${open.status}, so it cannot be disputed`);
  }

  const allowed = await mayAnswer(input.actor, open);
  if (!allowed.ok) return allowed.outcome;

  const at = now();
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
  await db.updateAsync(
    'match_reports',
    {
      status: 'disputed',
      disputed_by_uid: input.actor.uid,
      disputed_at: at,
      dispute_reason: reason || null,
      // The deadline is over: nobody is waiting on an answer any more.
      confirm_deadline: null,
      updated_at: at,
    },
    'id = ?',
    [open.id]
  );
  const report = await reportById(open.id);
  await recordAction(report, 'dispute', input.actor, reason ? { reason } : undefined);
  await parkForAdmin(match);
  await announce(match, report, 'dispute');
  return { ok: true, report, finalized: false };
}

/** The reporter takes it back, before anyone has acted on it. */
export async function withdrawReport(input: {
  matchSlug: string;
  actor: ReportActor;
  /** The revision the caller is taking back; 409 when it is no longer the open one. */
  expectedRevision?: number;
}): Promise<ReportOutcome> {
  const match = await matchFor(input.matchSlug);
  if (!match) return fail(404, `Match '${input.matchSlug}' not found`);
  const open = await openReport(match.slug);
  if (!open) return fail(404, `Match '${match.slug}' has no open report`);
  const stale = revisionMismatch(open, input.expectedRevision);
  if (stale) return stale;
  if (open.status !== 'submitted') {
    return fail(409, `That report is ${open.status}, so it cannot be withdrawn`);
  }
  if (input.actor.role !== 'admin' && input.actor.team !== open.submittedByTeam) {
    return fail(403, 'Only the side that reported it may withdraw it');
  }

  const at = now();
  await db.updateAsync(
    'match_reports',
    { status: 'withdrawn', confirm_deadline: null, updated_at: at },
    'id = ?',
    [open.id]
  );
  const report = await reportById(open.id);
  await recordAction(report, 'withdraw', input.actor);
  await announce(match, report, 'withdraw');
  return { ok: true, report, finalized: false };
}

/** Whether this actor may answer a report: the opponent's captain, or an admin. */
async function mayAnswer(
  actor: ReportActor,
  open: MatchReport
): Promise<{ ok: true } | { ok: false; outcome: ReportOutcome }> {
  if (actor.role === 'admin') return { ok: true };
  if (actor.role !== 'captain' || !actor.team) {
    return { ok: false, outcome: fail(403, 'Only a captain of one of the two teams may answer a report') };
  }
  if (!open.submittedByTeam) {
    // An admin's report is already decided, so there is nothing to answer;
    // this is belt and braces.
    return { ok: false, outcome: fail(409, 'That report was not made by a team') };
  }
  if (actor.team !== otherSide(open.submittedByTeam)) {
    return {
      ok: false,
      outcome: fail(403, 'A team cannot confirm or dispute its own report'),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/**
 * An admin settles an open report: as reported, or with a result of their own.
 *
 * With a `result` the admin's version is stored as a new revision
 * (`source: 'admin'`) and the open one is superseded, so both are on the
 * record. Without one, the open report is taken as it stands.
 */
export async function adminResolve(input: {
  matchSlug: string;
  actor: ReportActor;
  result?: unknown;
}): Promise<ReportOutcome> {
  if (input.actor.role !== 'admin') return fail(403, 'Only an admin may resolve a report');
  const match = await matchFor(input.matchSlug);
  if (!match) return fail(404, `Match '${input.matchSlug}' not found`);
  const open = await openReport(match.slug);
  if (!open) return fail(404, `Match '${match.slug}' has no open report to resolve`);

  if (input.result !== undefined) {
    return writeAdminResult(match, input.actor, input.result, 'resolve');
  }

  const at = now();
  await db.updateAsync(
    'match_reports',
    {
      status: 'confirmed',
      confirmed_by_uid: input.actor.uid,
      confirmed_at: at,
      resolved_by_uid: input.actor.uid,
      resolved_at: at,
      confirm_deadline: null,
      updated_at: at,
    },
    'id = ?',
    [open.id]
  );
  const report = await reportById(open.id);
  await recordAction(report, 'resolve', input.actor, { asReported: true });
  await announce(match, report, 'resolve');
  return { ok: true, report, finalized: await finalize(match, report) };
}

/**
 * An admin sets the result outright, with or without a report to settle.
 *
 * A match that already has a winner is refused: the result is downstream
 * already, so `reopenMatch` has to run first and say whether that is safe.
 */
export async function adminOverride(input: {
  matchSlug: string;
  actor: ReportActor;
  result: unknown;
}): Promise<ReportOutcome> {
  if (input.actor.role !== 'admin') return fail(403, 'Only an admin may override a result');
  const match = await matchFor(input.matchSlug);
  if (!match) return fail(404, `Match '${input.matchSlug}' not found`);
  if (!isManualReportMatch(match)) {
    return fail(409, `Match '${match.slug}' is not reported manually`);
  }
  if (match.status === 'completed' && match.winner_id) {
    return fail(409, 'That match already has a winner; reopen it first');
  }
  return writeAdminResult(match, input.actor, input.result, 'override');
}

/** Store an admin's result as its own confirmed revision and finish the series. */
async function writeAdminResult(
  match: DbMatchRow,
  actor: ReportActor,
  result: unknown,
  action: Extract<MatchReportAction, 'resolve' | 'override'>
): Promise<ReportOutcome> {
  const config = configOf(match);
  const check = validateResult(result, {
    seriesLength: Number(config.seriesLength) > 0 ? Number(config.seriesLength) : 1,
    allowDraw: config.allowDraw === true,
  });
  if (!check.ok) return fail(400, check.error);

  await supersedeOpen(match.slug, actor);

  const highest = await db.queryOneAsync<{ max: number | string | null }>(
    'SELECT MAX(revision) as max FROM match_reports WHERE match_slug = ?',
    [match.slug]
  );
  const at = now();
  const inserted = await db.insertAsync('match_reports', {
    match_slug: match.slug,
    revision: (Number(highest?.max) || 0) + 1,
    status: 'confirmed',
    source: 'admin',
    submitted_by_uid: actor.uid,
    submitted_by_team: null,
    result: JSON.stringify(check.result),
    confirmation: 'none',
    confirm_deadline: null,
    timeout_action: null,
    confirmed_by_uid: actor.uid,
    confirmed_at: at,
    resolved_by_uid: actor.uid,
    resolved_at: at,
    created_at: at,
    updated_at: at,
  });

  const report = await reportById(inserted.lastInsertRowid as number);
  await recordAction(report, action, actor);
  await announce(match, report, action);
  return { ok: true, report, finalized: await finalize(match, report) };
}

/**
 * Reopen a finished match so it can be reported again.
 *
 * Only while **nothing downstream has completed**: the tournament must still
 * be running, and every match this one feeds must still be waiting. Otherwise
 * reopening would leave a bracket that disagrees with itself, and this module
 * is not the place to unwind one.
 *
 * What it undoes, so the replacement result applies to a clean match: the
 * winner and completion of the match itself, the downstream slots it filled
 * (back to empty and `pending`), its recorded games, its player stats, and its
 * rating changes (`discardMatchRatings`, which refuses if a player has been
 * rated since — then so does this).
 */
export async function reopenMatch(input: {
  matchSlug: string;
  actor: ReportActor;
}): Promise<ReportOutcome> {
  if (input.actor.role !== 'admin') return fail(403, 'Only an admin may reopen a match');
  const match = await matchFor(input.matchSlug);
  if (!match) return fail(404, `Match '${input.matchSlug}' not found`);
  if (!isManualReportMatch(match)) {
    return fail(409, `Match '${match.slug}' is not reported manually`);
  }
  // `DbMatchRow.status` does not list `needs_decision` (it is set by the core
  // rather than by a generator), so compare as a string, as matchLifecycle does.
  const status = match.status as string;
  if (status !== 'completed' && status !== NEEDS_DECISION_STATUS) {
    return fail(409, `Match is ${status}; there is nothing to reopen`);
  }

  const tournamentId = tournamentIdForMatch(match);
  const tournament = await db.queryOneAsync<{ status: string }>(
    'SELECT status FROM tournament WHERE id = ?',
    [tournamentId]
  );
  if (tournament?.status === 'completed') {
    return fail(409, 'That tournament is finished; reopening a match would not change its result');
  }

  // Every match this one feeds, by explicit slot wiring or by next_match_id.
  const downstream = await db.queryAsync<DbMatchRow>(
    `SELECT * FROM matches
      WHERE team1_from_match_id = ? OR team2_from_match_id = ? OR id = ?`,
    [match.id, match.id, match.next_match_id ?? -1]
  );
  const started = downstream.filter((m) => !['pending', 'ready'].includes(m.status) || m.winner_id);
  if (started.length > 0) {
    return fail(
      409,
      `A later match has already started or finished (${started.map((m) => m.slug).join(', ')})`
    );
  }

  const { discardMatchRatings } = await import('../../services/ratingService');
  const reverted = await discardMatchRatings(match.slug);
  if (reverted === null) {
    return fail(
      409,
      'A player in this match has been rated since; reopening it would undo that result too'
    );
  }

  // Empty the slots this match filled, so the replacement winner fills them.
  for (const later of downstream) {
    const updates: Record<string, unknown> = {};
    if (later.team1_from_match_id === match.id) updates.team1_id = null;
    if (later.team2_from_match_id === match.id) updates.team2_id = null;
    if (later.team1_id === match.winner_id && later.team1_from_match_id === null) {
      updates.team1_id = null;
    }
    if (later.team2_id === match.winner_id && later.team2_from_match_id === null) {
      updates.team2_id = null;
    }
    if (Object.keys(updates).length === 0) continue;
    updates.status = 'pending';
    await db.updateAsync('matches', updates, 'id = ?', [later.id]);
  }

  await db.runAsync('DELETE FROM match_map_results WHERE match_slug = ?', [match.slug]);
  await db.runAsync('DELETE FROM player_match_stats WHERE match_slug = ?', [match.slug]);
  await db.updateAsync(
    'matches',
    { status: 'live', winner_id: null, completed_at: null, map_number: 0, current_map: null },
    'id = ?',
    [match.id]
  );

  // The result that stood is no longer the match's result.
  const previous = await confirmedReport(match.slug);
  if (previous) {
    await db.updateAsync(
      'match_reports',
      { status: 'superseded', updated_at: now() },
      'id = ?',
      [previous.id]
    );
  }

  await recordAction({ id: previous?.id ?? null, matchSlug: match.slug }, 'reopen', input.actor, {
    previousWinnerId: match.winner_id,
    ratingsReverted: reverted,
  });
  emitMatchUpdate({ id: match.id, slug: match.slug, status: 'live', winnerId: null });
  emitBracketUpdate({ action: 'match_status', matchSlug: match.slug, status: 'live' });
  emitTournament(tournamentId, 'match:report', {
    matchSlug: match.slug,
    action: 'reopen',
    status: 'live',
  });

  const report = previous ? await reportById(previous.id) : null;
  return report
    ? { ok: true, report, finalized: false }
    : {
        ok: true,
        report: {
          id: 0,
          matchSlug: match.slug,
          revision: 0,
          status: 'superseded',
          source: 'admin',
          submittedByUid: null,
          submittedByTeam: null,
          result: { maps: [], seriesTeam1Score: 0, seriesTeam2Score: 0, winner: null, note: null },
          confirmation: 'none',
          confirmDeadline: null,
          timeoutAction: null,
          confirmedByUid: null,
          confirmedAt: null,
          disputedByUid: null,
          disputedAt: null,
          disputeReason: null,
          resolvedByUid: input.actor.uid,
          resolvedAt: now(),
          createdAt: now(),
        },
        finalized: false,
      };
}

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

export interface SweepSummary {
  autoConfirmed: string[];
  escalated: string[];
}

/**
 * Act on every report whose deadline has passed (the sweeper's one job).
 *
 * `auto_confirm` takes the report as reported and finishes the series;
 * `escalate` hands the match to an admin and leaves the report open, so
 * nothing new can be reported over it while they look.
 *
 * Driven by a sweep rather than a timer per report, so a deadline that passed
 * while the API was down is acted on at the next sweep rather than never.
 */
export async function sweepTimeouts(at: number = now()): Promise<SweepSummary> {
  const due = await db.queryAsync<DbMatchReportRow>(
    `SELECT * FROM match_reports
      WHERE status = 'submitted'
        AND confirm_deadline IS NOT NULL
        AND confirm_deadline <= ?
      ORDER BY confirm_deadline`,
    [at]
  );

  const summary: SweepSummary = { autoConfirmed: [], escalated: [] };
  for (const row of due) {
    const report = toReport(row);
    try {
      const match = await matchFor(report.matchSlug);
      if (!match) continue;
      if (report.timeoutAction === 'escalate') {
        await escalate(match, report);
        summary.escalated.push(report.matchSlug);
      } else {
        await autoConfirm(match, report);
        summary.autoConfirmed.push(report.matchSlug);
      }
    } catch (err) {
      // One bad report must not stop the sweep for the rest.
      log.error(`[manual-report] Timeout sweep failed for ${report.matchSlug}`, {
        error: (err as Error).message,
        reportId: report.id,
      });
    }
  }
  return summary;
}

async function autoConfirm(match: DbMatchRow, report: MatchReport): Promise<void> {
  const at = now();
  await db.updateAsync(
    'match_reports',
    {
      status: 'confirmed',
      // Nobody confirmed it: the deadline did.
      confirmed_by_uid: null,
      confirmed_at: at,
      confirm_deadline: null,
      updated_at: at,
    },
    'id = ?',
    [report.id]
  );
  const updated = await reportById(report.id);
  await recordAction(updated, 'timeout_auto_confirm', SYSTEM_ACTOR, {
    deadline: report.confirmDeadline,
  });
  log.info(`[manual-report] ${match.slug}: nobody answered by the deadline, taking the report`);
  await announce(match, updated, 'timeout_auto_confirm');
  await finalize(match, updated);
}

async function escalate(match: DbMatchRow, report: MatchReport): Promise<void> {
  const at = now();
  // The report stays `submitted`, so it is still the one open report and
  // nothing can be reported over it while an admin looks at it. Clearing the
  // deadline is what takes it out of the sweep.
  await db.updateAsync(
    'match_reports',
    { confirm_deadline: null, updated_at: at },
    'id = ?',
    [report.id]
  );
  const updated = await reportById(report.id);
  await recordAction(updated, 'timeout_escalate', SYSTEM_ACTOR, {
    deadline: report.confirmDeadline,
  });
  log.info(`[manual-report] ${match.slug}: nobody answered by the deadline, asking an admin`);
  await parkForAdmin(match);
  await announce(match, updated, 'timeout_escalate');
}
