/**
 * Deleting and banning players.
 *
 * Delete leaves a tombstone: the players row stays (match stats, ratings and
 * tournament history point at it, so scoreboards keep their rows), renamed
 * "Deleted player", with everything personal gone: avatar, Discord ID, email,
 * sign-in methods and logins, friends, parties, teams, notifications, chat.
 * Its username login is gone too, so the name can be taken again; a new
 * account gets a new id (local-<random>), never the old player.
 *
 * Ban keeps the player but locks them out: they cannot sign in (see
 * blockedViewerMiddleware), and public pages show only their name and
 * "Banned". An admin can lift it.
 *
 * Either way, a player in the lineup of a tournament that is still running
 * leaves it. A sub just goes; a starter leaves a gap: the team's open
 * matches are held for LINEUP_GAP_MINUTES while the captain picks a sub on
 * the sign-up page. When the time is up the first sub moves in, or, with
 * none, the team plays short-handed. Nobody is disqualified.
 */
import { db } from '../config/database';
import { log } from '../utils/logger';
import { holdMatch, releaseMatch, type Actor } from './matchHolds';
import { notificationService } from './notificationService';
import { playerService } from './playerService';

/** How long a team gets to pick a sub after losing a starter. */
export const LINEUP_GAP_MINUTES = 15;

/** What a deleted player is called everywhere. */
export const DELETED_PLAYER_NAME = 'Deleted player';

const now = () => Math.floor(Date.now() / 1000);

export interface ModerationState {
  deleted: boolean;
  banned: boolean;
}

/** Whether a player is deleted or banned (cached briefly: the sign-in check runs per request). */
const cache = new Map<string, { state: ModerationState; at: number }>();
const CACHE_MS = 15_000;

export async function moderationOf(playerId: string): Promise<ModerationState> {
  const hit = cache.get(playerId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;
  const row = await db.queryOneAsync<{ deleted_at: number | null; banned_at: number | null }>(
    'SELECT deleted_at, banned_at FROM players WHERE id = ?',
    [playerId]
  );
  const state = { deleted: row?.deleted_at != null, banned: row?.banned_at != null };
  cache.set(playerId, { state, at: Date.now() });
  return state;
}

function forget(playerId: string): void {
  cache.delete(playerId);
}

/** Every signed-in session of the player ends (express-session's `session` table). */
async function endSessions(playerId: string): Promise<void> {
  await db
    .runAsync(`DELETE FROM session WHERE sess::text LIKE ?`, [
      `%"steamId":"${playerId.replace(/[%_"\\]/g, '')}"%`,
    ])
    .catch((error: unknown) =>
      log.warn('[MODERATION] Sessions not ended', { error: String(error) })
    );
}

// ---------------------------------------------------------------------------
// Lineups
// ---------------------------------------------------------------------------

/** The owner and captains of a team, as players.id, for notices. */
async function captainsOf(teamId: string): Promise<string[]> {
  const rows = await db.queryAsync<{ id: string }>(
    `SELECT p.id FROM players p
       WHERE p.uid IN (
         SELECT owner_uid FROM teams WHERE id = ? AND owner_uid IS NOT NULL
         UNION SELECT account_uid FROM team_members WHERE team_id = ? AND role = 'captain'
       ) AND p.deleted_at IS NULL`,
    [teamId, teamId]
  );
  return rows.map((r) => r.id);
}

/** The team's matches in the tournament that have not started yet. */
async function openMatches(tournamentId: number, teamId: string): Promise<string[]> {
  const rows = await db.queryAsync<{ slug: string }>(
    `SELECT slug FROM matches
      WHERE tournament_id = ? AND (team1_id = ? OR team2_id = ?)
        AND status NOT IN ('live', 'completed', 'cancelled')`,
    [tournamentId, teamId, teamId]
  );
  return rows.map((r) => r.slug);
}

/**
 * Take the player out of every lineup in a tournament that is not over. A
 * starter leaves a gap (see the file comment).
 */
async function leaveLineups(playerId: string, why: 'banned' | 'deleted', by: Actor): Promise<void> {
  const rows = await db.queryAsync<{
    tournament_id: number;
    team_id: string;
    role: string;
    name: string;
  }>(
    `SELECT l.tournament_id, l.team_id, l.role, t.name
       FROM tournament_lineups l JOIN tournament t ON t.id = l.tournament_id
      WHERE l.player_id = ? AND t.status <> 'completed'`,
    [playerId]
  );
  for (const r of rows) {
    const tournamentId = Number(r.tournament_id);
    await db.runAsync(
      'DELETE FROM tournament_lineups WHERE tournament_id = ? AND team_id = ? AND player_id = ?',
      [tournamentId, r.team_id, playerId]
    );
    if (r.role !== 'starter') continue;
    const deadline = now() + LINEUP_GAP_MINUTES * 60;
    await db.runAsync(
      `INSERT INTO tournament_lineup_gaps (tournament_id, team_id, player_id, deadline)
       VALUES (?, ?, ?, ?) ON CONFLICT (tournament_id, team_id, player_id) DO NOTHING`,
      [tournamentId, r.team_id, playerId, deadline]
    );
    const reason = `A player left the lineup (${why}). The captain has ${LINEUP_GAP_MINUTES} minutes to pick a sub.`;
    for (const slug of await openMatches(tournamentId, r.team_id)) {
      await holdMatch(slug, { minutes: LINEUP_GAP_MINUTES, reason }, by).catch((error: unknown) =>
        log.warn(`[MODERATION] ${slug}: not held`, { error: String(error) })
      );
    }
    for (const captain of await captainsOf(r.team_id)) {
      await notificationService
        .notify(
          captain,
          'tournament',
          {
            event: 'lineupGap',
            tournamentId,
            name: r.name,
            teamId: r.team_id,
            minutes: LINEUP_GAP_MINUTES,
          },
          `lineup-gap:${tournamentId}:${r.team_id}:${playerId}`
        )
        .catch(() => null);
    }
    log.warn('[MODERATION] A starter left a lineup mid-tournament', {
      tournamentId,
      teamId: r.team_id,
      playerId,
      why,
    });
  }
}

/** Open gaps of a team in a tournament. */
export async function openGaps(tournamentId: number, teamId: string): Promise<number> {
  const row = await db.queryOneAsync<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM tournament_lineup_gaps WHERE tournament_id = ? AND team_id = ? AND resolved_at IS NULL',
    [tournamentId, teamId]
  );
  return Number(row?.n ?? 0);
}

/** The captain saved a new lineup: the gap is filled and the held matches go ahead. */
export async function lineupPicked(tournamentId: number, teamId: string): Promise<void> {
  const closed = await db.queryAsync<{ player_id: string }>(
    `UPDATE tournament_lineup_gaps SET resolved_at = ?, resolution = 'picked'
      WHERE tournament_id = ? AND team_id = ? AND resolved_at IS NULL RETURNING player_id`,
    [now(), tournamentId, teamId]
  );
  if (closed.length === 0) return;
  for (const slug of await openMatches(tournamentId, teamId)) {
    await releaseMatch(slug, null).catch(() => undefined);
  }
}

/** Gaps whose time is up: the first sub moves in, or the team plays short-handed. */
export async function resolveDueGaps(): Promise<void> {
  const due = await db.queryAsync<{ tournament_id: number; team_id: string; player_id: string }>(
    'SELECT tournament_id, team_id, player_id FROM tournament_lineup_gaps WHERE resolved_at IS NULL AND deadline <= ?',
    [now()]
  );
  for (const gap of due) {
    const tournamentId = Number(gap.tournament_id);
    const sub = await db.queryOneAsync<{ player_id: string }>(
      `SELECT player_id FROM tournament_lineups
        WHERE tournament_id = ? AND team_id = ? AND role = 'sub' ORDER BY created_at, player_id LIMIT 1`,
      [tournamentId, gap.team_id]
    );
    if (sub) {
      await db.runAsync(
        `UPDATE tournament_lineups SET role = 'starter' WHERE tournament_id = ? AND team_id = ? AND player_id = ?`,
        [tournamentId, gap.team_id, sub.player_id]
      );
    }
    await db.runAsync(
      `UPDATE tournament_lineup_gaps SET resolved_at = ?, resolution = ?
        WHERE tournament_id = ? AND team_id = ? AND player_id = ?`,
      [now(), sub ? 'first_sub' : 'short_handed', tournamentId, gap.team_id, gap.player_id]
    );
    log.info('[MODERATION] Lineup gap over', {
      tournamentId,
      teamId: gap.team_id,
      outcome: sub ? `first sub ${sub.player_id} moved in` : 'playing short-handed',
    });
  }
}

// ---------------------------------------------------------------------------
// Ban
// ---------------------------------------------------------------------------

export class ModerationError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function banPlayer(playerId: string, reason: string | null, by: Actor): Promise<void> {
  const player = await playerService.getPlayerById(playerId);
  if (!player) throw new ModerationError(404, 'No such player');
  if (await isDeleted(playerId)) throw new ModerationError(409, 'This player is deleted');
  if (player.isAdmin)
    throw new ModerationError(409, 'Take admin away first: an admin cannot be banned');
  await db.runAsync(
    'UPDATE players SET banned_at = ?, ban_reason = ?, banned_by = ?, updated_at = ? WHERE id = ?',
    [now(), reason?.trim().slice(0, 500) || null, by.userId, now(), playerId]
  );
  forget(playerId);
  await endSessions(playerId);
  await db
    .runAsync('DELETE FROM mm_party_members WHERE player_id = ?', [playerId])
    .catch(() => undefined);
  await leaveLineups(playerId, 'banned', by);
  log.warn('[AUDIT] Player banned', { playerId, by: by.userId, reason });
}

export async function unbanPlayer(playerId: string, by: Actor): Promise<void> {
  await db.runAsync(
    'UPDATE players SET banned_at = NULL, ban_reason = NULL, banned_by = NULL, updated_at = ? WHERE id = ?',
    [now(), playerId]
  );
  forget(playerId);
  log.warn('[AUDIT] Player unbanned', { playerId, by: by.userId });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

async function isDeleted(playerId: string): Promise<boolean> {
  const row = await db.queryOneAsync<{ deleted_at: number | null }>(
    'SELECT deleted_at FROM players WHERE id = ?',
    [playerId]
  );
  return row?.deleted_at != null;
}

/** Statements that remove what is personal; each tolerates a table a module did not create. */
const WIPE: Array<[string, (id: string, uid: string) => unknown[]]> = [
  ['DELETE FROM local_admins WHERE player_id = ?', (id) => [id]],
  ['DELETE FROM auth_identities WHERE steam_id = ?', (id) => [id]],
  ['DELETE FROM linked_accounts WHERE player_id = ?', (id) => [id]],
  ['DELETE FROM player_emails WHERE player_id = ?', (id) => [id]],
  ['DELETE FROM email_tokens WHERE player_id = ?', (id) => [id]],
  ['DELETE FROM player_games WHERE player_uid = ?', (_id, uid) => [uid]],
  ['DELETE FROM friendships WHERE player_id = ? OR friend_id = ?', (id) => [id, id]],
  ['DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?', (id) => [id, id]],
  ['DELETE FROM mm_party_invites WHERE from_id = ? OR to_id = ?', (id) => [id, id]],
  ['DELETE FROM mm_party_members WHERE player_id = ?', (id) => [id]],
  ['DELETE FROM mm_parties WHERE leader_player_id = ?', (id) => [id]],
  ['DELETE FROM notifications WHERE player_id = ?', (id) => [id]],
  ['DELETE FROM chat_messages WHERE sender_id = ?', (id) => [id]],
  ['DELETE FROM chat_reads WHERE player_id = ?', (id) => [id]],
  ['DELETE FROM commends WHERE from_player_id = ? OR to_player_id = ?', (id) => [id, id]],
  ['DELETE FROM team_members WHERE account_uid = ?::uuid', (_id, uid) => [uid]],
  ['DELETE FROM team_invites WHERE account_uid = ?::uuid', (_id, uid) => [uid]],
  ['DELETE FROM team_join_requests WHERE account_uid = ?::uuid', (_id, uid) => [uid]],
];

/**
 * Delete a player: a tombstone that keeps match rows, nothing else (see the
 * file comment). Final: there is no undo.
 */
export async function deletePlayer(playerId: string, by: Actor): Promise<boolean> {
  const row = await db.queryOneAsync<{ uid: string; is_admin: number; deleted_at: number | null }>(
    'SELECT uid, is_admin, deleted_at FROM players WHERE id = ?',
    [playerId]
  );
  if (!row) return false;
  if (row.deleted_at != null) return true;
  await leaveLineups(playerId, 'deleted', by);
  for (const [sql, params] of WIPE) {
    await db.runAsync(sql, params(playerId, row.uid)).catch((error: unknown) => {
      log.debug('[MODERATION] wipe step skipped', { sql, error: String(error) });
    });
  }
  // Out of every team roster (teams.players holds ids and names).
  const teams = await db.queryAsync<{ id: string; players: string }>(
    'SELECT id, players FROM teams WHERE players LIKE ?',
    [`%${playerId.replace(/[%_]/g, '')}%`]
  );
  for (const team of teams) {
    try {
      const roster = JSON.parse(team.players) as Array<{ steamId?: string; steamid?: string }>;
      const kept = roster.filter((p) => (p.steamId ?? p.steamid) !== playerId);
      if (kept.length !== roster.length) {
        await db.runAsync('UPDATE teams SET players = ? WHERE id = ?', [
          JSON.stringify(kept),
          team.id,
        ]);
      }
    } catch {
      // A roster that is not JSON is left alone.
    }
  }
  await db.runAsync(
    `UPDATE players SET name = ?, avatar_url = NULL, discord_id = NULL, discord_id_edited_at = NULL,
       is_admin = 0, banned_at = NULL, ban_reason = NULL, banned_by = NULL, last_sign_in_at = NULL,
       last_seen_at = NULL, party_invites_from = 'nobody', deleted_at = ?, updated_at = ?
     WHERE id = ?`,
    [DELETED_PLAYER_NAME, now(), now(), playerId]
  );
  forget(playerId);
  await endSessions(playerId);
  log.warn('[AUDIT] Player deleted', { playerId, by: by.userId });
  return true;
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

/**
 * Express middleware after the session: a banned or deleted player is signed
 * out on their next request (session and player cookie ignored), so a ban
 * takes effect at once and nothing they had open keeps working.
 */
export function blockedViewerMiddleware(
  cookieName: string,
  viewerOf: (req: import('express').Request) => string | null
) {
  return async (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    try {
      const id = viewerOf(req);
      if (id) {
        const state = await moderationOf(id);
        if (state.banned || state.deleted) {
          const r = req as import('express').Request & {
            user?: unknown;
            session?: { destroy?: (cb: (err?: unknown) => void) => void };
          };
          delete r.user;
          // Their browser forgets the sign-in, and the sign-in page says why
          // (a short-lived cookie the client reads once).
          res.clearCookie(cookieName, { path: '/' });
          res.cookie('at_blocked', state.banned ? 'banned' : 'deleted', {
            maxAge: 60_000,
            sameSite: 'lax',
            path: '/',
          });
          if (req.headers.cookie) {
            req.headers.cookie = req.headers.cookie
              .split(';')
              .filter((c) => c.trim().split('=')[0] !== cookieName)
              .join(';');
          }
          r.session?.destroy?.(() => undefined);
        }
      }
    } catch {
      // A failed check never blocks the request.
    }
    next();
  };
}
