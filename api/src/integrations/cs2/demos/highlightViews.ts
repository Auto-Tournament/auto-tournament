/**
 * Highlights as the site shows them (./highlights.ts records them):
 *
 * - a player's clips and reels, and the one they picked as their favourite;
 * - a tournament's: its reel, its top plays and each match's reels;
 * - one video to watch, with its kill markers or its chapters.
 *
 * And the tournament reel: once a tournament is over and every highlight of
 * it is recorded, its best plays are joined into one video (the recorder
 * tags and joins them like a match reel).
 */

import fs from 'fs';
import path from 'path';
import { db } from '../../../config/database';
import { HIGHLIGHTS_DIR, matchLine, type ClipMarkers, type MatchReelClip } from './highlights';

/** A recording that went quiet this long is handed out again. */
const STALE_SECONDS = 30 * 60;
const MAX_ATTEMPTS = 3;
/** A tournament reel needs at least this many recorded highlights. */
const TOURNAMENT_REEL_MIN = 3;

const CLIP_SELECT = `
  SELECT h.id, h.match_slug, h.map_number, h.player_id, h.kind, h.title, h.score, h.status, h.round,
         h.markers, h.created_at, h.slowmo_tick, j.map_name, p.name AS player_name, p.avatar_url,
         t1.name AS team1, t2.name AS team2, m.tournament_id, COALESCE(tr.name, m.played_in) AS tournament,
         m.round AS match_round, m.bracket, m.match_number
    FROM cs2_highlights h
    LEFT JOIN cs2_demo_jobs j ON j.match_slug = h.match_slug AND j.map_number = h.map_number
    LEFT JOIN players p ON p.id = h.player_id
    LEFT JOIN matches m ON m.slug = h.match_slug
    LEFT JOIN teams t1 ON t1.id = m.team1_id
    LEFT JOIN teams t2 ON t2.id = m.team2_id
    LEFT JOIN tournament tr ON tr.id = m.tournament_id`;

interface ClipRow {
  id: number;
  match_slug: string;
  map_number: number;
  player_id: string;
  kind: string;
  title: string;
  score: number;
  status: string;
  round: number;
  markers: string | null;
  created_at: number;
  slowmo_tick: number;
  map_name: string | null;
  player_name: string | null;
  avatar_url: string | null;
  team1: string | null;
  team2: string | null;
  tournament_id: number | null;
  tournament: string | null;
  match_round: number | null;
  bracket: string | null;
  match_number: number | null;
}

/** The match a highlight or reel is from, for its labels and links. */
export interface MatchRef {
  slug: string;
  team1: string | null;
  team2: string | null;
  tournamentId: number | null;
  tournament: string | null;
  round: number | null;
  bracket: string | null;
  matchNumber: number | null;
}

export interface ClipView {
  id: number;
  matchSlug: string;
  mapNumber: number;
  map: string | null;
  playerId: string;
  playerName: string;
  avatarUrl: string | null;
  kind: string;
  clutch: boolean;
  title: string;
  score: number;
  status: string;
  round: number;
  video: string | null;
  markers: ClipMarkers | null;
  match: MatchRef;
  createdAt: number;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toClip(r: ClipRow): ClipView {
  return {
    id: Number(r.id),
    matchSlug: r.match_slug,
    mapNumber: Number(r.map_number),
    map: r.map_name,
    playerId: r.player_id,
    playerName: r.player_name ?? r.player_id,
    avatarUrl: r.avatar_url,
    kind: r.kind,
    clutch: / clutch\b/.test(r.title),
    title: r.title,
    score: Number(r.score),
    status: r.status,
    round: Number(r.round),
    video: r.status === 'done' ? `/api/game/cs2/highlights/${Number(r.id)}.mp4` : null,
    markers: parseJson<ClipMarkers>(r.markers),
    match: {
      slug: r.match_slug,
      team1: r.team1,
      team2: r.team2,
      tournamentId: r.tournament_id === null ? null : Number(r.tournament_id),
      tournament: r.tournament,
      round: r.match_round === null ? null : Number(r.match_round),
      bracket: r.bracket,
      matchNumber: r.match_number === null ? null : Number(r.match_number),
    },
    createdAt: Number(r.created_at),
  };
}

async function clipsById(ids: number[]): Promise<ClipView[]> {
  if (ids.length === 0) return [];
  const rows = await db.queryAsync<ClipRow>(
    `${CLIP_SELECT} WHERE h.id IN (${ids.map(() => '?').join(', ')})`,
    ids
  );
  const byId = new Map(rows.map((r) => [Number(r.id), toClip(r)]));
  return ids.map((id) => byId.get(id)).filter((c): c is ClipView => !!c);
}

export async function clipView(id: number): Promise<ClipView | null> {
  return (await clipsById([id]))[0] ?? null;
}

/** One clip in a reel, and where it starts (seconds; null once a clip before it has no known length). */
export interface Chapter {
  highlightId: number;
  playerId: string;
  playerName: string;
  kind: string;
  clutch: boolean;
  title: string;
  map: string | null;
  round: number;
  at: number | null;
}

/** A reel's chapters, from the clips it joins in order. */
export async function chaptersOf(clipIdsJson: string | null): Promise<Chapter[]> {
  const ids = parseJson<number[]>(clipIdsJson);
  if (!Array.isArray(ids)) return [];
  const clips = await clipsById(ids.map(Number).filter(Number.isInteger));
  let at: number | null = 0;
  return clips.map((c) => {
    const chapter: Chapter = {
      highlightId: c.id,
      playerId: c.playerId,
      playerName: c.playerName,
      kind: c.kind,
      clutch: c.clutch,
      title: c.title,
      map: c.map,
      round: c.round,
      at,
    };
    at = at !== null && c.markers ? at + c.markers.duration : null;
    return chapter;
  });
}

const fileUrl = (clipPath: string) => `/api/game/cs2/highlights/${encodeURIComponent(clipPath)}`;

// ---------------------------------------------------------------------------
// A player's
// ---------------------------------------------------------------------------

/** A player's highlights: the recorded ones best first, then the ones still waiting. */
export async function playerClips(playerId: string, limit: number): Promise<ClipView[]> {
  const rows = await db.queryAsync<ClipRow>(
    `${CLIP_SELECT}
      WHERE h.player_id = ? AND h.status IN ('done', 'pending', 'recording')
      ORDER BY (h.status = 'done') DESC, h.score DESC, h.id DESC
      LIMIT ?`,
    [playerId, limit]
  );
  return rows.map(toClip);
}

/** A player's reels of each map, newest first. */
export async function playerReelViews(playerId: string, limit: number) {
  const rows = await db.queryAsync<{
    match_slug: string;
    map_number: number;
    moments: number;
    clip_path: string;
    clip_ids: string | null;
    created_at: number;
    map_name: string | null;
    team1: string | null;
    team2: string | null;
    tournament_id: number | null;
    tournament: string | null;
    match_round: number | null;
    bracket: string | null;
    match_number: number | null;
  }>(
    `SELECT r.match_slug, r.map_number, r.moments, r.clip_path, r.clip_ids, r.created_at, j.map_name,
            t1.name AS team1, t2.name AS team2, m.tournament_id, COALESCE(tr.name, m.played_in) AS tournament,
            m.round AS match_round, m.bracket, m.match_number
       FROM cs2_highlight_reels r
       LEFT JOIN cs2_demo_jobs j ON j.match_slug = r.match_slug AND j.map_number = r.map_number
       LEFT JOIN matches m ON m.slug = r.match_slug
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id
      WHERE r.player_id = ?
      ORDER BY r.created_at DESC
      LIMIT ?`,
    [playerId, limit]
  );
  return Promise.all(
    rows.map(async (r) => ({
      matchSlug: r.match_slug,
      mapNumber: Number(r.map_number),
      map: r.map_name,
      moments: Number(r.moments),
      video: fileUrl(r.clip_path),
      chapters: await chaptersOf(r.clip_ids),
      match: {
        slug: r.match_slug,
        team1: r.team1,
        team2: r.team2,
        tournamentId: r.tournament_id === null ? null : Number(r.tournament_id),
        tournament: r.tournament,
        round: r.match_round === null ? null : Number(r.match_round),
        bracket: r.bracket,
        matchNumber: r.match_number === null ? null : Number(r.match_number),
      } satisfies MatchRef,
      createdAt: Number(r.created_at),
    }))
  );
}

export async function favouriteOf(playerId: string): Promise<number | null> {
  const row = await db.queryOneAsync<{ highlight_id: number }>(
    'SELECT highlight_id FROM cs2_highlight_favourites WHERE player_id = ?',
    [playerId]
  );
  return row ? Number(row.highlight_id) : null;
}

/** Pick (or with null, drop) the player's favourite; false when it is not one of their recorded highlights. */
export async function setFavourite(playerId: string, highlightId: number | null): Promise<boolean> {
  if (highlightId === null) {
    await db.runAsync('DELETE FROM cs2_highlight_favourites WHERE player_id = ?', [playerId]);
    return true;
  }
  const own = await db.queryOneAsync<{ id: number }>(
    "SELECT id FROM cs2_highlights WHERE id = ? AND player_id = ? AND status = 'done'",
    [highlightId, playerId]
  );
  if (!own) return false;
  await db.runAsync(
    `INSERT INTO cs2_highlight_favourites (player_id, highlight_id) VALUES (?, ?)
     ON CONFLICT (player_id) DO UPDATE SET highlight_id = EXCLUDED.highlight_id,
       set_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
    [playerId, highlightId]
  );
  return true;
}

// ---------------------------------------------------------------------------
// A tournament's
// ---------------------------------------------------------------------------

export async function tournamentReel(tournamentId: number) {
  const row = await db.queryOneAsync<{ status: string; clip_ids: string | null; clip_path: string | null }>(
    'SELECT status, clip_ids, clip_path FROM cs2_tournament_reels WHERE tournament_id = ?',
    [tournamentId]
  );
  if (!row) return null;
  const done = row.status === 'done' && !!row.clip_path;
  const chapters = done ? await chaptersOf(row.clip_ids) : [];
  const last = chapters[chapters.length - 1];
  const lastClip = last ? await clipView(last.highlightId) : null;
  return {
    status: row.status,
    video: done ? fileUrl(row.clip_path!) : null,
    chapters,
    duration: last && last.at !== null && lastClip?.markers ? last.at + lastClip.markers.duration : null,
  };
}

/** A tournament's highlights: its reel, its best plays and each match's reels. */
export async function tournamentHighlights(tournamentId: number) {
  const plays = (
    await db.queryAsync<ClipRow>(
      `${CLIP_SELECT}
        WHERE m.tournament_id = ? AND h.status = 'done'
        ORDER BY h.score DESC, h.id
        LIMIT 60`,
      [tournamentId]
    )
  ).map(toClip);

  const reels = await db.queryAsync<{
    match_slug: string;
    map_number: number;
    status: string;
    clips: number | null;
    clip_path: string | null;
    map_name: string | null;
  }>(
    `SELECT r.match_slug, r.map_number, r.status, r.clips, r.clip_path, j.map_name
       FROM cs2_match_reels r
       JOIN matches m ON m.slug = r.match_slug
       LEFT JOIN cs2_demo_jobs j ON j.match_slug = r.match_slug AND j.map_number = r.map_number
      WHERE m.tournament_id = ?
      ORDER BY r.map_number`,
    [tournamentId]
  );
  // Every match with highlights, and how far its recording got.
  const matches = await db.queryAsync<{
    slug: string;
    team1: string | null;
    team2: string | null;
    round: number;
    bracket: string | null;
    match_number: number;
    done: number | string;
    total: number | string;
  }>(
    `SELECT m.slug, t1.name AS team1, t2.name AS team2, m.round, m.bracket, m.match_number,
            COUNT(DISTINCT h.player_id) FILTER (WHERE h.status = 'done') AS done,
            COUNT(DISTINCT h.player_id) FILTER (WHERE h.status IN ('done', 'pending', 'recording')) AS total
       FROM matches m
       JOIN cs2_highlights h ON h.match_slug = m.slug
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
      WHERE m.tournament_id = ?
      GROUP BY m.slug, t1.name, t2.name, m.round, m.bracket, m.match_number
      ORDER BY m.round DESC, m.match_number`,
    [tournamentId]
  );
  return {
    reel: await tournamentReel(tournamentId),
    plays,
    matches: matches.map((m) => {
      const own = reels.filter((r) => r.match_slug === m.slug);
      // Still recording: a player's highlights are waiting, or a map's reel is.
      const waiting = Number(m.done) < Number(m.total) || own.some((r) => r.status === 'pending' || r.status === 'recording');
      return {
        slug: m.slug,
        team1: m.team1,
        team2: m.team2,
        round: Number(m.round),
        bracket: m.bracket,
        matchNumber: Number(m.match_number),
        playersDone: Number(m.done),
        playersTotal: Number(m.total),
        recording: waiting,
        reels: own.map((r) => ({
          mapNumber: Number(r.map_number),
          map: r.map_name,
          status: r.status,
          clips: r.clips === null ? null : Number(r.clips),
          video: r.status === 'done' && r.clip_path ? fileUrl(r.clip_path) : null,
        })),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// One video to watch
// ---------------------------------------------------------------------------

export async function playerReelView(matchSlug: string, mapNumber: number, playerId: string) {
  const reels = await playerReelViews(playerId, 200);
  const reel = reels.find((r) => r.matchSlug === matchSlug && r.mapNumber === mapNumber);
  if (!reel) return null;
  const player = await db.queryOneAsync<{ name: string | null }>('SELECT name FROM players WHERE id = ?', [playerId]);
  return { ...reel, playerId, playerName: player?.name ?? playerId };
}

export async function matchReelView(matchSlug: string, mapNumber: number) {
  const row = await db.queryOneAsync<{
    status: string;
    clip_path: string | null;
    clip_ids: string | null;
    map_name: string | null;
    team1: string | null;
    team2: string | null;
    tournament_id: number | null;
    tournament: string | null;
    round: number | null;
    bracket: string | null;
    match_number: number | null;
  }>(
    `SELECT r.status, r.clip_path, r.clip_ids, j.map_name, t1.name AS team1, t2.name AS team2, m.tournament_id,
            COALESCE(tr.name, m.played_in) AS tournament, m.round, m.bracket, m.match_number
       FROM cs2_match_reels r
       LEFT JOIN cs2_demo_jobs j ON j.match_slug = r.match_slug AND j.map_number = r.map_number
       LEFT JOIN matches m ON m.slug = r.match_slug
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id
      WHERE r.match_slug = ? AND r.map_number = ?`,
    [matchSlug, mapNumber]
  );
  if (!row || row.status !== 'done' || !row.clip_path) return null;
  return {
    matchSlug,
    mapNumber,
    map: row.map_name,
    video: fileUrl(row.clip_path),
    chapters: await chaptersOf(row.clip_ids),
    match: {
      slug: matchSlug,
      team1: row.team1,
      team2: row.team2,
      tournamentId: row.tournament_id === null ? null : Number(row.tournament_id),
      tournament: row.tournament,
      round: row.round === null ? null : Number(row.round),
      bracket: row.bracket,
      matchNumber: row.match_number === null ? null : Number(row.match_number),
    } satisfies MatchRef,
  };
}

// ---------------------------------------------------------------------------
// The tournament reel
// ---------------------------------------------------------------------------

export interface ReelCandidate {
  id: number;
  playerId: string;
  kind: string;
  clutch: boolean;
  score: number;
}

/** The most clips a tournament reel joins, and of one player. */
const REEL_MAX = 16;
const REEL_PER_PLAYER = 3;

/**
 * The tournament reel's plays, in the order they show (pure: tested on its
 * own). Every ace; then the best 4Ks, clutches, flair (one-taps, wallbangs,
 * through smoke) and two funny ones; filled up with the best of the rest. No
 * player more than three times, aces aside. It builds up: the smaller plays
 * first, the funny ones a third and two thirds in, the best play last.
 */
export function pickTournamentReel(candidates: ReelCandidate[]): number[] {
  const byScore = candidates.slice().sort((a, b) => b.score - a.score || a.id - b.id);
  const chosen: ReelCandidate[] = [];
  const perPlayer = new Map<string, number>();
  const take = (c: ReelCandidate, capped = true) => {
    if (chosen.length >= REEL_MAX || chosen.includes(c)) return;
    if (capped && (perPlayer.get(c.playerId) ?? 0) >= REEL_PER_PLAYER) return;
    chosen.push(c);
    perPlayer.set(c.playerId, (perPlayer.get(c.playerId) ?? 0) + 1);
  };
  const of = (pick: (c: ReelCandidate) => boolean, n: number) => {
    let left = n;
    for (const c of byScore) {
      if (left <= 0) break;
      if (!pick(c) || chosen.includes(c)) continue;
      const before = chosen.length;
      take(c);
      if (chosen.length > before) left--;
    }
  };
  for (const c of byScore.filter((c) => c.kind === 'ace')) take(c, false);
  of((c) => c.kind === '4k', 4);
  of((c) => c.clutch, 3);
  of((c) => c.kind === 'flair', 2);
  of((c) => c.kind === 'funny', 2);
  of((c) => c.kind !== 'funny', REEL_MAX);

  const funny = chosen.filter((c) => c.kind === 'funny');
  const rest = chosen.filter((c) => c.kind !== 'funny').sort((a, b) => a.score - b.score || a.id - b.id);
  funny.forEach((c, i) => {
    const at = Math.round(((i + 1) * rest.length) / (funny.length + 1));
    rest.splice(Math.min(at, Math.max(0, rest.length - 1)), 0, c);
  });
  return rest.map((c) => c.id);
}

/** Queue the reel of a tournament that is over, once everything of it is recorded. */
async function queueTournamentReel(): Promise<void> {
  await db.runAsync(
    `INSERT INTO cs2_tournament_reels (tournament_id)
     SELECT t.id FROM tournament t
      WHERE t.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM cs2_tournament_reels r WHERE r.tournament_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM cs2_demo_jobs j JOIN matches m ON m.slug = j.match_slug
                         WHERE m.tournament_id = t.id AND j.status IN ('pending', 'running'))
        AND NOT EXISTS (SELECT 1 FROM cs2_highlights h JOIN matches m ON m.slug = h.match_slug
                         WHERE m.tournament_id = t.id AND h.status IN ('pending', 'recording'))
        AND (SELECT COUNT(*) FROM cs2_highlights h JOIN matches m ON m.slug = h.match_slug
              WHERE m.tournament_id = t.id AND h.status = 'done') >= ?
     ON CONFLICT (tournament_id) DO NOTHING`,
    [TOURNAMENT_REEL_MIN]
  );
}

export interface TournamentReelJob {
  kind: 'tournament_reel';
  tournamentId: number;
  match: string;
  watermark: boolean;
  clips: MatchReelClip[];
  /** Where the recorder sends the reel, and where it says it could not. */
  upload: string;
  fail: string;
}

/** Hand the recorder a tournament reel to join, if one is due. */
export async function claimTournamentReel(recorder: string): Promise<TournamentReelJob | null> {
  await queueTournamentReel();
  const now = Math.floor(Date.now() / 1000);
  const row = await db.queryOneAsync<{ tournament_id: number }>(
    `UPDATE cs2_tournament_reels SET status = 'recording', recorder = ?, claimed_at = ?, attempts = attempts + 1
      WHERE tournament_id = (
        SELECT tournament_id FROM cs2_tournament_reels
         WHERE status = 'pending' OR (status = 'recording' AND claimed_at < ?)
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING tournament_id`,
    [recorder.slice(0, 120), now, now - STALE_SECONDS]
  );
  if (!row) return null;
  const tournamentId = Number(row.tournament_id);
  const rows = await db.queryAsync<ClipRow>(
    `${CLIP_SELECT} WHERE m.tournament_id = ? AND h.status = 'done'`,
    [tournamentId]
  );
  const clips = rows.map(toClip);
  const ids = pickTournamentReel(clips);
  const byId = new Map(clips.map((c) => [c.id, c]));
  const name = clips[0]?.match.tournament ?? null;
  const { settingsService } = await import('../../../services/settingsService');
  return {
    kind: 'tournament_reel',
    tournamentId,
    match: name ?? '',
    watermark: (await settingsService.getSetting('highlights_watermark'))?.trim() !== '0',
    clips: ids.map((id) => {
      const c = byId.get(id)!;
      return {
        highlightId: c.id,
        playerId: c.playerId,
        playerName: c.playerName,
        // The tag's second line: whose match it was.
        team: matchLine(c.match.team1, c.match.team2, null) || null,
        avatarUrl: c.avatarUrl,
        title: c.title,
        url: c.video!,
      };
    }),
    upload: `/api/game/cs2/recorder/tournament-reels/${tournamentId}`,
    fail: `/api/game/cs2/recorder/tournament-reels/${tournamentId}/fail`,
  };
}

export function tournamentReelFile(tournamentId: number): string {
  return path.join(HIGHLIGHTS_DIR, `tournament-${tournamentId}.mp4`);
}

export async function saveTournamentReel(
  tournamentId: number,
  body: NodeJS.ReadableStream,
  clipIds: number[] | null
): Promise<number> {
  await fs.promises.mkdir(HIGHLIGHTS_DIR, { recursive: true });
  const file = tournamentReelFile(tournamentId);
  const tmp = `${file}.part`;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    body.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);
    body.on('error', reject);
  });
  const { size } = await fs.promises.stat(tmp);
  await fs.promises.rename(tmp, file);
  await db.runAsync(
    `INSERT INTO cs2_tournament_reels (tournament_id, status, clip_ids, clip_path, clip_bytes)
     VALUES (?, 'done', ?, ?, ?)
     ON CONFLICT (tournament_id) DO UPDATE SET status = 'done', error = NULL,
       clip_ids = EXCLUDED.clip_ids, clip_path = EXCLUDED.clip_path, clip_bytes = EXCLUDED.clip_bytes`,
    [tournamentId, clipIds ? JSON.stringify(clipIds) : null, path.basename(file), size]
  );
  return size;
}

export async function failTournamentReel(tournamentId: number, error: string): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_tournament_reels SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, error = ?
      WHERE tournament_id = ? AND status = 'recording'`,
    [MAX_ATTEMPTS, error.slice(0, 500), tournamentId]
  );
}
