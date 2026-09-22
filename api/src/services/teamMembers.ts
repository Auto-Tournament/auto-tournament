/**
 * Team membership: who belongs to a team, and who may act for it.
 *
 * `team_members(team_id, account_uid, role)` is keyed on `players.uid`, never
 * on a Steam ID, so a 3.1 account with no Steam account can captain a team
 * (3.0 phase D, from the 3.1 identity design).
 *
 * `teams.players` (JSON) stays the roster of record: match configs, the team
 * page and every existing lookup read it, and nothing here changes that. This
 * table mirrors that roster and adds the role, so the manual-report module
 * (phase D2 onwards) can answer "may this account report for this team?"
 * without parsing JSON or knowing about Steam.
 *
 * Writes are best effort, like the `linked_accounts` mirrors in
 * `playerIdentity`: a failed sync is logged and never fails the team write
 * that caused it. The backfill migration (`2026-09-22-team-members-backfill`)
 * restores anything a failed sync missed.
 */

import { db } from '../config/database';
import { log } from '../utils/logger';

/** What an account may do for a team. Captains report and confirm results. */
export type TeamMemberRole = 'captain' | 'member';

export interface TeamMember {
  teamId: string;
  accountUid: string;
  role: TeamMemberRole;
  createdAt: number;
}

interface TeamMemberRow {
  team_id: string;
  account_uid: string;
  role: string;
  created_at: number;
}

function toMember(row: TeamMemberRow): TeamMember {
  return {
    teamId: row.team_id,
    accountUid: row.account_uid,
    role: row.role === 'captain' ? 'captain' : 'member',
    createdAt: Number(row.created_at),
  };
}

/** The `players.uid`s of the given Steam IDs, in no particular order. */
async function accountUidsForSteamIds(steamIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(steamIds.filter((id) => typeof id === 'string' && id !== ''))];
  if (ids.length === 0) return [];
  const rows = await db.queryAsync<{ uid: string }>(
    'SELECT uid FROM players WHERE id = ANY(?::text[])',
    [ids]
  );
  return rows.map((r) => r.uid);
}

export const teamMembers = {
  /** Every member of a team, captains first. */
  async list(teamId: string): Promise<TeamMember[]> {
    const rows = await db.queryAsync<TeamMemberRow>(
      `SELECT team_id, account_uid, role, created_at
         FROM team_members
        WHERE team_id = ?
        ORDER BY (role = 'captain') DESC, created_at, account_uid`,
      [teamId]
    );
    return rows.map(toMember);
  },

  /** Every team an account belongs to. */
  async listForAccount(accountUid: string): Promise<TeamMember[]> {
    const rows = await db.queryAsync<TeamMemberRow>(
      `SELECT team_id, account_uid, role, created_at
         FROM team_members
        WHERE account_uid = ?
        ORDER BY created_at, team_id`,
      [accountUid]
    );
    return rows.map(toMember);
  },

  /** That account's role in the team, or null when it is not a member. */
  async roleFor(teamId: string, accountUid: string): Promise<TeamMemberRole | null> {
    const row = await db.queryOneAsync<{ role: string }>(
      'SELECT role FROM team_members WHERE team_id = ? AND account_uid = ?',
      [teamId, accountUid]
    );
    if (!row) return null;
    return row.role === 'captain' ? 'captain' : 'member';
  },

  /** Whether the account may act for the team (captain). */
  async isCaptain(teamId: string, accountUid: string): Promise<boolean> {
    return (await teamMembers.roleFor(teamId, accountUid)) === 'captain';
  },

  /**
   * Set a member's role, adding the membership when it is missing. Returns
   * false when the write was refused, e.g. because the account has no
   * `players.uid` row or the team is gone (the foreign keys reject it).
   */
  async setRole(teamId: string, accountUid: string, role: TeamMemberRole): Promise<boolean> {
    try {
      const result = await db.runAsync(
        `INSERT INTO team_members (team_id, account_uid, role)
         VALUES (?, ?, ?)
         ON CONFLICT (team_id, account_uid)
         DO UPDATE SET role = EXCLUDED.role, updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
        [teamId, accountUid, role]
      );
      return result.changes > 0;
    } catch (err) {
      log.warn(`[teamMembers] Could not set the role of ${accountUid} in team ${teamId}`, {
        error: (err as Error).message,
      });
      return false;
    }
  },

  /**
   * Make `team_members` match a team's roster: every roster player that has a
   * `players` row becomes a member, and rows for accounts that left the roster
   * go. Existing rows keep their role, so a captain stays a captain across a
   * roster edit.
   *
   * Best effort: a failure is logged and swallowed, because a team write must
   * not fail over a mirror that nothing reads yet.
   */
  async syncFromRoster(teamId: string, steamIds: readonly string[]): Promise<void> {
    try {
      const uids = await accountUidsForSteamIds(steamIds);
      if (uids.length > 0) {
        await db.runAsync(
          `INSERT INTO team_members (team_id, account_uid)
           SELECT ?, u FROM unnest(?::uuid[]) AS u
           ON CONFLICT (team_id, account_uid) DO NOTHING`,
          [teamId, uids]
        );
      }
      await db.runAsync(
        'DELETE FROM team_members WHERE team_id = ? AND NOT (account_uid = ANY(?::uuid[]))',
        [teamId, uids]
      );
    } catch (err) {
      log.warn(`[teamMembers] Could not sync team_members for team ${teamId}`, {
        error: (err as Error).message,
      });
    }
  },
};
