/**
 * What players do to their own team: the owner and captains run it, members
 * can leave, and anyone signed in can ask to join through the invite link.
 *
 * Who may do what:
 * - owner: everything, including roles, handing the team over and disbanding;
 * - captain: rename, logo, invite link, accept or decline requests, remove
 *   members (not the owner, not other captains);
 * - member: leave.
 *
 * `teams.players` stays the roster of record (match configs read it), so a
 * roster change goes through `teamService.updateTeam`, which also keeps
 * `team_members` in step. While the team plays a tournament that is in
 * progress the roster is locked: a change mid-tournament would change the
 * players a running match expects. Admins can still edit it on the Teams page.
 */

import { randomBytes } from 'node:crypto';
import { db } from '../config/database';
import { teamService } from './teamService';
import { teamMembers, type TeamMemberRole } from './teamMembers';
import type { Player } from '../types/team.types';

export class TeamActionError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export type TeamRole = 'owner' | TeamMemberRole;

export interface ManagedMember {
  uid: string;
  steamId: string;
  name: string;
  avatar: string | null;
  role: TeamRole;
}

export interface JoinRequest {
  uid: string;
  steamId: string;
  name: string;
  avatar: string | null;
  rating: number | null;
  createdAt: number;
}

interface TeamRow {
  id: string;
  name: string;
  tag: string | null;
  players: string;
  owner_uid: string | null;
  invite_code: string | null;
  logo_updated_at: number | null;
}

/** Logos: PNG, JPEG or WEBP, at most 256 KB, recognised by their first bytes. */
export const LOGO_MAX_BYTES = 256 * 1024;

export function logoMediaType(data: Buffer): string | null {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg';
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function logoUrl(teamId: string, updatedAt: number | null | undefined): string | null {
  return updatedAt ? `/api/team-directory/${encodeURIComponent(teamId)}/logo?v=${updatedAt}` : null;
}

function parseRoster(players: string): Player[] {
  try {
    const list = JSON.parse(players) as unknown;
    return Array.isArray(list) ? (list as Player[]) : [];
  } catch {
    return [];
  }
}

async function loadTeam(teamId: string): Promise<TeamRow> {
  const row = await db.queryOneAsync<TeamRow>(
    'SELECT id, name, tag, players, owner_uid, invite_code, logo_updated_at FROM teams WHERE id = ?',
    [teamId]
  );
  if (!row) throw new TeamActionError(404, 'Team not found');
  return row;
}

/** The viewer's role in the team, or null when they are not on it. */
async function roleOf(team: TeamRow, uid: string): Promise<TeamRole | null> {
  if (team.owner_uid && team.owner_uid === uid) return 'owner';
  return teamMembers.roleFor(team.id, uid);
}

async function requireRole(team: TeamRow, uid: string, allowed: TeamRole[]): Promise<TeamRole> {
  const role = await roleOf(team, uid);
  if (!role || !allowed.includes(role)) {
    throw new TeamActionError(
      403,
      allowed.includes('captain')
        ? 'Only the owner or a captain can do that.'
        : 'Only the owner can do that.'
    );
  }
  return role;
}

/** The name of a tournament in progress that the team plays, or null. */
export async function activeTournamentOf(teamId: string): Promise<string | null> {
  const rows = await db.queryAsync<{ name: string; team_ids: string }>(
    "SELECT name, team_ids FROM tournament WHERE status = 'in_progress'"
  );
  for (const row of rows) {
    try {
      const ids = JSON.parse(row.team_ids) as unknown;
      if (Array.isArray(ids) && ids.includes(teamId)) return row.name;
    } catch {
      // A malformed list holds no team.
    }
  }
  return null;
}

async function requireRosterUnlocked(teamId: string): Promise<void> {
  const tournament = await activeTournamentOf(teamId);
  if (tournament) {
    throw new TeamActionError(
      409,
      `The roster is locked while ${tournament} is in progress. Ask an admin if it has to change.`,
      'roster_locked'
    );
  }
}

async function accountsBySteamId(
  steamIds: string[]
): Promise<Map<string, { uid: string; name: string; avatar: string | null }>> {
  const rows = steamIds.length
    ? await db.queryAsync<{ id: string; uid: string; name: string; avatar: string | null }>(
        'SELECT id, uid, name, avatar_url AS avatar FROM players WHERE id = ANY(?::text[])',
        [steamIds]
      )
    : [];
  return new Map(rows.map((r) => [r.id, { uid: r.uid, name: r.name, avatar: r.avatar }]));
}

export const teamSelfService = {
  /** Everything the owner view shows. Owner and captains only. */
  async manageView(teamId: string, uid: string) {
    const team = await loadTeam(teamId);
    const viewerRole = await requireRole(team, uid, ['owner', 'captain']);
    const roster = parseRoster(team.players);
    const accounts = await accountsBySteamId(roster.map((p) => p.steamId));
    const roles = new Map((await teamMembers.list(team.id)).map((m) => [m.accountUid, m.role]));
    const members: ManagedMember[] = roster.map((p) => {
      const account = accounts.get(p.steamId);
      const memberUid = account?.uid ?? '';
      return {
        uid: memberUid,
        steamId: p.steamId,
        name: account?.name || p.name,
        avatar: account?.avatar ?? p.avatar ?? null,
        role:
          memberUid && memberUid === team.owner_uid ? 'owner' : (roles.get(memberUid) ?? 'member'),
      };
    });
    const requests = await db.queryAsync<{
      account_uid: string;
      id: string;
      name: string;
      avatar: string | null;
      current_elo: number | null;
      created_at: number;
    }>(
      `SELECT r.account_uid, p.id, p.name, p.avatar_url AS avatar, p.current_elo, r.created_at
         FROM team_join_requests r JOIN players p ON p.uid = r.account_uid
        WHERE r.team_id = ? ORDER BY r.created_at`,
      [team.id]
    );
    return {
      team: {
        id: team.id,
        name: team.name,
        tag: team.tag,
        logoUrl: logoUrl(team.id, team.logo_updated_at),
        inviteCode: team.invite_code,
      },
      viewerRole,
      rosterLockedBy: await activeTournamentOf(team.id),
      members,
      requests: requests.map((r): JoinRequest => ({
        uid: r.account_uid,
        steamId: r.id,
        name: r.name,
        avatar: r.avatar,
        rating: r.current_elo === null ? null : Number(r.current_elo),
        createdAt: Number(r.created_at),
      })),
    };
  },

  async rename(teamId: string, uid: string, name: string, tag: string): Promise<void> {
    const team = await loadTeam(teamId);
    await requireRole(team, uid, ['owner', 'captain']);
    await teamService.updateTeam(team.id, { name, tag });
  },

  async setLogo(teamId: string, uid: string, data: Buffer | null): Promise<void> {
    const team = await loadTeam(teamId);
    await requireRole(team, uid, ['owner', 'captain']);
    if (data === null) {
      await db.runAsync(
        'UPDATE teams SET logo = NULL, logo_type = NULL, logo_updated_at = NULL WHERE id = ?',
        [team.id]
      );
      return;
    }
    if (data.length > LOGO_MAX_BYTES)
      throw new TeamActionError(413, 'The logo must be 256 KB or smaller.');
    const type = logoMediaType(data);
    if (!type) throw new TeamActionError(415, 'The logo must be a PNG, JPEG or WEBP image.');
    await db.runAsync(
      'UPDATE teams SET logo = ?, logo_type = ?, logo_updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER WHERE id = ?',
      [data, type, team.id]
    );
  },

  async logo(teamId: string): Promise<{ data: Buffer; type: string } | null> {
    const row = await db.queryOneAsync<{ logo: Buffer | null; logo_type: string | null }>(
      'SELECT logo, logo_type FROM teams WHERE id = ?',
      [teamId]
    );
    return row?.logo && row.logo_type ? { data: row.logo, type: row.logo_type } : null;
  },

  /** A new invite code; the old link stops working. */
  async resetInvite(teamId: string, uid: string): Promise<string> {
    const team = await loadTeam(teamId);
    await requireRole(team, uid, ['owner', 'captain']);
    const code = randomBytes(6).toString('base64url');
    await db.runAsync('UPDATE teams SET invite_code = ? WHERE id = ?', [code, team.id]);
    return code;
  },

  /** The team an invite code opens, for the join page. Public. */
  async invite(code: string) {
    const team = await db.queryOneAsync<TeamRow>(
      'SELECT id, name, tag, players, owner_uid, invite_code, logo_updated_at FROM teams WHERE invite_code = ?',
      [code]
    );
    if (!team) throw new TeamActionError(404, 'This invite link is not valid any more.');
    return {
      id: team.id,
      name: team.name,
      tag: team.tag,
      logoUrl: logoUrl(team.id, team.logo_updated_at),
      memberCount: parseRoster(team.players).length,
    };
  },

  async requestToJoin(
    code: string,
    uid: string
  ): Promise<{ teamId: string; status: 'requested' | 'member' }> {
    const team = await db.queryOneAsync<TeamRow>(
      'SELECT id, name, tag, players, owner_uid, invite_code, logo_updated_at FROM teams WHERE invite_code = ?',
      [code]
    );
    if (!team) throw new TeamActionError(404, 'This invite link is not valid any more.');
    if (await roleOf(team, uid)) return { teamId: team.id, status: 'member' };
    await db.runAsync(
      'INSERT INTO team_join_requests (team_id, account_uid) VALUES (?, ?) ON CONFLICT (team_id, account_uid) DO NOTHING',
      [team.id, uid]
    );
    return { teamId: team.id, status: 'requested' };
  },

  async answerRequest(
    teamId: string,
    uid: string,
    requesterUid: string,
    accept: boolean
  ): Promise<void> {
    const team = await loadTeam(teamId);
    await requireRole(team, uid, ['owner', 'captain']);
    const request = await db.queryOneAsync<{ id: string; name: string; avatar: string | null }>(
      `SELECT p.id, p.name, p.avatar_url AS avatar FROM team_join_requests r JOIN players p ON p.uid = r.account_uid
        WHERE r.team_id = ? AND r.account_uid = ?`,
      [team.id, requesterUid]
    );
    if (!request) throw new TeamActionError(404, 'That request is gone.');
    if (accept) {
      await requireRosterUnlocked(team.id);
      const roster = parseRoster(team.players);
      if (!roster.some((p) => p.steamId === request.id)) {
        roster.push({
          steamId: request.id,
          name: request.name,
          avatar: request.avatar ?? undefined,
        });
        await teamService.updateTeam(team.id, { players: roster });
      }
    }
    await db.runAsync('DELETE FROM team_join_requests WHERE team_id = ? AND account_uid = ?', [
      team.id,
      requesterUid,
    ]);
  },

  /** Owner only: make a member a captain, or a captain a member. */
  async setRole(
    teamId: string,
    uid: string,
    memberUid: string,
    role: TeamMemberRole
  ): Promise<void> {
    const team = await loadTeam(teamId);
    await requireRole(team, uid, ['owner']);
    if (memberUid === team.owner_uid)
      throw new TeamActionError(400, "The owner's role does not change.");
    if (!(await teamMembers.roleFor(team.id, memberUid)))
      throw new TeamActionError(404, 'Not on this team.');
    await teamMembers.setRole(team.id, memberUid, role);
  },

  /**
   * Take a member off the roster. The owner removes anyone but themselves; a
   * captain removes members; anyone removes themselves (leaving), except the
   * owner, who hands the team over or disbands it.
   */
  async removeMember(teamId: string, uid: string, memberUid: string): Promise<void> {
    const team = await loadTeam(teamId);
    if (memberUid === team.owner_uid) {
      throw new TeamActionError(400, 'The owner cannot leave. Hand the team over or disband it.');
    }
    const target = await teamMembers.roleFor(team.id, memberUid);
    if (!target) throw new TeamActionError(404, 'Not on this team.');
    if (memberUid !== uid) {
      const role = await requireRole(team, uid, ['owner', 'captain']);
      if (role === 'captain' && target === 'captain') {
        throw new TeamActionError(403, 'Only the owner can remove a captain.');
      }
    }
    await requireRosterUnlocked(team.id);
    const steam = await db.queryOneAsync<{ id: string }>('SELECT id FROM players WHERE uid = ?', [
      memberUid,
    ]);
    const roster = parseRoster(team.players).filter((p) => p.steamId !== steam?.id);
    await teamService.updateTeam(team.id, { players: roster });
  },

  /** Owner only: make another member the owner (they become captain). */
  async transfer(teamId: string, uid: string, newOwnerUid: string): Promise<void> {
    const team = await loadTeam(teamId);
    await requireRole(team, uid, ['owner']);
    if (newOwnerUid === uid) return;
    if (!(await teamMembers.roleFor(team.id, newOwnerUid)))
      throw new TeamActionError(404, 'Not on this team.');
    const owns = await db.queryOneAsync<{ id: string }>(
      'SELECT id FROM teams WHERE owner_uid = ?',
      [newOwnerUid]
    );
    if (owns) throw new TeamActionError(409, 'That player already owns a team.', 'already_owner');
    await db.runAsync('UPDATE teams SET owner_uid = ? WHERE id = ?', [newOwnerUid, team.id]);
    await teamMembers.setRole(team.id, newOwnerUid, 'captain');
  },

  /** Owner only. A team in a tournament that is in progress stays. */
  async disband(teamId: string, uid: string): Promise<void> {
    const team = await loadTeam(teamId);
    await requireRole(team, uid, ['owner']);
    const tournament = await activeTournamentOf(team.id);
    if (tournament) {
      throw new TeamActionError(
        409,
        `The team plays ${tournament}, which is in progress. Disband it afterwards.`,
        'roster_locked'
      );
    }
    await teamService.deleteTeam(team.id);
  },
};
