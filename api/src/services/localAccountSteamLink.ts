/**
 * Connecting Steam to a local admin account (`local-<username>`, created on
 * /setup), from /me/connections.
 *
 * `players.id` is the Steam ID for every Steam account, and match data,
 * stats, rating history and the CS2 module's tables are keyed on it. So the
 * account that survives is always the one whose id is the Steam ID; the
 * `local-*` row is retired:
 *
 *  - attach: no player has this Steam ID yet. A player row with the Steam ID
 *    is created (admin, the local account's name and avatar), everything the
 *    local account owned moves onto it, the local row is deleted.
 *  - merge: a player with this Steam ID already exists (they played here
 *    before). After the admin confirms, that player becomes an admin and the
 *    local account is folded into it the same way. The Steam player's id,
 *    uid, matches and stats are untouched.
 *
 * Either way the local login (username, password, TOTP) now signs in as the
 * Steam player (`local_admins.player_id` is re-pointed), and sign-in methods
 * linked to the local account (GitHub, Discord, ...) move with it. One
 * transaction; the caller audit-logs the outcome.
 */
import type { PoolClient } from 'pg';
import { db } from '../config/database';

export type SteamLinkRefusal =
  /** The local account is gone or is not a local account. */
  | 'not_local'
  /** Attach: a player with this Steam ID appeared in between (confirm a merge instead). */
  | 'exists'
  /** Merge: the Steam player is gone. */
  | 'gone'
  /** The Steam player already has its own local login (another admin's account). */
  | 'taken';

export class SteamLinkError extends Error {
  constructor(readonly reason: SteamLinkRefusal) {
    super(reason);
  }
}

export function isLocalPlayerId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('local-');
}

export const STEAM_ID_RE = /^\d{17}$/;

interface PlayerRow {
  id: string;
  uid: string;
  name: string;
  avatar_url: string | null;
}

/** Move every row the local account owns onto `to`, then delete the local row. */
async function foldInto(client: PoolClient, from: PlayerRow, to: PlayerRow): Promise<Record<string, number>> {
  const moved: Record<string, number> = {};
  const run = async (label: string, sql: string, params: unknown[]) => {
    const res = await client.query(sql, params);
    if (res.rowCount) moved[label] = (moved[label] ?? 0) + res.rowCount;
  };
  const now = Math.floor(Date.now() / 1000);

  await run('local_admins', 'UPDATE local_admins SET player_id = $2, updated_at = $3 WHERE player_id = $1', [
    from.id,
    to.id,
    now,
  ]);
  await run('auth_identities', 'UPDATE auth_identities SET steam_id = $2 WHERE steam_id = $1', [from.id, to.id]);
  // The local row's own "steam" mirror names local-*, which is not a Steam account.
  await client.query("DELETE FROM linked_accounts WHERE player_id = $1 AND provider = 'steam'", [from.id]);
  await run('linked_accounts', 'UPDATE linked_accounts SET player_id = $2 WHERE player_id = $1', [from.id, to.id]);
  await client.query(
    `INSERT INTO linked_accounts (player_id, provider, external_id, verified)
     VALUES ($1, 'steam', $1, TRUE) ON CONFLICT (provider, external_id) DO NOTHING`,
    [to.id]
  );

  // Keyed on players.id.
  await run('player_rating_history', 'UPDATE player_rating_history SET player_id = $2 WHERE player_id = $1', [
    from.id,
    to.id,
  ]);
  await run('player_match_stats', 'UPDATE player_match_stats SET player_id = $2 WHERE player_id = $1', [
    from.id,
    to.id,
  ]);
  await client.query(
    `DELETE FROM shuffle_tournament_players s WHERE s.player_id = $1 AND EXISTS
       (SELECT 1 FROM shuffle_tournament_players o WHERE o.player_id = $2 AND o.tournament_id = s.tournament_id)`,
    [from.id, to.id]
  );
  await run('shuffle_tournament_players', 'UPDATE shuffle_tournament_players SET player_id = $2 WHERE player_id = $1', [
    from.id,
    to.id,
  ]);

  // Keyed on players.uid. Where both accounts hold the same row, the Steam
  // player's is kept.
  await client.query(
    `DELETE FROM player_games g WHERE g.player_uid = $1 AND EXISTS
       (SELECT 1 FROM player_games o WHERE o.player_uid = $2 AND o.game_id = g.game_id)`,
    [from.uid, to.uid]
  );
  await run('player_games', 'UPDATE player_games SET player_uid = $2 WHERE player_uid = $1', [from.uid, to.uid]);
  await client.query(
    `DELETE FROM team_members m WHERE m.account_uid = $1 AND EXISTS
       (SELECT 1 FROM team_members o WHERE o.account_uid = $2 AND o.team_id = m.team_id)`,
    [from.uid, to.uid]
  );
  await run('team_members', 'UPDATE team_members SET account_uid = $2 WHERE account_uid = $1', [from.uid, to.uid]);
  await client.query(
    `DELETE FROM match_stat_values v WHERE v.player_uid = $1 AND EXISTS
       (SELECT 1 FROM match_stat_values o WHERE o.player_uid = $2 AND o.match_slug = v.match_slug
          AND o.map_number IS NOT DISTINCT FROM v.map_number AND o.field_id = v.field_id)`,
    [from.uid, to.uid]
  );
  await run('match_stat_values', 'UPDATE match_stat_values SET player_uid = $2 WHERE player_uid = $1', [
    from.uid,
    to.uid,
  ]);
  for (const col of ['submitted_by_uid', 'confirmed_by_uid', 'disputed_by_uid', 'resolved_by_uid']) {
    await run('match_reports', `UPDATE match_reports SET ${col} = $2 WHERE ${col} = $1`, [from.uid, to.uid]);
  }
  await run('match_report_actions', 'UPDATE match_report_actions SET actor_uid = $2 WHERE actor_uid = $1', [
    from.uid,
    to.uid,
  ]);
  await run('game_packs', 'UPDATE game_packs SET installed_by = $2 WHERE installed_by = $1', [
    String(from.uid),
    String(to.uid),
  ]);

  await client.query('DELETE FROM players WHERE id = $1', [from.id]);
  return moved;
}

/**
 * Connect `steamId` to the local account `localId`.
 *
 * `mode` is what the caller saw: 'attach' when no player had the Steam ID,
 * 'merge' after the admin confirmed folding into the existing player. A
 * change in between is refused rather than silently doing the other thing.
 */
export async function connectSteamToLocalAccount(
  localId: string,
  steamId: string,
  mode: 'attach' | 'merge',
  profile: { name?: string | null; avatarUrl?: string | null } = {}
): Promise<{ playerId: string; moved: Record<string, number> }> {
  if (!isLocalPlayerId(localId) || !STEAM_ID_RE.test(steamId)) throw new SteamLinkError('not_local');
  return db.withClient(async (client) => {
    try {
      await client.query('BEGIN');
      const local = (
        await client.query<PlayerRow>('SELECT id, uid, name, avatar_url FROM players WHERE id = $1 FOR UPDATE', [
          localId,
        ])
      ).rows[0];
      if (!local) throw new SteamLinkError('not_local');

      let target = (
        await client.query<PlayerRow>('SELECT id, uid, name, avatar_url FROM players WHERE id = $1 FOR UPDATE', [
          steamId,
        ])
      ).rows[0];
      if (mode === 'attach' && target) throw new SteamLinkError('exists');
      if (mode === 'merge' && !target) throw new SteamLinkError('gone');
      if (target) {
        const own = await client.query('SELECT 1 FROM local_admins WHERE player_id = $1', [steamId]);
        if (own.rowCount) throw new SteamLinkError('taken');
      } else {
        target = (
          await client.query<PlayerRow>(
            `INSERT INTO players (id, name, avatar_url, is_admin) VALUES ($1, $2, $3, 0)
             RETURNING id, uid, name, avatar_url`,
            [steamId, profile.name || local.name, profile.avatarUrl ?? local.avatar_url]
          )
        ).rows[0];
      }

      // The admin role comes with the local login.
      const wasAdmin = await client.query<{ is_admin: number }>('SELECT is_admin FROM players WHERE id = $1', [localId]);
      if (wasAdmin.rows[0]?.is_admin === 1) {
        await client.query('UPDATE players SET is_admin = 1, updated_at = $2 WHERE id = $1', [
          steamId,
          Math.floor(Date.now() / 1000),
        ]);
      }
      const moved = await foldInto(client, local, target);
      await client.query('COMMIT');
      return { playerId: steamId, moved };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  });
}
