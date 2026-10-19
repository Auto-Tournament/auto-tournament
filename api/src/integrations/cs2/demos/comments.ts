/**
 * Comments on a video (its watch page): signed-in players write them, edit
 * and delete their own; an admin can delete any. A comment is plain text (the
 * page shows it as text, never as markup); `mm:ss` and `h:mm:ss` in it become
 * links that seek the video on the page. Videos are known by their library
 * key (demos/library.ts).
 */

import { db } from '../../../config/database';
import type { Untrusted } from '../../../utils/untrusted';

export const COMMENT_MAX = 1000;
/** A player may post this many comments an hour, and one every few seconds. */
export const COMMENTS_PER_HOUR = 30;
export const COMMENT_GAP_SECONDS = 5;

export interface VideoComment {
  id: number;
  playerId: string;
  playerName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: number;
  editedAt: number | null;
}

interface Row {
  id: number;
  player_id: string;
  name: string | null;
  avatar_url: string | null;
  body: string;
  created_at: number;
  edited_at: number | null;
}

const toComment = (r: Row): VideoComment => ({
  id: Number(r.id),
  playerId: r.player_id,
  playerName: r.name ?? r.player_id,
  avatarUrl: r.avatar_url,
  body: r.body,
  createdAt: Number(r.created_at),
  editedAt: r.edited_at === null ? null : Number(r.edited_at),
});

/** The text as it is kept: trimmed, at most COMMENT_MAX, no control characters but newlines. */
export function cleanBody(raw: Untrusted): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const body = raw.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  return body && body.length <= COMMENT_MAX ? body : null;
}

export async function listComments(key: string): Promise<VideoComment[]> {
  const rows = await db.queryAsync<Row>(
    `SELECT c.id, c.player_id, p.name, p.avatar_url, c.body, c.created_at, c.edited_at
       FROM cs2_video_comments c LEFT JOIN players p ON p.id = c.player_id
      WHERE c.video_key = ? AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT 500`,
    [key]
  );
  return rows.map(toComment);
}

/** Why a player may not post now, or null when they may. */
export async function postLimit(playerId: string): Promise<'slow' | 'hour' | null> {
  const [row] = await db.queryAsync<{ last: number | null; hour: number }>(
    `SELECT MAX(created_at) AS last,
            COUNT(*) FILTER (WHERE created_at > EXTRACT(EPOCH FROM NOW())::INTEGER - 3600)::int AS hour
       FROM cs2_video_comments WHERE player_id = ?`,
    [playerId]
  );
  const now = Math.floor(Date.now() / 1000);
  if (row?.last && now - Number(row.last) < COMMENT_GAP_SECONDS) return 'slow';
  if (Number(row?.hour ?? 0) >= COMMENTS_PER_HOUR) return 'hour';
  return null;
}

export async function addComment(
  key: string,
  playerId: string,
  body: string
): Promise<VideoComment> {
  const [row] = await db.queryAsync<{ id: number }>(
    `INSERT INTO cs2_video_comments (video_key, player_id, body) VALUES (?, ?, ?) RETURNING id`,
    [key, playerId, body]
  );
  return (await commentById(Number(row.id)))!;
}

export async function commentById(
  id: number
): Promise<(VideoComment & { videoKey: string }) | null> {
  const [row] = await db.queryAsync<Row & { video_key: string }>(
    `SELECT c.id, c.video_key, c.player_id, p.name, p.avatar_url, c.body, c.created_at, c.edited_at
       FROM cs2_video_comments c LEFT JOIN players p ON p.id = c.player_id
      WHERE c.id = ? AND c.deleted_at IS NULL`,
    [id]
  );
  return row ? { ...toComment(row), videoKey: row.video_key } : null;
}

export async function editComment(id: number, body: string): Promise<VideoComment | null> {
  await db.runAsync(
    `UPDATE cs2_video_comments SET body = ?, edited_at = EXTRACT(EPOCH FROM NOW())::INTEGER
      WHERE id = ? AND deleted_at IS NULL`,
    [body, id]
  );
  return commentById(id);
}

/** Deleted comments are kept (for moderation), hidden from the page. */
export async function deleteComment(id: number, by: string): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_video_comments SET deleted_at = EXTRACT(EPOCH FROM NOW())::INTEGER, deleted_by = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [by, id]
  );
}
