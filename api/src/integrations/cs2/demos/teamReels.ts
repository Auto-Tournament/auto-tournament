/**
 * Team reels: a team's best plays of a match, for the team to share. Each of
 * its players' best TEAM_REEL_PER_PLAYER recorded highlights across the
 * match's maps, in the order they happened (map by map, round by round),
 * joined by the recorder like a match reel: a fade when the same player
 * plays on, the orange wipe when another takes over.
 *
 * Queued once none of the match's highlights is still waiting to be
 * recorded, and again when a later map's are (a best-of-three fills in).
 */

import fs from 'fs';
import path from 'path';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { readHighlightQuality, type HighlightQuality } from './highlightQuality';
import { chaptersOf } from './highlightViews';
import {
  removeTwins,
  crowdUrlOf,
  HIGHLIGHTS_DIR,
  parseMarkers,
  reelDate,
  type MatchReelClip,
  type ReelIntro,
} from './highlights';

export const TEAM_REEL_PER_PLAYER = 3;
/** A team needs this many players with a recorded play for a reel. */
const TEAM_REEL_MIN_PLAYERS = 2;
const STALE_SECONDS = 30 * 60;
const MAX_ATTEMPTS = 3;

export interface TeamReelJob {
  kind: 'team_reel';
  intro: ReelIntro;
  matchSlug: string;
  teamId: string;
  match: string;
  watermark: boolean;
  quality: HighlightQuality;
  clips: MatchReelClip[];
  upload: string;
  fail: string;
}

/** The SteamID64s on a team's roster (teams.players, JSON). */
function rosterOf(players: string | null): Set<string> {
  try {
    const list = JSON.parse(players ?? '[]') as Array<{ steamId?: string; steam_id?: string }>;
    return new Set(list.map((p) => String(p.steamId ?? p.steam_id ?? '')).filter(Boolean));
  } catch {
    return new Set();
  }
}

interface ClipRow {
  id: number;
  player_id: string;
  title: string;
  score: number;
  map_number: number;
  start_tick: number;
  markers: string | null;
  name: string | null;
  avatar_url: string | null;
}

/** The match's two teams, with their rosters. */
async function teamsOf(matchSlug: string) {
  const rows = await db.queryAsync<{ id: string; name: string; players: string | null }>(
    `SELECT t.id, t.name, t.players FROM matches m
       JOIN teams t ON t.id IN (m.team1_id, m.team2_id)
      WHERE m.slug = ?`,
    [matchSlug]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, roster: rosterOf(r.players) }));
}

/** The team's plays for its reel: each player's best TEAM_REEL_PER_PLAYER, as the match went. */
export async function teamReelClips(
  matchSlug: string,
  teamId: string
): Promise<{ team: string; opponent: string | null; clips: MatchReelClip[] }> {
  const teams = await teamsOf(matchSlug);
  const team = teams.find((t) => t.id === teamId);
  if (!team) return { team: '', opponent: null, clips: [] };
  const rows = await db.queryAsync<ClipRow>(
    `SELECT h.id, h.player_id, h.title, h.score, h.map_number, h.start_tick, h.markers, p.name, p.avatar_url
       FROM cs2_highlights h
       LEFT JOIN players p ON p.id = h.player_id
      WHERE h.match_slug = ? AND h.status = 'done' AND h.kind <> 'funny'`,
    [matchSlug]
  );
  const byPlayer = new Map<string, ClipRow[]>();
  for (const r of rows) {
    if (!team.roster.has(r.player_id)) continue;
    byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  }
  // Each player's best, then all of them as the match went: map by map, round by round.
  const picked = [...byPlayer.values()]
    .flatMap((list) =>
      list.sort((a, b) => Number(b.score) - Number(a.score)).slice(0, TEAM_REEL_PER_PLAYER)
    )
    .sort(
      (a, b) =>
        Number(a.map_number) - Number(b.map_number) || Number(a.start_tick) - Number(b.start_tick)
    );
  const clips = picked.map((r) => ({
    highlightId: Number(r.id),
    playerId: r.player_id,
    playerName: r.name ?? r.player_id,
    team: team.name,
    avatarUrl: r.avatar_url,
    title: r.title,
    url: `/api/game/cs2/highlights/${Number(r.id)}.mp4`,
    markers: parseMarkers(r.markers),
  }));
  return { team: team.name, opponent: teams.find((t) => t.id !== teamId)?.name ?? null, clips };
}

/**
 * Queue (or queue again) the team reels of the matches these highlights
 * belong to, once none of a match's highlights is still waiting.
 */
export async function queueTeamReelsFor(highlightIds: number[]): Promise<void> {
  if (highlightIds.length === 0) return;
  try {
    const matches = await db.queryAsync<{ match_slug: string }>(
      `SELECT DISTINCT match_slug FROM cs2_highlights WHERE id IN (${highlightIds.map(() => '?').join(', ')})`,
      highlightIds
    );
    for (const { match_slug: slug } of matches) {
      const waiting = await db.queryOneAsync<{ n: number | string }>(
        "SELECT COUNT(*) AS n FROM cs2_highlights WHERE match_slug = ? AND status IN ('pending', 'recording')",
        [slug]
      );
      if (Number(waiting?.n ?? 1) > 0) continue;
      for (const team of await teamsOf(slug)) {
        const { clips } = await teamReelClips(slug, team.id);
        if (new Set(clips.map((c) => c.playerId)).size < TEAM_REEL_MIN_PLAYERS) continue;
        const ids = JSON.stringify(clips.map((c) => c.highlightId));
        // Again only when its plays changed (a later map's are in).
        await db.runAsync(
          `INSERT INTO cs2_team_reels (match_slug, team_id) VALUES (?, ?)
           ON CONFLICT (match_slug, team_id) DO UPDATE SET status = 'pending', attempts = 0, error = NULL
             WHERE cs2_team_reels.status = 'failed'
                OR (cs2_team_reels.status = 'done' AND cs2_team_reels.clip_ids IS DISTINCT FROM ?)`,
          [slug, team.id, ids]
        );
      }
    }
  } catch (error) {
    log.warn('[HIGHLIGHTS] Could not queue a team reel', { error: (error as Error).message });
  }
}

export function teamReelFile(matchSlug: string, teamId: string): string {
  const safe = `${matchSlug}-${teamId}`.replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(HIGHLIGHTS_DIR, `team-${safe}.mp4`);
}

/** Hand the recorder a team reel to join, if one is waiting. */
export async function claimTeamReel(recorder: string): Promise<TeamReelJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.queryOneAsync<{ match_slug: string; team_id: string }>(
    `UPDATE cs2_team_reels SET status = 'recording', recorder = ?, claimed_at = ?, attempts = attempts + 1
      WHERE (match_slug, team_id) = (
        SELECT match_slug, team_id FROM cs2_team_reels
         WHERE status = 'pending' OR (status = 'recording' AND claimed_at < ?)
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING match_slug, team_id`,
    [recorder.slice(0, 120), now, now - STALE_SECONDS]
  );
  if (!row) return null;
  const { team, opponent, clips } = await teamReelClips(row.match_slug, row.team_id);
  const extra = await db.queryOneAsync<{
    tournament: string | null;
    maps: string | null;
    played_at: number | string | null;
  }>(
    `SELECT COALESCE(tr.name, m.played_in) AS tournament,
            (SELECT string_agg(j.map_name, ',' ORDER BY j.map_number) FROM cs2_demo_jobs j WHERE j.match_slug = m.slug) AS maps,
            (SELECT MAX(r.completed_at) FROM match_map_results r WHERE r.match_slug = m.slug) AS played_at
       FROM matches m LEFT JOIN tournament tr ON tr.id = m.tournament_id
      WHERE m.slug = ?`,
    [row.match_slug]
  );
  const { settingsService } = await import('../../../services/settingsService');
  const enc = encodeURIComponent;
  return {
    kind: 'team_reel',
    intro: {
      kicker: 'Team highlights',
      title: team || 'Team highlights',
      meta: [opponent ? `vs ${opponent}` : null, extra?.tournament].filter(Boolean).join(' · '),
      // One map shows by name; several are listed in the meta line instead.
      map: extra?.maps && !extra.maps.includes(',') ? extra.maps : '',
      date: reelDate(extra?.played_at ? Number(extra.played_at) : null),
    },
    matchSlug: row.match_slug,
    teamId: row.team_id,
    match: [team, opponent ? `vs ${opponent}` : null].filter(Boolean).join(' '),
    watermark: (await settingsService.getSetting('highlights_watermark'))?.trim() !== '0',
    quality: await readHighlightQuality(),
    clips,
    upload: `/api/game/cs2/recorder/team-reels/${enc(row.match_slug)}/${enc(row.team_id)}`,
    fail: `/api/game/cs2/recorder/team-reels/${enc(row.match_slug)}/${enc(row.team_id)}/fail`,
  };
}

/** Store a team reel (an MP4 the recorder streamed up). */
export async function saveTeamReel(
  matchSlug: string,
  teamId: string,
  body: NodeJS.ReadableStream,
  clipIds: number[] | null,
  clipStarts: number[] | null
): Promise<number> {
  await fs.promises.mkdir(HIGHLIGHTS_DIR, { recursive: true });
  const file = teamReelFile(matchSlug, teamId);
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
  await removeTwins(file);
  await db.runAsync(
    `INSERT INTO cs2_team_reels (match_slug, team_id, status, clips, clip_path, clip_bytes, clip_ids, clip_starts)
     VALUES (?, ?, 'done', ?, ?, ?, ?, ?)
     ON CONFLICT (match_slug, team_id) DO UPDATE SET status = 'done', error = NULL,
       clips = EXCLUDED.clips, clip_path = EXCLUDED.clip_path, clip_bytes = EXCLUDED.clip_bytes,
       clip_ids = EXCLUDED.clip_ids, clip_starts = EXCLUDED.clip_starts`,
    [
      matchSlug,
      teamId,
      clipIds?.length ?? null,
      path.basename(file),
      size,
      clipIds ? JSON.stringify(clipIds) : null,
      clipStarts ? JSON.stringify(clipStarts) : null,
    ]
  );
  return size;
}

export async function failTeamReel(
  matchSlug: string,
  teamId: string,
  error: string
): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_team_reels SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, error = ?
      WHERE match_slug = ? AND team_id = ? AND status = 'recording'`,
    [MAX_ATTEMPTS, error.slice(0, 500), matchSlug, teamId]
  );
}

/** A match's team reels, made or being made, for the match page. */
export async function matchTeamReels(matchSlug: string) {
  const rows = await db.queryAsync<{
    team_id: string;
    name: string | null;
    status: string;
    clips: number | null;
    clip_path: string | null;
  }>(
    `SELECT r.team_id, t.name, r.status, r.clips, r.clip_path
       FROM cs2_team_reels r LEFT JOIN teams t ON t.id = r.team_id
      WHERE r.match_slug = ? ORDER BY t.name`,
    [matchSlug]
  );
  return rows.map((r) => ({
    teamId: r.team_id,
    team: r.name,
    status: r.status,
    clips: r.clips === null ? null : Number(r.clips),
    video:
      r.status === 'done' && r.clip_path
        ? `/api/game/cs2/highlights/${encodeURIComponent(r.clip_path)}`
        : null,
  }));
}

/** One team reel to watch. */
export async function teamReelView(matchSlug: string, teamId: string) {
  const row = await db.queryOneAsync<{
    status: string;
    clip_path: string | null;
    clip_ids: string | null;
    clip_starts: string | null;
    team: string | null;
    team1: string | null;
    team2: string | null;
    tournament_id: number | null;
    tournament: string | null;
    round: number | null;
    bracket: string | null;
    match_number: number | null;
  }>(
    `SELECT r.status, r.clip_path, r.clip_ids, r.clip_starts, t.name AS team, t1.name AS team1, t2.name AS team2,
            m.tournament_id, COALESCE(tr.name, m.played_in) AS tournament, m.round, m.bracket, m.match_number
       FROM cs2_team_reels r
       LEFT JOIN teams t ON t.id = r.team_id
       LEFT JOIN matches m ON m.slug = r.match_slug
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id
      WHERE r.match_slug = ? AND r.team_id = ?`,
    [matchSlug, teamId]
  );
  if (!row || row.status !== 'done' || !row.clip_path) return null;
  return {
    matchSlug,
    teamId,
    team: row.team,
    video: `/api/game/cs2/highlights/${encodeURIComponent(row.clip_path)}`,
    crowd: crowdUrlOf(row.clip_path),
    chapters: await chaptersOf(row.clip_ids, row.clip_starts),
    match: {
      slug: matchSlug,
      team1: row.team1,
      team2: row.team2,
      tournamentId: row.tournament_id === null ? null : Number(row.tournament_id),
      tournament: row.tournament,
      round: row.round === null ? null : Number(row.round),
      bracket: row.bracket,
      matchNumber: row.match_number === null ? null : Number(row.match_number),
    },
  };
}
