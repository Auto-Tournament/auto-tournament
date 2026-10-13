/**
 * The admins' bell: what needs an admin's eye, raised where it happens (a
 * match stuck without a server, a crashed server, a failing recorder, a new
 * beta) and shown on the bell, the dashboard's "Needs you" and as a toast on
 * any admin page. One feed for every admin; each admin's "seen" mark is their
 * own. A repeat of an open notice (same dedupe key) counts up and moves to
 * the top instead of adding a row; `resolve` closes one that fixed itself.
 * A sweep that re-checks a lasting problem every minute raises it with
 * `{ ongoing: true }`: that adds nothing while the notice is open, and nothing
 * after an admin dismissed it until the problem has cleared once.
 * Per kind, admins choose off, bell, or bell with a sound (settings).
 * Raising never throws: a notice is a courtesy, not part of what failed.
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitAdminNotice, emitAdminNoticesResolved } from './socketService';

export const ADMIN_NOTICE_KINDS = {
  // Matches
  match_no_server: { group: 'matches', severity: 'warn' },
  veto_stalled: { group: 'matches', severity: 'warn' },
  warmup_long: { group: 'matches', severity: 'info' },
  match_forfeit: { group: 'matches', severity: 'info' },
  report_disputed: { group: 'matches', severity: 'warn' },
  failover: { group: 'matches', severity: 'error' },
  // Servers
  server_crashed: { group: 'servers', severity: 'error' },
  plugin_update_available: { group: 'servers', severity: 'info' },
  update_failed: { group: 'servers', severity: 'error' },
  autoscale_license: { group: 'servers', severity: 'warn' },
  // Recorders
  recorder_offline: { group: 'recorders', severity: 'warn' },
  recorder_updated: { group: 'recorders', severity: 'info' },
  recorder_update_failed: { group: 'recorders', severity: 'error' },
  benchmark_failed: { group: 'recorders', severity: 'warn' },
  clips_failing: { group: 'recorders', severity: 'warn' },
  // Platform
  beta_available: { group: 'platform', severity: 'info' },
  license_problem: { group: 'platform', severity: 'error' },
  demos_failing: { group: 'platform', severity: 'warn' },
} as const satisfies Record<string, { group: string; severity: AdminNoticeSeverity }>;

export type AdminNoticeKind = keyof typeof ADMIN_NOTICE_KINDS;
export type AdminNoticeSeverity = 'error' | 'warn' | 'info';
/** Per kind: not raised, the bell only, or the bell and a sound. */
export type AdminNoticeDelivery = 'off' | 'bell' | 'sound';

export interface AdminNotice {
  id: number;
  kind: AdminNoticeKind;
  severity: AdminNoticeSeverity;
  data: Record<string, unknown>;
  dedupeKey: string;
  count: number;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
}

interface Row {
  id: number;
  kind: string;
  severity: string;
  data: string;
  dedupe_key: string;
  count: number;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
}

const SETTINGS_KEY = 'admin_notice_settings';
/** Resolved notices stay listed this long. */
const KEEP_RESOLVED_SECONDS = 3 * 24 * 3600;
/** How long a dismissal keeps a lasting problem quiet, at most. */
const KEEP_DISMISSED_SECONDS = 14 * 24 * 3600;

const now = () => Math.floor(Date.now() / 1000);

function view(row: Row): AdminNotice {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    data = {};
  }
  return {
    id: row.id,
    kind: row.kind as AdminNoticeKind,
    severity: row.severity as AdminNoticeSeverity,
    data,
    dedupeKey: row.dedupe_key,
    count: Number(row.count),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
  };
}

/** Every kind's delivery, defaults filled in ("sound" for errors, "bell" for the rest). */
export function normalizeNoticeSettings(
  raw: unknown
): Record<AdminNoticeKind, AdminNoticeDelivery> {
  const given = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as Record<AdminNoticeKind, AdminNoticeDelivery>;
  for (const kind of Object.keys(ADMIN_NOTICE_KINDS) as AdminNoticeKind[]) {
    const value = given[kind];
    out[kind] =
      value === 'off' || value === 'bell' || value === 'sound'
        ? value
        : ADMIN_NOTICE_KINDS[kind].severity === 'error'
          ? 'sound'
          : 'bell';
  }
  return out;
}

export const adminNoticeService = {
  async settings(): Promise<Record<AdminNoticeKind, AdminNoticeDelivery>> {
    const raw = await db.getAppSettingAsync(SETTINGS_KEY).catch(() => null);
    try {
      return normalizeNoticeSettings(raw ? JSON.parse(raw) : {});
    } catch {
      return normalizeNoticeSettings({});
    }
  },

  async setSettings(input: unknown): Promise<Record<AdminNoticeKind, AdminNoticeDelivery>> {
    const next = normalizeNoticeSettings({ ...(await this.settings()), ...(input as object) });
    await db.setAppSettingAsync(SETTINGS_KEY, JSON.stringify(next));
    return next;
  },

  /**
   * Raise a notice (or count up the open one with the same key). `dedupeKey`
   * names the thing it is about, e.g. `server_crashed:<serverId>`.
   */
  async raise(
    kind: AdminNoticeKind,
    data: Record<string, unknown>,
    dedupeKey: string = kind,
    severity: AdminNoticeSeverity = ADMIN_NOTICE_KINDS[kind].severity,
    { ongoing = false }: { ongoing?: boolean } = {}
  ): Promise<AdminNotice | null> {
    try {
      const delivery = (await this.settings())[kind];
      if (delivery === 'off') return null;
      if (ongoing) {
        const known = await db.queryOneAsync<{ id: number }>(
          `SELECT id FROM admin_notices
            WHERE dedupe_key = ? AND (resolved_at IS NULL OR dismissed_at IS NOT NULL) LIMIT 1`,
          [dedupeKey]
        );
        if (known) return null;
      }
      const at = now();
      const row =
        (await db.queryOneAsync<Row>(
          `UPDATE admin_notices SET count = count + 1, data = ?, severity = ?, updated_at = ?
            WHERE dedupe_key = ? AND resolved_at IS NULL RETURNING *`,
          [JSON.stringify(data), severity, at, dedupeKey]
        )) ??
        (await db.queryOneAsync<Row>(
          `INSERT INTO admin_notices (kind, severity, data, dedupe_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL
           DO UPDATE SET count = admin_notices.count + 1, updated_at = EXCLUDED.updated_at
           RETURNING *`,
          [kind, severity, JSON.stringify(data), dedupeKey, at, at]
        ));
      if (!row) return null;
      const notice = view(row);
      emitAdminNotice(notice, delivery === 'sound');
      return notice;
    } catch (error) {
      log.warn('[ADMIN-NOTICES] Could not raise a notice', {
        kind,
        error: (error as Error).message,
      });
      return null;
    }
  },

  /** The thing a notice was about is fine again (or an admin dismissed it). */
  async resolve(dedupeKey: string): Promise<void> {
    try {
      const rows = await db.queryAsync<{ id: number }>(
        'UPDATE admin_notices SET resolved_at = ? WHERE dedupe_key = ? AND resolved_at IS NULL RETURNING id',
        [now(), dedupeKey]
      );
      // Cleared: a dismissed one may come back the next time it happens.
      await db.runAsync(
        'UPDATE admin_notices SET dismissed_at = NULL WHERE dedupe_key = ? AND dismissed_at IS NOT NULL',
        [dedupeKey]
      );
      if (rows.length) emitAdminNoticesResolved(rows.map((r) => r.id));
    } catch (error) {
      log.warn('[ADMIN-NOTICES] Could not resolve a notice', {
        dedupeKey,
        error: (error as Error).message,
      });
    }
  },

  async dismiss(id: number): Promise<boolean> {
    const row = await db.queryOneAsync<{ id: number }>(
      'UPDATE admin_notices SET resolved_at = ?, dismissed_at = ? WHERE id = ? AND resolved_at IS NULL RETURNING id',
      [now(), now(), id]
    );
    if (row) emitAdminNoticesResolved([row.id]);
    return Boolean(row);
  },

  /** Open notices first (newest change first), then recently resolved ones. */
  async list(limit = 50): Promise<AdminNotice[]> {
    const rows = await db.queryAsync<Row>(
      `SELECT * FROM admin_notices
        WHERE resolved_at IS NULL OR resolved_at > ?
        ORDER BY (resolved_at IS NULL) DESC, updated_at DESC, id DESC
        LIMIT ?`,
      [now() - KEEP_RESOLVED_SECONDS, Math.max(1, Math.min(200, limit))]
    );
    return rows.map(view);
  },

  /** Open notices changed since this admin last looked. */
  async unread(adminKey: string): Promise<number> {
    const seen = await db.queryOneAsync<{ last_seen_at: number }>(
      'SELECT last_seen_at FROM admin_notice_reads WHERE admin_key = ?',
      [adminKey]
    );
    const row = await db.queryOneAsync<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM admin_notices WHERE resolved_at IS NULL AND updated_at > ?',
      [Number(seen?.last_seen_at ?? 0)]
    );
    return Number(row?.n ?? 0);
  },

  async markSeen(adminKey: string): Promise<void> {
    await db.runAsync(
      `INSERT INTO admin_notice_reads (admin_key, last_seen_at) VALUES (?, ?)
       ON CONFLICT (admin_key) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [adminKey, now()]
    );
  },

  /** Old resolved notices go. */
  async prune(): Promise<void> {
    await db.runAsync(
      `DELETE FROM admin_notices WHERE resolved_at IS NOT NULL AND resolved_at < ?
         AND (dismissed_at IS NULL OR dismissed_at < ?)`,
      [now() - KEEP_RESOLVED_SECONDS, now() - KEEP_DISMISSED_SECONDS]
    );
  },
};
