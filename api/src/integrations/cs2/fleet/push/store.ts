/**
 * Storage for the server-level pushes (migration `007-fleet-server-prefs`):
 *
 * - `cs2_fleet_lists`: the fleet-wide lists the platform versions, one row
 *   each (`admins`, `server_config`) with its rev, the hash of what that rev
 *   was built from, and its own data (extra admins, the fleet default
 *   settings).
 * - `cs2_fleet_server_prefs`: per server, its settings override and its
 *   whitelist / practice / plugins choices, plus `pushed`: what went out when
 *   (a rev and outbox seq for the ack-only messages, a command id for the
 *   answered ones), so the UI can say "acked" or show the `cmd.result`.
 */

import { db } from '../../../../config/database';

export type ListName = 'admins' | 'server_config';

export interface ListRow {
  name: ListName;
  rev: number;
  hash: string | null;
  data: unknown;
  updatedBy: string | null;
  updatedAt: number | null;
}

/** One push, as `pushed.<kind>` remembers it. */
export interface PushRecord {
  /** The list rev it carried (admins.set, server.config, settings.set). */
  rev?: number;
  /** Outbox seq: acked once the server's `tx_acked` reaches it. */
  seq?: number;
  /** Envelope id of an answered message (`cmd`): its `cmd.result` is in `cs2_fleet_commands`. */
  id?: string;
  /** Unix seconds. */
  at: number;
}

export type PushKind =
  'admins' | 'server_config' | 'settings' | 'whitelist' | 'practice' | 'plugins';

export interface ServerPrefs {
  serverId: string;
  settings: unknown;
  whitelist: { enabled: boolean; steamids: string[] } | null;
  practice: boolean | null;
  plugins: { enable: string[]; disable: string[] } | null;
  pushed: Partial<Record<PushKind, PushRecord>>;
  updatedBy: string | null;
  updatedAt: number | null;
}

const nowS = () => Math.floor(Date.now() / 1000);

function parse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function readList(name: ListName): Promise<ListRow> {
  const row = await db.queryOneAsync<{
    rev: number;
    hash: string | null;
    data: string | null;
    updated_by: string | null;
    updated_at: number | null;
  }>('SELECT rev, hash, data, updated_by, updated_at FROM cs2_fleet_lists WHERE name = ?', [name]);
  return {
    name,
    rev: Number(row?.rev ?? 0),
    hash: row?.hash ?? null,
    data: parse(row?.data),
    updatedBy: row?.updated_by ?? null,
    updatedAt:
      row?.updated_at === undefined || row?.updated_at === null ? null : Number(row.updated_at),
  };
}

/**
 * Bump the list's rev when `hash` differs from the stored one (compare-and-set
 * in one statement, so two concurrent syncs cannot both bump). Returns the new
 * rev, or null when nothing changed.
 */
export async function bumpListIfChanged(
  name: ListName,
  hash: string,
  minRev = 1
): Promise<number | null> {
  const row = await db.queryOneAsync<{ rev: number }>(
    `INSERT INTO cs2_fleet_lists (name, rev, hash, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE
         SET rev = GREATEST(cs2_fleet_lists.rev + 1, EXCLUDED.rev), hash = EXCLUDED.hash, updated_at = EXCLUDED.updated_at
       WHERE cs2_fleet_lists.hash IS DISTINCT FROM EXCLUDED.hash
     RETURNING rev`,
    [name, Math.max(1, minRev), hash, nowS()]
  );
  return row ? Number(row.rev) : null;
}

/** Raise the rev to at least `rev` (a server holds a higher one from an earlier database). */
export async function raiseListRev(name: ListName, rev: number): Promise<number> {
  const row = await db.queryOneAsync<{ rev: number }>(
    `INSERT INTO cs2_fleet_lists (name, rev, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET rev = GREATEST(cs2_fleet_lists.rev, EXCLUDED.rev), updated_at = EXCLUDED.updated_at
     RETURNING rev`,
    [name, rev, nowS()]
  );
  return Number(row?.rev ?? rev);
}

export async function writeListData(
  name: ListName,
  data: unknown,
  updatedBy: string | null
): Promise<void> {
  await db.runAsync(
    `INSERT INTO cs2_fleet_lists (name, rev, data, updated_by, updated_at) VALUES (?, 0, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [name, JSON.stringify(data ?? null), updatedBy, nowS()]
  );
}

interface PrefsRow {
  server_id: string;
  settings: string | null;
  whitelist: string | null;
  practice: number | null;
  plugins: string | null;
  pushed: string | null;
  updated_by: string | null;
  updated_at: number | null;
}

function fromRow(serverId: string, row: PrefsRow | undefined): ServerPrefs {
  return {
    serverId,
    settings: parse(row?.settings),
    whitelist: parse(row?.whitelist),
    practice:
      row?.practice === null || row?.practice === undefined ? null : Number(row.practice) === 1,
    plugins: parse(row?.plugins),
    pushed: parse(row?.pushed) ?? {},
    updatedBy: row?.updated_by ?? null,
    updatedAt:
      row?.updated_at === undefined || row?.updated_at === null ? null : Number(row.updated_at),
  };
}

export async function readPrefs(serverId: string): Promise<ServerPrefs> {
  const row = await db.queryOneAsync<PrefsRow>(
    'SELECT * FROM cs2_fleet_server_prefs WHERE server_id = ?',
    [serverId]
  );
  return fromRow(serverId, row);
}

export async function readAllPrefs(): Promise<Map<string, ServerPrefs>> {
  const rows = await db.queryAsync<PrefsRow>('SELECT * FROM cs2_fleet_server_prefs', []);
  return new Map(rows.map((r) => [r.server_id, fromRow(r.server_id, r)]));
}

type PrefsColumn = 'settings' | 'whitelist' | 'practice' | 'plugins';

/** Set one of a server's choices (`value` JSON, or 1/0 for practice; null clears it). */
export async function writePref(
  serverId: string,
  column: PrefsColumn,
  value: unknown,
  updatedBy: string | null
): Promise<void> {
  const stored =
    value === null || value === undefined
      ? null
      : column === 'practice'
        ? value
          ? 1
          : 0
        : JSON.stringify(value);
  // `column` is one of four literals above, never user input.
  await db.runAsync(
    `INSERT INTO cs2_fleet_server_prefs (server_id, ${column}, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (server_id) DO UPDATE
         SET ${column} = EXCLUDED.${column}, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [serverId, stored, updatedBy, nowS()]
  );
}

/** Remember a push (merged into `pushed`, one statement, so parallel pushes do not lose each other). */
export async function recordPush(
  serverId: string,
  kind: PushKind,
  record: Omit<PushRecord, 'at'>
): Promise<void> {
  const patch = JSON.stringify({ [kind]: { ...record, at: nowS() } });
  await db.runAsync(
    `INSERT INTO cs2_fleet_server_prefs (server_id, pushed, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (server_id) DO UPDATE
         SET pushed = (COALESCE(cs2_fleet_server_prefs.pushed, '{}')::jsonb || EXCLUDED.pushed::jsonb)::text`,
    [serverId, patch, nowS()]
  );
}

/** Enrolled (not pending, not revoked) servers: they get fleet-wide pushes even while offline (outbox). */
export async function enrolledServerIds(): Promise<string[]> {
  const rows = await db.queryAsync<{ id: string }>(
    `SELECT id FROM cs2_fleet_servers WHERE status = 'enrolled' ORDER BY created_at ASC, id ASC`,
    []
  );
  return rows.map((r) => r.id);
}
