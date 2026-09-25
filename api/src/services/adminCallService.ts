/**
 * Admin calls: players asking for an admin from a game server.
 *
 * A game integration turns its own event into an `AdminCallInput` (CS2: the
 * Ready Up `admin_called` event on /api/events) and calls `recordAdminCall`.
 * Everything after that is core's: the `admin_calls` table, the admin API
 * (routes/adminCalls.ts) and the Socket.IO events every signed-in admin gets
 * (`admin:call`, `admin:call:resolved`, room `admins`).
 *
 * A call stays open until an admin resolves it. Resolving is idempotent: a
 * second resolve of the same call changes nothing and emits nothing.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';
import { emitAdminCall, emitAdminCallResolved } from './socketService';
import {
  ADMIN_CALL_MESSAGE_MAX,
  type AdminCall,
  type AdminCallInput,
  type AdminCallTeam,
  type AdminCallResolvedEvent,
} from '../types/adminCall.types';

/** Resolved calls are deleted after this long. Open calls are never deleted. */
const RESOLVED_RETENTION_SECONDS = 90 * 24 * 60 * 60;
/** How far back `listAdminCalls` looks for resolved calls by default. */
export const DEFAULT_RESOLVED_WINDOW_SECONDS = 24 * 60 * 60;
const MAX_RESOLVED_LISTED = 100;

interface AdminCallRow {
  id: number;
  call_id: string;
  game: string;
  server_id: string | null;
  server_name: string | null;
  match_id: number | null;
  match_slug: string | null;
  map_number: number | null;
  player_steamid: string | null;
  player_name: string | null;
  player_team: string | null;
  player_side: string | null;
  message: string | null;
  called_at: number;
  received_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  resolution_note: string | null;
  team1_name: string | null;
  team2_name: string | null;
  resolved_by_name: string | null;
}

const SELECT_CALLS = `
  SELECT ac.*,
         t1.name AS team1_name,
         t2.name AS team2_name,
         rp.name AS resolved_by_name
    FROM admin_calls ac
    LEFT JOIN matches m ON m.id = ac.match_id AND m.slug = ac.match_slug
    LEFT JOIN teams t1 ON t1.id = m.team1_id
    LEFT JOIN teams t2 ON t2.id = m.team2_id
    LEFT JOIN players rp ON rp.id = ac.resolved_by
`;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function iso(seconds: number | null): string | null {
  if (seconds === null || seconds === undefined) return null;
  return new Date(Number(seconds) * 1000).toISOString();
}

function asTeam(value: string | null): AdminCallTeam | null {
  return value === 'team1' || value === 'team2' || value === 'spectator' ? value : null;
}

function toAdminCall(row: AdminCallRow): AdminCall {
  const team = asTeam(row.player_team);
  const teamName =
    team === 'team1' ? row.team1_name : team === 'team2' ? row.team2_name : null;
  return {
    id: Number(row.id),
    callId: row.call_id,
    game: row.game,
    serverId: row.server_id,
    serverName: row.server_name,
    matchId: row.match_id === null ? null : Number(row.match_id),
    matchSlug: row.match_slug,
    mapNumber: row.map_number === null ? null : Number(row.map_number),
    team1Name: row.team1_name,
    team2Name: row.team2_name,
    player: {
      steamId: row.player_steamid,
      name: row.player_name,
      team,
      teamName: teamName ?? null,
      side: row.player_side,
    },
    message: row.message ?? '',
    calledAt: iso(row.called_at) as string,
    receivedAt: iso(row.received_at) as string,
    resolvedAt: iso(row.resolved_at),
    resolvedBy: row.resolved_by,
    resolvedByName: row.resolved_by_name,
    resolutionNote: row.resolution_note,
  };
}

async function getRows(where: string, params: unknown[], tail = ''): Promise<AdminCall[]> {
  const rows = await db.queryAsync<AdminCallRow>(`${SELECT_CALLS} WHERE ${where} ${tail}`, params);
  return rows.map(toAdminCall);
}

export async function getAdminCall(id: number): Promise<AdminCall | null> {
  const [call] = await getRows('ac.id = ?', [id]);
  return call ?? null;
}

/**
 * Store one call and tell the admins, unless a call with the same `callId` is
 * already stored (a retried delivery): then nothing changes.
 */
export async function recordAdminCall(
  input: AdminCallInput
): Promise<{ call: AdminCall; created: boolean }> {
  const message = (input.message ?? '').slice(0, ADMIN_CALL_MESSAGE_MAX);
  const inserted = await db.queryOneAsync<{ id: number }>(
    `INSERT INTO admin_calls (
       call_id, game, server_id, server_name, match_id, match_slug, map_number,
       player_steamid, player_name, player_team, player_side, message, called_at, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (call_id) DO NOTHING
     RETURNING id`,
    [
      input.callId,
      input.game,
      input.serverId,
      input.serverName,
      input.matchId,
      input.matchSlug,
      input.mapNumber,
      input.player.steamId,
      input.player.name,
      input.player.team,
      input.player.side,
      message,
      input.calledAt,
      nowSeconds(),
    ]
  );

  if (!inserted) {
    const [existing] = await getRows('ac.call_id = ?', [input.callId]);
    if (!existing) {
      // Only possible if it was deleted between the insert and the read.
      throw new Error(`Admin call ${input.callId} vanished while it was being stored`);
    }
    log.debug('[ADMIN CALL] Repeated delivery ignored', { callId: input.callId });
    return { call: existing, created: false };
  }

  const call = await getAdminCall(Number(inserted.id));
  if (!call) throw new Error(`Admin call ${inserted.id} vanished while it was being stored`);

  log.warn('[ADMIN CALL] A player is calling for an admin', {
    id: call.id,
    callId: call.callId,
    serverId: call.serverId,
    matchSlug: call.matchSlug,
    player: call.player.name,
    steamId: call.player.steamId,
    message: call.message,
  });
  emitAdminCall(call);

  // Keep the table small: resolved calls go after RESOLVED_RETENTION_SECONDS.
  try {
    await db.runAsync('DELETE FROM admin_calls WHERE resolved_at IS NOT NULL AND resolved_at < ?', [
      nowSeconds() - RESOLVED_RETENTION_SECONDS,
    ]);
  } catch (err) {
    log.warn('[ADMIN CALL] Could not prune old resolved calls', { error: (err as Error).message });
  }

  return { call, created: true };
}

/**
 * Every open call (oldest first), and the calls resolved within
 * `resolvedWithinSeconds` (newest first, at most 100).
 */
export async function listAdminCalls(
  resolvedWithinSeconds: number = DEFAULT_RESOLVED_WINDOW_SECONDS
): Promise<{ open: AdminCall[]; resolved: AdminCall[] }> {
  const open = await getRows('ac.resolved_at IS NULL', [], 'ORDER BY ac.called_at ASC, ac.id ASC');
  const resolved =
    resolvedWithinSeconds > 0
      ? await getRows(
          'ac.resolved_at IS NOT NULL AND ac.resolved_at >= ?',
          [nowSeconds() - resolvedWithinSeconds],
          `ORDER BY ac.resolved_at DESC, ac.id DESC LIMIT ${MAX_RESOLVED_LISTED}`
        )
      : [];
  return { open, resolved };
}

function normalizeNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  return trimmed === '' ? null : trimmed.slice(0, 500);
}

/**
 * Resolve one call. `null` when there is no such call; `changed: false` when
 * it was already resolved (the stored resolution is kept).
 */
export async function resolveAdminCall(
  id: number,
  resolvedBy: string | null,
  note?: unknown
): Promise<{ call: AdminCall; changed: boolean } | null> {
  const resolvedAt = nowSeconds();
  const updated = await db.queryOneAsync<{ id: number }>(
    `UPDATE admin_calls
        SET resolved_at = ?, resolved_by = ?, resolution_note = ?
      WHERE id = ? AND resolved_at IS NULL
      RETURNING id`,
    [resolvedAt, resolvedBy, normalizeNote(note), id]
  );
  const call = await getAdminCall(id);
  if (!call) return null;
  if (updated) {
    log.info('[ADMIN CALL] Resolved', { id, resolvedBy });
    emitAdminCallResolved(resolvedPayload([id], resolvedAt, resolvedBy));
  }
  return { call, changed: Boolean(updated) };
}

/** Resolve every open call. Returns the ids it resolved. */
export async function resolveAllAdminCalls(
  resolvedBy: string | null,
  note?: unknown
): Promise<number[]> {
  const resolvedAt = nowSeconds();
  const rows = await db.queryAsync<{ id: number }>(
    `UPDATE admin_calls
        SET resolved_at = ?, resolved_by = ?, resolution_note = ?
      WHERE resolved_at IS NULL
      RETURNING id`,
    [resolvedAt, resolvedBy, normalizeNote(note)]
  );
  const ids = rows.map((r) => Number(r.id)).sort((a, b) => a - b);
  if (ids.length > 0) {
    log.info('[ADMIN CALL] Resolved every open call', { count: ids.length, resolvedBy });
    emitAdminCallResolved(resolvedPayload(ids, resolvedAt, resolvedBy));
  }
  return ids;
}

function resolvedPayload(
  ids: number[],
  resolvedAt: number,
  resolvedBy: string | null
): AdminCallResolvedEvent {
  return { ids, resolvedAt: iso(resolvedAt) as string, resolvedBy };
}
