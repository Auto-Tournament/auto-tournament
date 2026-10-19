/**
 * Commends: after a match, each player can commend up to three others from
 * it, teammates or opponents, as Friendly, Leader, Teacher or Good sport.
 * Positive only; reports stay separate (services/playerReports.ts). Nobody
 * sees who commended whom: a player's profile shows counts only.
 *
 * Open for 24 hours after the match is over. One kind per player per match;
 * picking another kind changes it, picking none takes it back.
 *
 * Kept in `commends` with matchmaking's thumbs (value 1, the kind as its
 * tag), so a profile counts both.
 */

import { db } from '../config/database';
import { describeMatch, describedPlayers } from '../utils/matchIntegration';
import { teamPlayers } from './matchViewer';
import { COMMEND_WINDOW_SECONDS } from './matchmaking/progression';
import type { GameId } from '../integrations/types';
import { isOneOf, type Untrusted } from '../utils/untrusted';

export const COMMEND_KINDS = ['friendly', 'leader', 'teacher', 'good_sport'] as const;
export type CommendKind = (typeof COMMEND_KINDS)[number];

/** Commends a player can give in one match. */
export const COMMENDS_PER_MATCH = 3;
/** How long after the match commends stay open. */
export const COMMEND_WINDOW_S = COMMEND_WINDOW_SECONDS;

export class CommendError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
  }
}

export interface CommendPlayer {
  id: string;
  name: string;
  avatar: string | null;
}

export interface CommendSide {
  teamId: string | null;
  teamName: string | null;
  players: CommendPlayer[];
}

interface MatchRow {
  slug: string;
  status: string;
  completed_at: number | null;
  team1_id: string | null;
  team2_id: string | null;
  team1_name: string | null;
  team2_name: string | null;
  team1_players: string | null;
  team2_players: string | null;
  config: string | null;
  game: GameId | null;
}

async function loadMatch(slug: string): Promise<MatchRow> {
  const row = await db.queryOneAsync<MatchRow>(
    `SELECT m.slug, m.status, m.completed_at, m.team1_id, m.team2_id, m.config, m.game,
            t1.name AS team1_name, t2.name AS team2_name,
            t1.players AS team1_players, t2.players AS team2_players
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
      WHERE m.slug = ?`,
    [slug]
  );
  if (!row) throw new CommendError('Match not found', 404, 'not_found');
  return row;
}

/**
 * Who played: the players with stats in the match, else each team's roster
 * (its live roster, else the match's snapshot of it).
 */
async function sidesOf(match: MatchRow): Promise<CommendSide[]> {
  const stats = await db.queryAsync<{ player_id: string; team: string }>(
    'SELECT DISTINCT player_id, team FROM player_match_stats WHERE match_slug = ?',
    [match.slug]
  );
  const description = describeMatch({ game: match.game ?? null, config: match.config ?? null });
  const ids: Record<'team1' | 'team2', string[]> = { team1: [], team2: [] };
  for (const side of ['team1', 'team2'] as const) {
    const played = stats.filter((s) => s.team === side).map((s) => s.player_id);
    ids[side] =
      played.length > 0
        ? played
        : teamPlayers(match[`${side}_players`], describedPlayers(description[side])).map(
            (p) => p.steamid
          );
  }
  const all = [...ids.team1, ...ids.team2];
  const rows =
    all.length > 0
      ? await db.queryAsync<{ id: string; name: string; avatar_url: string | null }>(
          'SELECT id, name, avatar_url FROM players WHERE id = ANY(?::text[]) AND deleted_at IS NULL',
          [all]
        )
      : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (['team1', 'team2'] as const).map((side) => ({
    teamId: match[`${side}_id`],
    teamName: match[`${side}_name`],
    players: ids[side]
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({ id: r.id, name: r.name, avatar: r.avatar_url })),
  }));
}

export interface CommendState {
  /** The viewer played in the match and the 24 hours are not over. */
  open: boolean;
  /** Epoch when commends close, once the match is over. */
  closesAt: number | null;
  max: number;
  /** Receiver id → the kind the viewer gave them. */
  given: Record<string, CommendKind>;
  sides: CommendSide[];
}

export async function commendState(slug: string, viewerId: string | null): Promise<CommendState> {
  const match = await loadMatch(slug);
  const sides = await sidesOf(match);
  const closesAt =
    match.status === 'completed' && match.completed_at
      ? Number(match.completed_at) + COMMEND_WINDOW_S
      : null;
  const played = !!viewerId && sides.some((s) => s.players.some((p) => p.id === viewerId));
  const open = played && closesAt !== null && Date.now() / 1000 < closesAt;
  const given: Record<string, CommendKind> = {};
  if (viewerId) {
    const rows = await db.queryAsync<{ receiver_id: string; kind: CommendKind }>(
      `SELECT to_player_id AS receiver_id, tag AS kind FROM commends
        WHERE match_slug = ? AND from_player_id = ? AND value = 1 AND tag IS NOT NULL`,
      [slug, viewerId]
    );
    for (const r of rows) if (COMMEND_KINDS.includes(r.kind)) given[r.receiver_id] = r.kind;
  }
  return { open, closesAt, max: COMMENDS_PER_MATCH, given, sides };
}

/** Give, change (another kind) or take back (`kind` null) a commend. */
export async function setCommend(
  slug: string,
  giverId: string,
  receiverId: string,
  kind: Untrusted
): Promise<CommendState> {
  if (kind !== null && !isOneOf(COMMEND_KINDS, kind)) {
    throw new CommendError('Unknown commend', 400, 'bad_kind');
  }
  if (giverId === receiverId) {
    throw new CommendError("You can't commend yourself", 400, 'self');
  }
  const state = await commendState(slug, giverId);
  if (!state.open) {
    throw new CommendError('Commends for this match are closed', 409, 'closed');
  }
  if (!state.sides.some((s) => s.players.some((p) => p.id === receiverId))) {
    throw new CommendError('That player was not in this match', 400, 'not_in_match');
  }
  if (kind === null) {
    await db.runAsync(
      'DELETE FROM commends WHERE match_slug = ? AND from_player_id = ? AND to_player_id = ?',
      [slug, giverId, receiverId]
    );
  } else {
    const already = receiverId in state.given;
    if (!already && Object.keys(state.given).length >= COMMENDS_PER_MATCH) {
      throw new CommendError(`Up to ${COMMENDS_PER_MATCH} commends per match`, 409, 'limit');
    }
    await db.runAsync(
      `INSERT INTO commends (match_slug, from_player_id, to_player_id, value, tag, created_at)
       VALUES (?, ?, ?, 1, ?, EXTRACT(EPOCH FROM NOW())::INTEGER)
       ON CONFLICT (match_slug, from_player_id, to_player_id)
       DO UPDATE SET value = 1, tag = EXCLUDED.tag, created_at = EXCLUDED.created_at`,
      [slug, giverId, receiverId, kind]
    );
  }
  return commendState(slug, giverId);
}

export interface CommendCounts {
  /** Every thumbs up and commend, tagged or not. */
  total: number;
  /** Matches the player was commended in. */
  matches: number;
  /** The four kinds, always present. */
  kinds: Record<CommendKind, number>;
  /** Matchmaking's other tags (team player, good comms), when they have any. */
  other: Array<{ tag: string; count: number }>;
}

/** A player's commends, counts only: tournament commends and matchmaking thumbs up. */
export async function commendCounts(playerId: string): Promise<CommendCounts> {
  const rows = await db.queryAsync<{ tag: string | null; n: number | string }>(
    'SELECT tag, COUNT(*) AS n FROM commends WHERE to_player_id = ? AND value = 1 GROUP BY tag',
    [playerId]
  );
  const m = await db.queryOneAsync<{ n: number | string }>(
    'SELECT COUNT(DISTINCT match_slug) AS n FROM commends WHERE to_player_id = ? AND value = 1',
    [playerId]
  );
  const kinds = Object.fromEntries(COMMEND_KINDS.map((k) => [k, 0])) as Record<CommendKind, number>;
  const other: Array<{ tag: string; count: number }> = [];
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n);
    total += n;
    if (r.tag && (COMMEND_KINDS as readonly string[]).includes(r.tag))
      kinds[r.tag as CommendKind] = n;
    else if (r.tag) other.push({ tag: r.tag, count: n });
  }
  other.sort((x, y) => y.count - x.count);
  return { total, matches: Number(m?.n ?? 0), kinds, other };
}
