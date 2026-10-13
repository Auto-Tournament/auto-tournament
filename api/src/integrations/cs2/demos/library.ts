/**
 * The highlights library: every finished clip and reel in one list, newest,
 * most viewed or most liked first, narrowed to a player, team, match or
 * tournament. Each video is known by its watch path without `/watch/`
 * (`clip/185`, `match/<slug>/<map>`, `team/<slug>/<team>`, `tournament/<id>`,
 * `reel/<slug>/<map>/<player>`): the key its views and likes are kept under.
 *
 * A view counts once per viewer per video every VIEW_WINDOW seconds (a
 * signed-in player by their id, anyone else by the browser's own id); a like
 * is one per signed-in player per video.
 */

import { db } from '../../../config/database';

/** A viewer's view of a video counts again after this many seconds. */
export const VIEW_WINDOW = 12 * 60 * 60;

export type LibrarySort = 'new' | 'views' | 'likes';
export type LibraryKind = 'all' | 'clips' | 'reels';

export interface LibraryQuery {
  sort: LibrarySort;
  kind: LibraryKind;
  player?: string;
  team?: string;
  match?: string;
  tournament?: number;
  /** A map by its id (de_mirage): the clips and reels played on it. */
  map?: string;
  page: number;
  limit: number;
  /** The signed-in player: whether they liked each video. */
  viewer?: string | null;
}

export interface LibraryItem {
  key: string;
  /** clip, player (a player's map reel), map, series, team, tournament. */
  kind: 'clip' | 'player' | 'map' | 'series' | 'team' | 'tournament';
  /** The file the player plays. */
  video: string;
  /** For a clip: what it is (4k, ace, clutch…) and its title. */
  play: string | null;
  title: string | null;
  round: number | null;
  matchSlug: string | null;
  mapNumber: number | null;
  map: string | null;
  playerId: string | null;
  playerName: string | null;
  avatarUrl: string | null;
  teamId: string | null;
  teamName: string | null;
  team1: string | null;
  team2: string | null;
  tournamentId: number | null;
  tournament: string | null;
  createdAt: number;
  views: number;
  likes: number;
  liked: boolean;
}

const VIDEO_KEY =
  /^(clip\/\d+|match\/[^/]{1,200}\/-?\d+|team\/[^/]{1,200}\/[^/]{1,200}|tournament\/\d+|reel\/[^/]{1,200}\/\d+\/\d{5,20})$/;

/** A video key as the client sends it; null when it is not one. */
export function videoKey(raw: unknown): string | null {
  return typeof raw === 'string' && VIDEO_KEY.test(raw) ? raw : null;
}

/** The finished videos, one row each, with what the list filters on. */
const ITEMS = `
  SELECT 'clip/' || h.id AS key, 'clip' AS kind, '/api/game/cs2/highlights/' || h.id || '.mp4' AS video,
         h.kind AS play, h.title, h.round, h.match_slug, h.map_number, h.player_id, NULL::text AS team_id,
         NULL::integer AS tournament_id, COALESCE(h.done_at, h.created_at) AS created_at
    FROM cs2_highlights h
   WHERE h.status = 'done' AND h.kind <> 'funny' AND h.clip_path IS NOT NULL
  UNION ALL
  SELECT 'reel/' || r.match_slug || '/' || r.map_number || '/' || r.player_id, 'player',
         '/api/game/cs2/highlights/' || r.clip_path, NULL, NULL, NULL, r.match_slug, r.map_number,
         r.player_id, NULL, NULL, r.created_at
    FROM cs2_highlight_reels r
  UNION ALL
  SELECT 'match/' || r.match_slug || '/' || r.map_number, CASE WHEN r.map_number < 0 THEN 'series' ELSE 'map' END,
         '/api/game/cs2/highlights/' || r.clip_path, NULL, NULL, NULL, r.match_slug, r.map_number,
         NULL, NULL, NULL, r.created_at
    FROM cs2_match_reels r
   WHERE r.status = 'done' AND r.clip_path IS NOT NULL
  UNION ALL
  SELECT 'team/' || r.match_slug || '/' || r.team_id, 'team', '/api/game/cs2/highlights/' || r.clip_path,
         NULL, NULL, NULL, r.match_slug, NULL, NULL, r.team_id, NULL, r.created_at
    FROM cs2_team_reels r
   WHERE r.status = 'done' AND r.clip_path IS NOT NULL
  UNION ALL
  SELECT 'tournament/' || r.tournament_id, 'tournament', '/api/game/cs2/highlights/' || r.clip_path,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, r.tournament_id, r.created_at
    FROM cs2_tournament_reels r
   WHERE r.status = 'done' AND r.clip_path IS NOT NULL`;

interface Row {
  key: string;
  kind: LibraryItem['kind'];
  video: string;
  play: string | null;
  title: string | null;
  round: number | null;
  match_slug: string | null;
  map_number: number | null;
  player_id: string | null;
  team_id: string | null;
  tournament_id: number | null;
  created_at: number;
  map_name: string | null;
  player_name: string | null;
  avatar_url: string | null;
  team_name: string | null;
  team1: string | null;
  team2: string | null;
  tournament: string | null;
  match_tournament_id: number | null;
  views: number;
  likes: number;
  liked: boolean;
  total: number;
}

export async function libraryPage(
  q: LibraryQuery
): Promise<{ items: LibraryItem[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [q.viewer ?? ''];
  if (q.kind === 'clips') where.push(`i.kind = 'clip'`);
  if (q.kind === 'reels') where.push(`i.kind <> 'clip'`);
  if (q.player) {
    where.push('i.player_id = ?');
    args.push(q.player);
  }
  if (q.match) {
    where.push('i.match_slug = ?');
    args.push(q.match);
  }
  if (q.tournament !== undefined) {
    where.push('(i.tournament_id = ? OR m.tournament_id = ?)');
    args.push(q.tournament, q.tournament);
  }
  if (q.map) {
    where.push('j.map_name = ?');
    args.push(q.map);
  }
  if (q.team) {
    // The team's reels, its match and series reels, and its players' clips
    // and reels in its matches (by the team's roster).
    where.push(`(i.team_id = ?
      OR (i.kind IN ('map', 'series') AND (m.team1_id = ? OR m.team2_id = ?))
      OR (i.kind IN ('clip', 'player') AND (m.team1_id = ? OR m.team2_id = ?)
          AND EXISTS (SELECT 1 FROM teams ft WHERE ft.id = ? AND ft.players LIKE '%' || i.player_id || '%')))`);
    args.push(q.team, q.team, q.team, q.team, q.team, q.team);
  }
  const order =
    q.sort === 'views'
      ? 'views DESC, i.created_at DESC'
      : q.sort === 'likes'
        ? 'likes DESC, i.created_at DESC'
        : 'i.created_at DESC';
  args.push(q.limit, (q.page - 1) * q.limit);
  const rows = await db.queryAsync<Row>(
    `SELECT i.*, j.map_name, p.name AS player_name, p.avatar_url, tm.name AS team_name,
            t1.name AS team1, t2.name AS team2, m.tournament_id AS match_tournament_id,
            COALESCE(tr.name, m.played_in) AS tournament,
            COALESCE(v.views, 0)::int AS views, COALESCE(l.likes, 0)::int AS likes,
            EXISTS (SELECT 1 FROM cs2_video_likes ml WHERE ml.video_key = i.key AND ml.player_id = ?) AS liked,
            COUNT(*) OVER ()::int AS total
       FROM (${ITEMS}) i
       LEFT JOIN cs2_demo_jobs j ON j.match_slug = i.match_slug AND j.map_number = i.map_number
       LEFT JOIN players p ON p.id = i.player_id
       LEFT JOIN teams tm ON tm.id = i.team_id
       LEFT JOIN matches m ON m.slug = i.match_slug
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = COALESCE(i.tournament_id, m.tournament_id)
       LEFT JOIN (SELECT video_key, SUM(views) AS views FROM cs2_video_views GROUP BY video_key) v ON v.video_key = i.key
       LEFT JOIN (SELECT video_key, COUNT(*) AS likes FROM cs2_video_likes GROUP BY video_key) l ON l.video_key = i.key
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`,
    args
  );
  const num = (n: number | null) => (n === null ? null : Number(n));
  return {
    total: rows.length ? Number(rows[0].total) : 0,
    items: rows.map((r) => ({
      key: r.key,
      kind: r.kind,
      video: r.video,
      play: r.play,
      title: r.title,
      round: num(r.round),
      matchSlug: r.match_slug,
      mapNumber: num(r.map_number),
      map: r.map_name,
      playerId: r.player_id,
      playerName: r.player_name ?? r.player_id,
      avatarUrl: r.avatar_url,
      teamId: r.team_id,
      teamName: r.team_name,
      team1: r.team1,
      team2: r.team2,
      tournamentId: num(r.tournament_id ?? r.match_tournament_id),
      tournament: r.tournament,
      createdAt: Number(r.created_at),
      views: Number(r.views),
      likes: Number(r.likes),
      liked: Boolean(r.liked),
    })),
  };
}

/** One video's counts, and whether this player liked it. */
export async function videoStats(
  key: string,
  viewer: string | null
): Promise<{ views: number; likes: number; liked: boolean }> {
  const [row] = await db.queryAsync<{ views: number; likes: number; liked: boolean }>(
    `SELECT (SELECT COALESCE(SUM(views), 0) FROM cs2_video_views WHERE video_key = ?)::int AS views,
            (SELECT COUNT(*) FROM cs2_video_likes WHERE video_key = ?)::int AS likes,
            EXISTS (SELECT 1 FROM cs2_video_likes WHERE video_key = ? AND player_id = ?) AS liked`,
    [key, key, key, viewer ?? '']
  );
  return {
    views: Number(row?.views ?? 0),
    likes: Number(row?.likes ?? 0),
    liked: Boolean(row?.liked),
  };
}

/** A view: counted once per viewer and video every VIEW_WINDOW seconds. Returns whether it counted. */
export async function countView(key: string, viewer: string): Promise<boolean> {
  const rows = await db.queryAsync<{ video_key: string }>(
    `INSERT INTO cs2_video_views (video_key, viewer, views, viewed_at)
     VALUES (?, ?, 1, EXTRACT(EPOCH FROM NOW())::INTEGER)
     ON CONFLICT (video_key, viewer) DO UPDATE SET views = cs2_video_views.views + 1, viewed_at = EXCLUDED.viewed_at
       WHERE cs2_video_views.viewed_at < EXCLUDED.viewed_at - ?
     RETURNING video_key`,
    [key, viewer, VIEW_WINDOW]
  );
  return rows.length > 0;
}

/** A signed-in player likes a video, or takes the like back. */
export async function setLike(key: string, playerId: string, liked: boolean): Promise<void> {
  if (liked) {
    await db.runAsync(
      `INSERT INTO cs2_video_likes (video_key, player_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
      [key, playerId]
    );
  } else {
    await db.runAsync('DELETE FROM cs2_video_likes WHERE video_key = ? AND player_id = ?', [
      key,
      playerId,
    ]);
  }
}
