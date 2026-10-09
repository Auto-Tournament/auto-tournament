/**
 * Players reporting another player to the admins.
 *
 * A signed-in player reports someone from their profile with a reason (and
 * details; required for "other"). Every admin gets a notification. Admins
 * see open reports on the Reports page and dismiss them, or ban the player
 * from there (which closes every open report about them). The reporter gets
 * a notice once their report is handled, never what was done. The reported
 * player never learns who reported them.
 *
 * Limits: one open report per reporter per player, and REPORTS_PER_DAY a day
 * per reporter.
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { notificationService } from './notificationService';
import { banPlayer } from './playerModeration';
import type { Actor } from './matchHolds';

export const REPORT_REASONS = ['cheating', 'toxic', 'griefing', 'name', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const REPORTS_PER_DAY = 10;
const DETAILS_MAX = 1000;

const now = () => Math.floor(Date.now() / 1000);

export class ReportError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

export interface ReportView {
  id: number;
  reported: { id: string; name: string; avatar: string | null; banned: boolean; deleted: boolean };
  reporter: { id: string; name: string } | null;
  reason: ReportReason;
  details: string | null;
  status: 'open' | 'dismissed' | 'actioned';
  createdAt: number;
  handledAt: number | null;
  handledBy: string | null;
  /** Open reports about the same player, this one included. */
  openAboutPlayer: number;
}

async function adminIds(): Promise<string[]> {
  const rows = await db.queryAsync<{ id: string }>(
    'SELECT id FROM players WHERE is_admin = 1 AND deleted_at IS NULL',
    []
  );
  return rows.map((r) => r.id);
}

export async function createReport(
  reporterId: string,
  input: { playerId: unknown; reason: unknown; details: unknown }
): Promise<{ id: number }> {
  const playerId = typeof input.playerId === 'string' ? input.playerId : '';
  const reason = REPORT_REASONS.find((r) => r === input.reason);
  const details =
    typeof input.details === 'string' ? input.details.trim().slice(0, DETAILS_MAX) : '';
  if (!reason) throw new ReportError(400, 'Pick a reason', 'reason');
  if (reason === 'other' && !details) throw new ReportError(400, 'Say what happened', 'details');
  if (playerId === reporterId) throw new ReportError(400, 'You cannot report yourself', 'self');

  const target = await db.queryOneAsync<{ name: string; deleted_at: number | null }>(
    'SELECT name, deleted_at FROM players WHERE id = ?',
    [playerId]
  );
  if (!target || target.deleted_at != null) throw new ReportError(404, 'No such player');

  const open = await db.queryOneAsync<{ id: number }>(
    "SELECT id FROM player_reports WHERE reporter_id = ? AND reported_id = ? AND status = 'open'",
    [reporterId, playerId]
  );
  if (open)
    throw new ReportError(409, 'You already reported this player. The admins have it.', 'already');
  const today = await db.queryOneAsync<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM player_reports WHERE reporter_id = ? AND created_at > ?',
    [reporterId, now() - 24 * 60 * 60]
  );
  if (Number(today?.n ?? 0) >= REPORTS_PER_DAY) {
    throw new ReportError(
      429,
      'You have sent a lot of reports today. Try again tomorrow.',
      'limit'
    );
  }

  const rows = await db.queryAsync<{ id: number }>(
    'INSERT INTO player_reports (reported_id, reporter_id, reason, details) VALUES (?, ?, ?, ?) RETURNING id',
    [playerId, reporterId, reason, details || null]
  );
  const id = Number(rows[0].id);
  const reporter = await db.queryOneAsync<{ name: string }>(
    'SELECT name FROM players WHERE id = ?',
    [reporterId]
  );
  for (const admin of await adminIds()) {
    if (admin === playerId) continue;
    await notificationService
      .notify(admin, 'report', {
        event: 'new',
        reportId: id,
        playerId,
        name: target.name,
        reporterName: reporter?.name ?? null,
        reason,
      })
      .catch(() => null);
  }
  log.info('[REPORTS] Player reported', { reportId: id, playerId, reason });
  return { id };
}

export async function listReports(status: 'open' | 'all'): Promise<ReportView[]> {
  const rows = await db.queryAsync<{
    id: number;
    reported_id: string;
    reported_name: string;
    reported_avatar: string | null;
    banned_at: number | null;
    deleted_at: number | null;
    reporter_id: string | null;
    reporter_name: string | null;
    reason: ReportReason;
    details: string | null;
    status: ReportView['status'];
    created_at: number;
    handled_at: number | null;
    handled_by: string | null;
    open_about: number;
  }>(
    `SELECT r.id, r.reported_id, p.name AS reported_name, p.avatar_url AS reported_avatar, p.banned_at, p.deleted_at,
            r.reporter_id, q.name AS reporter_name, r.reason, r.details, r.status, r.created_at, r.handled_at, r.handled_by,
            (SELECT COUNT(*)::int FROM player_reports o WHERE o.reported_id = r.reported_id AND o.status = 'open') AS open_about
       FROM player_reports r
       JOIN players p ON p.id = r.reported_id
       LEFT JOIN players q ON q.id = r.reporter_id
      ${status === 'open' ? "WHERE r.status = 'open'" : ''}
      ORDER BY r.created_at DESC
      LIMIT 500`,
    []
  );
  return rows.map((r) => ({
    id: Number(r.id),
    reported: {
      id: r.reported_id,
      name: r.reported_name,
      avatar: r.reported_avatar,
      banned: r.banned_at != null,
      deleted: r.deleted_at != null,
    },
    reporter: r.reporter_id ? { id: r.reporter_id, name: r.reporter_name ?? r.reporter_id } : null,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.created_at,
    handledAt: r.handled_at,
    handledBy: r.handled_by,
    openAboutPlayer: Number(r.open_about),
  }));
}

export async function openReportCount(): Promise<number> {
  const row = await db.queryOneAsync<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM player_reports WHERE status = 'open'",
    []
  );
  return Number(row?.n ?? 0);
}

/** Close reports and tell each reporter it was looked at (never the outcome). */
async function close(ids: number[], status: 'dismissed' | 'actioned', by: Actor): Promise<number> {
  if (ids.length === 0) return 0;
  const closed = await db.queryAsync<{ id: number; reporter_id: string | null; name: string }>(
    `UPDATE player_reports r SET status = ?, handled_at = ?, handled_by = ?
       FROM players p
      WHERE r.id = ANY(?::int[]) AND r.status = 'open' AND p.id = r.reported_id
      RETURNING r.id, r.reporter_id, p.name`,
    [status, now(), by.userId, ids]
  );
  for (const c of closed) {
    if (!c.reporter_id) continue;
    await notificationService
      .notify(
        c.reporter_id,
        'report',
        { event: 'reviewed', reportId: Number(c.id), name: c.name },
        `report-reviewed:${c.id}`
      )
      .catch(() => null);
  }
  return closed.length;
}

export async function dismissReport(id: number, by: Actor): Promise<void> {
  if ((await close([id], 'dismissed', by)) === 0)
    throw new ReportError(404, 'No open report with that id');
}

/** Ban the reported player; every open report about them is closed. */
export async function banFromReport(id: number, reason: string | null, by: Actor): Promise<void> {
  const report = await db.queryOneAsync<{ reported_id: string; reason: string }>(
    "SELECT reported_id, reason FROM player_reports WHERE id = ? AND status = 'open'",
    [id]
  );
  if (!report) throw new ReportError(404, 'No open report with that id');
  await banPlayer(report.reported_id, reason ?? `Reported: ${report.reason}`, by);
  const open = await db.queryAsync<{ id: number }>(
    "SELECT id FROM player_reports WHERE reported_id = ? AND status = 'open'",
    [report.reported_id]
  );
  await close(
    open.map((o) => Number(o.id)),
    'actioned',
    by
  );
}
