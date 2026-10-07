/**
 * Teams for players: the public team list, and a player's own teams.
 *
 * A team can play every game the site runs; `game` only names the one it
 * mainly plays, for the team list. A player
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
 * PATCH  /:teamId                           name and tag, and/or game
 * PUT    /:teamId/logo, DELETE              the logo (PNG, JPEG or WEBP body)
 * GET    /:teamId/logo                      the logo, public
 * POST   /:teamId/invite                    a new invite link code
 * GET    /invite/:code, POST /invite/:code  the join page; ask to join
 * POST   /:teamId/requests/:uid/accept|decline
 * PATCH  /:teamId/members/:uid              role: captain | member (owner);
 *                                           position, lineup (owner, captains)
 * POST   /:teamId/invites, DELETE /:uid     ask a player on by Steam ID; take it back
 * POST   /:teamId/invites/answer            the invited player: { accept }
 * DELETE /:teamId/members/:uid              remove a member, or leave
 * POST   /:teamId/transfer                  make another member the owner
 * DELETE /:teamId                           disband (owner)
 */

import { RATING_ELO, getGameRatings, ratingGame, ratingJoin } from '../services/gameRatings';
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
  game: string | null;
  created_at: number | string;
}

export interface DirectoryTeam {
  id: string;
  name: string;
  tag: string | null;
  memberCount: number;
  ownerName: string | null;
  logoUrl: string | null;
  game: string | null;
  createdAt: number;
  /** The roster's average rating; null with no rated player. */
  rating?: number | null;
  record?: { wins: number; losses: number };
  /** The map the team has won most, or null. */
  bestMap?: string | null;
}

function rosterIds(players: string): string[] {
  try {
    const list = JSON.parse(players) as unknown;
    return Array.isArray(list)
      ? list.map((p) => (p as { steamId?: string }).steamId).filter((id): id is string => !!id)
      : [];
  } catch {
    return [];
  }
}

/** Rating, record and best map for the list's cards, in three queries. */
async function withNumbers(rows: DirectoryRow[]): Promise<DirectoryTeam[]> {
  const teams = rows.map(toDirectoryTeam);
  if (rows.length === 0) return teams;
  const ids = rows.map((r) => r.id);
  // A team's rating is its players' average in the team's game.
  const idsByGame = new Map<string, Set<string>>();
  for (const r of rows) {
    const game = ratingGame(r.game);
    const set = idsByGame.get(game) ?? new Set<string>();
    rosterIds(r.players).forEach((id) => set.add(id));
    idsByGame.set(game, set);
  }
  const elo = new Map<string, number>();
  for (const [game, set] of idsByGame) {
    for (const [id, r] of await getGameRatings([...set], game)) elo.set(`${game}|${id}`, r.elo);
  }
  const records = new Map(
    (
      await db.queryAsync<{ team_id: string; wins: string | number; played: string | number }>(
        `SELECT x.team_id, SUM(CASE WHEN x.winner_id = x.team_id THEN 1 ELSE 0 END) AS wins, COUNT(*) AS played
           FROM (SELECT team1_id AS team_id, winner_id FROM matches WHERE status = 'completed' AND winner_id IS NOT NULL
                 UNION ALL
                 SELECT team2_id AS team_id, winner_id FROM matches WHERE status = 'completed' AND winner_id IS NOT NULL) x
          WHERE x.team_id = ANY(?::text[])
          GROUP BY x.team_id`,
        [ids]
      )
    ).map((r) => [r.team_id, { wins: Number(r.wins), losses: Number(r.played) - Number(r.wins) }])
  );
  const maps = await db.queryAsync<{ team_id: string; map_name: string; won: string | number }>(
    `SELECT CASE WHEN r.winner_team = 'team1' THEN m.team1_id ELSE m.team2_id END AS team_id,
            r.map_name, COUNT(*) AS won
       FROM match_map_results r JOIN matches m ON m.slug = r.match_slug
      WHERE r.map_name IS NOT NULL AND r.winner_team IN ('team1', 'team2')
        AND (CASE WHEN r.winner_team = 'team1' THEN m.team1_id ELSE m.team2_id END) = ANY(?::text[])
      GROUP BY 1, 2`,
    [ids]
  );
  const best = new Map<string, { map: string; won: number }>();
  for (const m of maps) {
    const won = Number(m.won);
    const current = best.get(m.team_id);
    if (!current || won > current.won) best.set(m.team_id, { map: m.map_name, won });
  }
  return teams.map((team, i) => {
    const rated = rosterIds(rows[i].players)
      .map((id) => elo.get(`${ratingGame(rows[i].game)}|${id}`))
      .filter((v): v is number => v !== undefined);
    return {
      ...team,
      rating: rated.length ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length) : null,
      record: records.get(team.id) ?? { wins: 0, losses: 0 },
      bestMap: best.get(team.id)?.map ?? null,
    };
  });
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
    game: row.game ?? null,
    createdAt: Number(row.created_at),
  };
}

const DIRECTORY_SELECT = `
  SELECT t.id, t.name, t.tag, t.players, t.owner_uid, p.name AS owner_name, t.logo_updated_at, t.game, t.created_at
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
    return res.json({ success: true, teams: await withNumbers(rows) });
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
    // Invites sent by name that the player has not answered yet, per team.
    const pending = new Map(
      (
        await db.queryAsync<{ team_id: string; n: string | number }>(
          'SELECT team_id, COUNT(*) AS n FROM team_invites WHERE team_id = ANY(?::text[]) GROUP BY team_id',
          [[...ids, ...(owned ? [owned.id] : [])]]
        )
      ).map((r) => [r.team_id, Number(r.n)])
    );
    return res.json({
      success: true,
      accountUid: viewer.uid,
      owned: owned
        ? { ...toDirectoryTeam(owned), pendingInvites: pending.get(owned.id) ?? 0 }
        : null,
      memberOf: rows
        .filter((r) => r.id !== owned?.id)
        .map((r) => ({
          ...toDirectoryTeam(r),
          role: role.get(r.id) ?? 'member',
          pendingInvites: pending.get(r.id) ?? 0,
        })),
      invites: await teamSelfService.receivedInvites(viewer.uid),
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

/**
 * The team page's numbers, for any game: the roster with ratings and roles,
 * the team's rating (the roster's average), its record and last ten results,
 * and its rounds won and lost. Public.
 */
router.get('/:teamId/profile', async (req: Request, res: Response) => {
  try {
    const row = await db.queryOneAsync<DirectoryRow>(`${DIRECTORY_SELECT} WHERE t.id = ?`, [
      req.params.teamId,
    ]);
    if (!row) return res.status(404).json({ success: false, error: 'Team not found' });

    let roster: Array<{ steamId: string; name: string; avatar?: string }> = [];
    try {
      const parsed = JSON.parse(row.players) as unknown;
      if (Array.isArray(parsed)) roster = parsed;
    } catch {
      roster = [];
    }
    const ids = roster.map((p) => p.steamId).filter(Boolean);
    const accounts = ids.length
      ? await db.queryAsync<{
          id: string;
          uid: string;
          name: string;
          avatar: string | null;
          current_elo: number;
        }>(
          `SELECT p.id, p.uid, p.name, p.avatar_url AS avatar, ${RATING_ELO} AS current_elo
             FROM players p ${ratingJoin('p')} WHERE p.id = ANY(?::text[])`,
          [ratingGame(row.game), ids]
        )
      : [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const memberRows = new Map((await teamMembers.list(row.id)).map((m) => [m.accountUid, m]));
    // Each player's numbers in this team's matches, and their rating change
    // over the last 30 days.
    const played = ids.length
      ? await db.queryAsync<{
          player_id: string;
          matches: string | number;
          kills: string | number | null;
          deaths: string | number | null;
          adr: string | number | null;
        }>(
          `SELECT s.player_id, COUNT(*) AS matches, SUM(s.kills) AS kills, SUM(s.deaths) AS deaths, AVG(s.adr) AS adr
             FROM player_match_stats s JOIN matches m ON m.slug = s.match_slug
            WHERE s.player_id = ANY(?::text[])
              AND ((s.team = 'team1' AND m.team1_id = ?) OR (s.team = 'team2' AND m.team2_id = ?))
            GROUP BY s.player_id`,
          [ids, row.id, row.id]
        )
      : [];
    const playedBy = new Map(played.map((p) => [p.player_id, p]));
    const monthAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    const monthStart = new Map(
      (ids.length
        ? await db.queryAsync<{ player_id: string; elo_before: number }>(
            `SELECT DISTINCT ON (player_id) player_id, elo_before FROM player_rating_history
              WHERE player_id = ANY(?::text[]) AND created_at >= ?
              ORDER BY player_id, created_at ASC`,
            [ids, monthAgo]
          )
        : []
      ).map((r) => [r.player_id, Number(r.elo_before)])
    );
    const members = roster.map((p) => {
      const a = byId.get(p.steamId);
      const m = a ? memberRows.get(a.uid) : undefined;
      const stats = playedBy.get(p.steamId);
      const rating = a ? Number(a.current_elo) : null;
      const start = monthStart.get(p.steamId);
      const deaths = Number(stats?.deaths ?? 0);
      return {
        steamId: p.steamId,
        name: a?.name || p.name,
        avatar: a?.avatar ?? p.avatar ?? null,
        rating,
        role: a && a.uid === row.owner_uid ? 'owner' : (m?.role ?? 'member'),
        position: m?.position ?? null,
        lineup: m?.lineup ?? 'starter',
        matches: Number(stats?.matches ?? 0),
        kd: stats ? Math.round((Number(stats.kills ?? 0) / Math.max(1, deaths)) * 100) / 100 : null,
        adr: stats?.adr !== null && stats?.adr !== undefined ? Math.round(Number(stats.adr)) : null,
        monthDelta: rating !== null && start !== undefined ? rating - start : null,
      };
    });
    const deltas = members.map((m) => m.monthDelta).filter((d): d is number => d !== null);
    const monthDelta = deltas.length
      ? Math.round(
          deltas.reduce((a, b) => a + b, 0) / members.filter((m) => m.rating !== null).length
        )
      : null;
    // Elimination tournaments the team won: it won the last match with no
    // match after it.
    const trophies = await db.queryAsync<{ name: string; completed_at: number | null }>(
      `SELECT f.name, f.completed_at FROM (
         SELECT DISTINCT ON (m.tournament_id) m.tournament_id, m.winner_id, t.name, t.completed_at
           FROM matches m JOIN tournament t ON t.id = m.tournament_id
          WHERE t.status = 'completed' AND t.type IN ('single_elimination', 'double_elimination')
            AND m.status = 'completed' AND m.next_match_id IS NULL
          ORDER BY m.tournament_id, m.round DESC, m.completed_at DESC NULLS LAST
       ) f WHERE f.winner_id = ? ORDER BY f.completed_at DESC NULLS LAST`,
      [row.id]
    );
    const rated = members.filter((m) => m.rating !== null);
    const rating = rated.length
      ? Math.round(rated.reduce((sum, m) => sum + (m.rating as number), 0) / rated.length)
      : null;

    const results = await db.queryAsync<{ winner_id: string | null }>(
      `SELECT winner_id FROM matches
        WHERE (team1_id = ? OR team2_id = ?) AND status = 'completed' AND winner_id IS NOT NULL
        ORDER BY completed_at DESC NULLS LAST`,
      [row.id, row.id]
    );
    const wins = results.filter((r) => r.winner_id === row.id).length;
    const rounds = await db.queryOneAsync<{
      won: number | string | null;
      lost: number | string | null;
    }>(
      `SELECT SUM(CASE WHEN m.team1_id = ? THEN r.team1_score ELSE r.team2_score END) AS won,
              SUM(CASE WHEN m.team1_id = ? THEN r.team2_score ELSE r.team1_score END) AS lost
         FROM match_map_results r JOIN matches m ON m.slug = r.match_slug
        WHERE (m.team1_id = ? OR m.team2_id = ?) AND r.winner_team IS NOT NULL`,
      [row.id, row.id, row.id, row.id]
    );

    return res.json({
      success: true,
      team: toDirectoryTeam(row),
      members,
      rating,
      record: {
        wins,
        losses: results.length - wins,
        last10: results.slice(0, 10).map((r) => (r.winner_id === row.id ? 'w' : 'l')),
      },
      rounds: { won: Number(rounds?.won ?? 0), lost: Number(rounds?.lost ?? 0) },
      monthDelta,
      trophies: trophies.map((t) => t.name),
    });
  } catch (error) {
    log.error('[TeamDirectory] Failed to read a team profile', { error });
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
    if (req.body && 'game' in req.body) {
      const game = req.body.game;
      if (game !== null && (typeof game !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(game)))
        throw new TeamActionError(400, 'game is a game id or null');
      await teamSelfService.setGame(req.params.teamId, uid!, game);
    }
    if (req.body?.name !== undefined || req.body?.tag !== undefined) {
      const fields = validateTeamFields(req.body?.name, req.body?.tag);
      if (typeof fields === 'string') throw new TeamActionError(400, fields);
      await teamSelfService.rename(req.params.teamId, uid!, fields.name, fields.tag);
    }
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
    const { role, position, lineup } = req.body ?? {};
    if (role === undefined && position === undefined && lineup === undefined)
      throw new TeamActionError(400, 'Nothing to change');
    if (role !== undefined && role !== 'captain' && role !== 'member')
      throw new TeamActionError(400, 'role is captain or member');
    if (position !== undefined && position !== null && typeof position !== 'string')
      throw new TeamActionError(400, 'position is a string or null');
    if (lineup !== undefined && lineup !== 'starter' && lineup !== 'sub')
      throw new TeamActionError(400, 'lineup is starter or sub');
    if (position !== undefined || lineup !== undefined) {
      await teamSelfService.setPlacement(req.params.teamId, uid!, req.params.uid, {
        position,
        lineup,
      });
    }
    if (role !== undefined)
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
  '/:teamId/invites',
  teamAction(async (req, uid) => {
    const steamId = typeof req.body?.steamId === 'string' ? req.body.steamId : '';
    if (!steamId) throw new TeamActionError(400, 'steamId is required');
    return { invite: await teamSelfService.invitePlayer(req.params.teamId, uid!, steamId) };
  })
);
router.post(
  '/:teamId/invites/answer',
  teamAction(async (req, uid) => {
    await teamSelfService.answerInvite(req.params.teamId, uid!, req.body?.accept === true);
    return {};
  })
);
router.delete(
  '/:teamId/invites/:uid',
  teamAction(async (req, uid) => {
    await teamSelfService.cancelInvite(req.params.teamId, uid!, req.params.uid);
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
