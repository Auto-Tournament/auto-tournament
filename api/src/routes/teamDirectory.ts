/**
 * Teams for players: the public team list, and a player's own teams.
 *
 * Teams belong to no game: one team plays every game the site runs. A player
 * can make a team and own at most one (the unique `teams.owner_uid` index),
 * and can be a member of any number. The maker becomes the team's owner and a
 * captain in `team_members`; the roster JSON (`teams.players`) starts with
 * just them, like any team an admin makes.
 *
 * GET  /api/team-directory          every team, public
 * GET  /api/team-directory/mine     the signed-in player's teams
 * POST /api/team-directory/mine     make a team (name, tag) owned by them
 *
 * Running a team (services/teamSelfService.ts has who may do what):
 * GET    /:teamId/manage                    the owner view
 * PATCH  /:teamId                           name and tag
 * PUT    /:teamId/logo, DELETE              the logo (PNG, JPEG or WEBP body)
 * GET    /:teamId/logo                      the logo, public
 * POST   /:teamId/invite                    a new invite link code
 * GET    /invite/:code, POST /invite/:code  the join page; ask to join
 * POST   /:teamId/requests/:uid/accept|decline
 * PATCH  /:teamId/members/:uid              role: captain | member (owner)
 * DELETE /:teamId/members/:uid              remove a member, or leave
 * POST   /:teamId/transfer                  make another member the owner
 * DELETE /:teamId                           disband (owner)
 */

import { randomBytes } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { log } from '../utils/logger';
import { resolveViewerAccount } from '../utils/viewerIdentity';
import { teamService } from '../services/teamService';
import { teamMembers } from '../services/teamMembers';
import { playerService } from '../services/playerService';
import express from 'express';
import {
  teamSelfService,
  TeamActionError,
  LOGO_MAX_BYTES,
  logoUrl,
} from '../services/teamSelfService';

const router = Router();

interface DirectoryRow {
  id: string;
  name: string;
  tag: string | null;
  players: string;
  owner_uid: string | null;
  owner_name: string | null;
  logo_updated_at: number | null;
  created_at: number | string;
}

export interface DirectoryTeam {
  id: string;
  name: string;
  tag: string | null;
  memberCount: number;
  ownerName: string | null;
  logoUrl: string | null;
  createdAt: number;
}

function rosterSize(players: string): number {
  try {
    const list = JSON.parse(players) as unknown;
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

function toDirectoryTeam(row: DirectoryRow): DirectoryTeam {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag || null,
    memberCount: rosterSize(row.players),
    ownerName: row.owner_name,
    logoUrl: logoUrl(row.id, row.logo_updated_at),
    createdAt: Number(row.created_at),
  };
}

const DIRECTORY_SELECT = `
  SELECT t.id, t.name, t.tag, t.players, t.owner_uid, p.name AS owner_name, t.logo_updated_at, t.created_at
    FROM teams t
    LEFT JOIN players p ON p.uid = t.owner_uid
`;

/** Team names: 2-32 characters. Tags: 2-5 letters or digits, kept upper case. */
export function validateTeamFields(
  name: unknown,
  tag: unknown
): { name: string; tag: string } | string {
  const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (n.length < 2 || n.length > 32) return 'The team name must be 2 to 32 characters.';
  const t = typeof tag === 'string' ? tag.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{2,5}$/.test(t)) return 'The tag must be 2 to 5 letters or digits.';
  return { name: n, tag: t };
}

/** An id for a player-made team: the name as a slug, plus a short random part. */
function newTeamId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${slug || 'team'}-${randomBytes(3).toString('hex')}`;
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await db.queryAsync<DirectoryRow>(`${DIRECTORY_SELECT} ORDER BY t.name`);
    return res.json({ success: true, teams: rows.map(toDirectoryTeam) });
  } catch (error) {
    log.error('[TeamDirectory] Failed to list teams', { error });
    return res.status(500).json({ success: false, error: 'Failed to list teams' });
  }
});

router.get('/mine', async (req: Request, res: Response) => {
  try {
    const viewer = await resolveViewerAccount(req);
    if (!viewer.uid) {
      return res.status(401).json({ success: false, error: 'Sign in to see your teams' });
    }
    const memberships = await teamMembers.listForAccount(viewer.uid);
    const ids = memberships.map((m) => m.teamId);
    const owned = await db.queryOneAsync<DirectoryRow>(
      `${DIRECTORY_SELECT} WHERE t.owner_uid = ?`,
      [viewer.uid]
    );
    const rows = ids.length
      ? await db.queryAsync<DirectoryRow>(
          `${DIRECTORY_SELECT} WHERE t.id = ANY(?::text[]) ORDER BY t.name`,
          [ids]
        )
      : [];
    const role = new Map(memberships.map((m) => [m.teamId, m.role]));
    return res.json({
      success: true,
      accountUid: viewer.uid,
      owned: owned ? toDirectoryTeam(owned) : null,
      memberOf: rows
        .filter((r) => r.id !== owned?.id)
        .map((r) => ({ ...toDirectoryTeam(r), role: role.get(r.id) ?? 'member' })),
    });
  } catch (error) {
    log.error('[TeamDirectory] Failed to list own teams', { error });
    return res.status(500).json({ success: false, error: 'Failed to list your teams' });
  }
});

router.post('/mine', async (req: Request, res: Response) => {
  try {
    const viewer = await resolveViewerAccount(req);
    if (!viewer.uid || !viewer.playerId) {
      return res.status(401).json({ success: false, error: 'Sign in to make a team' });
    }
    if (viewer.isImpersonating) {
      return res
        .status(403)
        .json({ success: false, error: 'Stop impersonating to make a team of your own.' });
    }
    const fields = validateTeamFields(req.body?.name, req.body?.tag);
    if (typeof fields === 'string') {
      return res.status(400).json({ success: false, error: fields });
    }

    const existing = await db.queryOneAsync<{ id: string }>(
      'SELECT id FROM teams WHERE owner_uid = ?',
      [viewer.uid]
    );
    if (existing) {
      return res.status(409).json({
        success: false,
        code: 'already_owner',
        teamId: existing.id,
        error: 'You already own a team. Hand it over to a teammate to make a new one.',
      });
    }

    const player = await playerService.getPlayerById(viewer.playerId);
    const id = newTeamId(fields.name);
    await teamService.createTeam({
      id,
      name: fields.name,
      tag: fields.tag,
      players: [
        {
          steamId: viewer.playerId,
          name: player?.name || viewer.playerId,
          avatar: player?.avatar || undefined,
        },
      ],
    });
    try {
      await db.runAsync('UPDATE teams SET owner_uid = ? WHERE id = ?', [viewer.uid, id]);
    } catch {
      // Two creates at once: the unique index keeps one; drop this one.
      await teamService.deleteTeam(id).catch(() => undefined);
      return res
        .status(409)
        .json({ success: false, code: 'already_owner', error: 'You already own a team.' });
    }
    await teamMembers.setRole(id, viewer.uid, 'captain');

    const row = await db.queryOneAsync<DirectoryRow>(`${DIRECTORY_SELECT} WHERE t.id = ?`, [id]);
    return res.status(201).json({ success: true, team: row ? toDirectoryTeam(row) : { id } });
  } catch (error) {
    log.error('[TeamDirectory] Failed to make a team', { error });
    return res.status(500).json({ success: false, error: 'Failed to make the team' });
  }
});

/** The signed-in account for a team action, or a 401/403 already sent. */
async function actingAccount(req: Request, res: Response): Promise<string | null> {
  const viewer = await resolveViewerAccount(req);
  if (!viewer.uid) {
    res.status(401).json({ success: false, error: 'Sign in first' });
    return null;
  }
  if (viewer.isImpersonating) {
    res.status(403).json({ success: false, error: 'Stop impersonating to act for a team.' });
    return null;
  }
  return viewer.uid;
}

/** Runs a team action and answers with its result, or its refusal. */
function teamAction(
  action: (req: Request, uid: string | null) => Promise<unknown>,
  { signIn = true }: { signIn?: boolean } = {}
) {
  return async (req: Request, res: Response) => {
    try {
      let uid: string | null = null;
      if (signIn) {
        uid = await actingAccount(req, res);
        if (!uid) return;
      }
      const result = await action(req, uid);
      return res.json({ success: true, ...(result && typeof result === 'object' ? result : {}) });
    } catch (error) {
      if (error instanceof TeamActionError) {
        return res
          .status(error.status)
          .json({ success: false, error: error.message, code: error.code });
      }
      log.error('[TeamDirectory] Team action failed', { error, path: req.path });
      return res.status(500).json({ success: false, error: 'The team action failed' });
    }
  };
}

/** One team's directory entry (logo, owner), for its profile header. Public. */
router.get('/:teamId', async (req: Request, res: Response, next) => {
  if (req.params.teamId === 'mine') return next();
  try {
    const row = await db.queryOneAsync<DirectoryRow>(`${DIRECTORY_SELECT} WHERE t.id = ?`, [
      req.params.teamId,
    ]);
    if (!row) return res.status(404).json({ success: false, error: 'Team not found' });
    return res.json({ success: true, team: toDirectoryTeam(row) });
  } catch (error) {
    log.error('[TeamDirectory] Failed to read a team', { error });
    return res.status(500).json({ success: false, error: 'Failed to read the team' });
  }
});

router.get(
  '/invite/:code',
  teamAction(async (req) => ({ team: await teamSelfService.invite(req.params.code) }), {
    signIn: false,
  })
);
router.post(
  '/invite/:code',
  teamAction(async (req, uid) => teamSelfService.requestToJoin(req.params.code, uid!))
);

router.get('/:teamId/logo', async (req: Request, res: Response) => {
  try {
    const logo = await teamSelfService.logo(req.params.teamId);
    if (!logo) return res.status(404).end();
    res.setHeader('Content-Type', logo.type);
    // The URL carries the update time, so the bytes behind it never change.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(logo.data);
  } catch (error) {
    log.error('[TeamDirectory] Failed to read a logo', { error });
    return res.status(500).end();
  }
});

router.get(
  '/:teamId/manage',
  teamAction(async (req, uid) => teamSelfService.manageView(req.params.teamId, uid!))
);

router.patch(
  '/:teamId',
  teamAction(async (req, uid) => {
    const fields = validateTeamFields(req.body?.name, req.body?.tag);
    if (typeof fields === 'string') throw new TeamActionError(400, fields);
    await teamSelfService.rename(req.params.teamId, uid!, fields.name, fields.tag);
    return {};
  })
);

router.put(
  '/:teamId/logo',
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: LOGO_MAX_BYTES }),
  teamAction(async (req, uid) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new TeamActionError(415, 'Send the logo as a PNG, JPEG or WEBP image.');
    }
    await teamSelfService.setLogo(req.params.teamId, uid!, req.body);
    return {};
  })
);
router.delete(
  '/:teamId/logo',
  teamAction(async (req, uid) => {
    await teamSelfService.setLogo(req.params.teamId, uid!, null);
    return {};
  })
);

router.post(
  '/:teamId/invite',
  teamAction(async (req, uid) => ({
    inviteCode: await teamSelfService.resetInvite(req.params.teamId, uid!),
  }))
);

for (const answer of ['accept', 'decline'] as const) {
  router.post(
    `/:teamId/requests/:uid/${answer}`,
    teamAction(async (req, uid) => {
      await teamSelfService.answerRequest(
        req.params.teamId,
        uid!,
        req.params.uid,
        answer === 'accept'
      );
      return {};
    })
  );
}

router.patch(
  '/:teamId/members/:uid',
  teamAction(async (req, uid) => {
    const role = req.body?.role;
    if (role !== 'captain' && role !== 'member')
      throw new TeamActionError(400, 'role is captain or member');
    await teamSelfService.setRole(req.params.teamId, uid!, req.params.uid, role);
    return {};
  })
);
router.delete(
  '/:teamId/members/:uid',
  teamAction(async (req, uid) => {
    await teamSelfService.removeMember(req.params.teamId, uid!, req.params.uid);
    return {};
  })
);

router.post(
  '/:teamId/transfer',
  teamAction(async (req, uid) => {
    const to = typeof req.body?.uid === 'string' ? req.body.uid : '';
    if (!to) throw new TeamActionError(400, 'uid of the new owner is required');
    await teamSelfService.transfer(req.params.teamId, uid!, to);
    return {};
  })
);

router.delete(
  '/:teamId',
  teamAction(async (req, uid) => {
    await teamSelfService.disband(req.params.teamId, uid!);
    return {};
  })
);

export default router;
