/**
 * Highlights: each player's best moments of a map, picked from its analysis
 * (./jobs.ts), and the clip the recorder (worker/, `at-worker record`) makes
 * of each.
 *
 * A moment is a run of one player's kills in one round with at most 10 s
 * between them. It scores by kill count (an ace far above a double), a
 * clutch (the last of their side alive against two or more, and the round
 * won), and flair
 * (wallbangs, through smoke, headshots, the round's opening kill). The best
 * six per player per map are kept, if they score at all: each is a clip of
 * its own, and the recorder joins them into the player's reel of the map.
 *
 * The clip runs from 3 s before the first kill to 1.5 s after the last,
 * at most 10 s; its slow motion lands on the last kill.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../../config/dataDir';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import type { DemoAnalysisPayload } from './jobs';

export const HIGHLIGHTS_DIR = path.join(DATA_DIR, 'highlights');

const TICKRATE = 64;
const GAP_TICKS = 10 * TICKRATE;
const LEAD_TICKS = 3 * TICKRATE;
const TAIL_TICKS = Math.round(1.5 * TICKRATE);
const MAX_TICKS = 10 * TICKRATE;
const PER_PLAYER = 6;
/** Below this a moment isn't worth a clip (a plain single kill scores 10). */
const MIN_SCORE = 30;
const MULTI_BONUS = [0, 0, 25, 60, 120, 250];
/** A recording that went quiet this long is handed out again. */
const STALE_SECONDS = 30 * 60;
const MAX_ATTEMPTS = 3;

interface KillRow {
  tick: number;
  round: number;
  attacker: string | null;
  victim: string;
  weapon?: string;
  headshot?: boolean;
  penetrated?: boolean;
  throughSmoke?: boolean;
  attackerSide?: string | null;
  victimSide?: string | null;
  opening?: boolean;
}

export interface Moment {
  playerId: string;
  kind: string;
  score: number;
  round: number;
  startTick: number;
  endTick: number;
  slowmoTick: number;
  killTicks: number[];
  title: string;
}

/** Pick the best moments of a map (pure: tested on its own). */
export function pickMoments(analysis: Pick<DemoAnalysisPayload, 'kills' | 'rounds'>): Moment[] {
  const kills = (analysis.kills as unknown as KillRow[])
    .filter((k) => k.attacker && k.attackerSide && k.attackerSide !== k.victimSide)
    .sort((a, b) => a.tick - b.tick);
  const all = (analysis.kills as unknown as KillRow[]).slice().sort((a, b) => a.tick - b.tick);
  const roundEnd = new Map(analysis.rounds.map((r) => [r.number, r.endTick]));

  // Runs of one player's kills in one round, gaps of at most 10 s.
  const runs: KillRow[][] = [];
  const open = new Map<string, KillRow[]>();
  for (const k of kills) {
    const key = `${k.attacker}:${k.round}`;
    const run = open.get(key);
    if (run && k.tick - run[run.length - 1]!.tick <= GAP_TICKS) run.push(k);
    else {
      const fresh = [k];
      runs.push(fresh);
      open.set(key, fresh);
    }
  }

  const moments: Moment[] = runs.map((run) => {
    const player = run[0]!.attacker!;
    const side = run[0]!.attackerSide;
    const first = run[0]!.tick;
    const last = run[run.length - 1]!.tick;
    let score = run.length * 10 + (MULTI_BONUS[Math.min(run.length, 5)] ?? 0);
    for (const k of run) {
      if (k.headshot) score += 5;
      if (k.penetrated) score += 15;
      if (k.throughSmoke) score += 15;
      if (k.opening) score += 5;
    }
    // Clutch: before the run, everyone else on their side in this round died,
    // and two or more enemies were still up.
    const inRound = all.filter((k) => k.round === run[0]!.round);
    const before = inRound.filter((k) => k.tick < first);
    const sideDead = new Set(before.filter((k) => k.victimSide === side).map((k) => k.victim));
    const mates = new Set(
      inRound
        .flatMap((k) => [
          k.attackerSide === side ? k.attacker : null,
          k.victimSide === side ? k.victim : null,
        ])
        .filter((id): id is string => !!id && id !== player)
    );
    const enemiesSeen = new Set(
      inRound
        .flatMap((k) => [
          k.attackerSide && k.attackerSide !== side ? k.attacker : null,
          k.victimSide && k.victimSide !== side ? k.victim : null,
        ])
        .filter((id): id is string => !!id)
    );
    const enemiesDownBefore = new Set(
      before.filter((k) => k.victimSide !== side).map((k) => k.victim)
    );
    const won = analysis.rounds.find((r) => r.number === run[0]!.round)?.winner === side;
    const clutch =
      won &&
      mates.size > 0 &&
      [...mates].every((m) => sideDead.has(m)) &&
      enemiesSeen.size - enemiesDownBefore.size >= 2;
    if (clutch) score += 40 * run.length;

    const n = run.length;
    const kind = n >= 5 ? 'ace' : n >= 2 ? `${n}k` : clutch ? 'clutch' : 'flair';
    const end = Math.min(last + TAIL_TICKS, roundEnd.get(run[0]!.round) ?? last + TAIL_TICKS);
    const start = Math.max(first - LEAD_TICKS, end - MAX_TICKS);
    const weapons = [...new Set(run.map((k) => k.weapon).filter(Boolean))].slice(0, 2).join(' / ');
    return {
      playerId: player,
      kind,
      score,
      round: run[0]!.round,
      startTick: start,
      endTick: end,
      slowmoTick: last,
      killTicks: run.map((k) => k.tick),
      title: `${n === 5 ? 'Ace' : `${n} kill${n === 1 ? '' : 's'}`}${clutch ? ' clutch' : ''}${weapons ? ` · ${weapons}` : ''} · round ${run[0]!.round}`,
    };
  });

  // The best six per player that score enough.
  const byPlayer = new Map<string, Moment[]>();
  for (const m of moments.filter((m) => m.score >= MIN_SCORE).sort((a, b) => b.score - a.score)) {
    const list = byPlayer.get(m.playerId) ?? [];
    if (list.length < PER_PLAYER) list.push(m);
    byPlayer.set(m.playerId, list);
  }
  return [...byPlayer.values()].flat();
}

/** Replace a map's not-yet-recorded highlights with a fresh pick. */
export async function saveMoments(
  matchSlug: string,
  mapNumber: number,
  moments: Moment[]
): Promise<void> {
  try {
    await db.runAsync(
      "DELETE FROM cs2_highlights WHERE match_slug = ? AND map_number = ? AND status IN ('pending', 'failed', 'skipped')",
      [matchSlug, mapNumber]
    );
    for (const m of moments) {
      await db.runAsync(
        `INSERT INTO cs2_highlights (match_slug, map_number, player_id, kind, score, round, start_tick, end_tick,
                                     slowmo_tick, kill_ticks, title)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (match_slug, map_number, player_id, start_tick) DO NOTHING`,
        [
          matchSlug,
          mapNumber,
          m.playerId,
          m.kind,
          m.score,
          m.round,
          m.startTick,
          m.endTick,
          m.slowmoTick,
          JSON.stringify(m.killTicks),
          m.title,
        ]
      );
    }
  } catch (error) {
    log.warn(`[HIGHLIGHTS] Could not save the moments of ${matchSlug} map ${mapNumber}`, {
      error: (error as Error).message,
    });
  }
}

export interface RecordMoment {
  id: number;
  kind: string;
  title: string;
  round: number;
  score: number;
  startTick: number;
  endTick: number;
  slowmoTick: number;
  killTicks: number[];
}

/** One player's moments on one map: the recorder plays the demo once for them. */
export interface RecordJob {
  matchSlug: string;
  mapNumber: number;
  mapName: string | null;
  playerId: string;
  playerName: string;
  /** The caption's match line: "Team A vs Team B · Tournament". */
  match: string;
  /** The player's avatar (absolute, or a path on this platform), for the caption. */
  avatarUrl: string | null;
  /** The Auto Tournament logo on each video (an admin can turn it off). */
  watermark: boolean;
  moments: RecordMoment[];
}

interface MomentRow {
  id: number;
  match_slug: string;
  map_number: number;
  player_id: string;
  kind: string;
  title: string;
  round: number;
  score: number;
  start_tick: number;
  end_tick: number;
  slowmo_tick: number;
  kill_ticks: string;
}

/** "Team A vs Team B · Tournament", with what is known of it. */
export function matchLine(team1: string | null, team2: string | null, tournament: string | null): string {
  const teams = team1 && team2 ? `${team1} vs ${team2}` : (team1 ?? team2 ?? '');
  return [teams, tournament ?? ''].filter(Boolean).join(' · ');
}

/**
 * Hand the recorder the player and map with the best moment not yet
 * recorded, with all of that player's moments there that are still waiting.
 */
export async function claimRecordJob(recorder: string): Promise<RecordJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const waiting = "(status = 'pending' OR (status = 'recording' AND claimed_at < ?))";
  const best = await db.queryOneAsync<{ match_slug: string; map_number: number; player_id: string }>(
    `SELECT match_slug, map_number, player_id FROM cs2_highlights
      WHERE ${waiting} ORDER BY score DESC, id LIMIT 1`,
    [now - STALE_SECONDS]
  );
  if (!best) return null;
  const rows = await db.queryAsync<MomentRow>(
    `UPDATE cs2_highlights SET status = 'recording', recorder = ?, claimed_at = ?, attempts = attempts + 1
      WHERE id IN (SELECT id FROM cs2_highlights
                    WHERE match_slug = ? AND map_number = ? AND player_id = ? AND ${waiting}
                    FOR UPDATE SKIP LOCKED)
      RETURNING id, match_slug, map_number, player_id, kind, title, round, score, start_tick, end_tick, slowmo_tick, kill_ticks`,
    [recorder.slice(0, 120), now, best.match_slug, best.map_number, best.player_id, now - STALE_SECONDS]
  );
  if (rows.length === 0) return null; // another recorder took them first
  const extra = await db.queryOneAsync<{
    map_name: string | null;
    name: string | null;
    avatar_url: string | null;
    team1: string | null;
    team2: string | null;
    tournament: string | null;
  }>(
    `SELECT (SELECT map_name FROM cs2_demo_jobs WHERE match_slug = ? AND map_number = ?) AS map_name,
            (SELECT name FROM players WHERE id = ?) AS name,
            (SELECT avatar_url FROM players WHERE id = ?) AS avatar_url,
            t1.name AS team1, t2.name AS team2, COALESCE(tr.name, m.played_in) AS tournament
       FROM (SELECT 1) one
       LEFT JOIN matches m ON m.slug = ?
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id`,
    [best.match_slug, best.map_number, best.player_id, best.player_id, best.match_slug]
  );
  const { settingsService } = await import('../../../services/settingsService');
  const watermark = (await settingsService.getSetting('highlights_watermark'))?.trim() !== '0';
  return {
    matchSlug: best.match_slug,
    mapNumber: Number(best.map_number),
    mapName: extra?.map_name ?? null,
    playerId: best.player_id,
    playerName: extra?.name ?? best.player_id,
    avatarUrl: extra?.avatar_url ?? null,
    match: matchLine(extra?.team1 ?? null, extra?.team2 ?? null, extra?.tournament ?? null),
    watermark,
    moments: rows
      .map((r) => ({
        id: Number(r.id),
        kind: r.kind,
        title: r.title,
        round: Number(r.round),
        score: Number(r.score),
        startTick: Number(r.start_tick),
        endTick: Number(r.end_tick),
        slowmoTick: Number(r.slowmo_tick),
        killTicks: JSON.parse(r.kill_ticks) as number[],
      }))
      .sort((a, b) => a.startTick - b.startTick),
  };
}

export function clipFile(id: number): string {
  return path.join(HIGHLIGHTS_DIR, `${id}.mp4`);
}

/** Store a finished clip (an MP4 the recorder streamed up). */
export async function saveClip(id: number, body: NodeJS.ReadableStream): Promise<number> {
  await fs.promises.mkdir(HIGHLIGHTS_DIR, { recursive: true });
  const file = clipFile(id);
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
    "UPDATE cs2_highlights SET status = 'done', clip_path = ?, clip_bytes = ?, error = NULL WHERE id = ?",
    [path.basename(file), size, id]
  );
  await queueMatchReelFor([id]);
  return size;
}

/** The recorder could not record these moments: try again later, up to MAX_ATTEMPTS. */
export async function failRecordJob(ids: number[], error: string): Promise<void> {
  if (ids.length === 0) return;
  await db.runAsync(
    `UPDATE cs2_highlights SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, error = ?
      WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'recording'`,
    [MAX_ATTEMPTS, error.slice(0, 500), ...ids]
  );
  await queueMatchReelFor(ids);
}

export function reelFile(matchSlug: string, mapNumber: number, playerId: string): string {
  const safe = `${matchSlug}-${mapNumber}-${playerId}`.replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(HIGHLIGHTS_DIR, `reel-${safe}.mp4`);
}

/** Store a player's reel of a map (an MP4 the recorder streamed up). */
export async function saveReel(
  matchSlug: string,
  mapNumber: number,
  playerId: string,
  body: NodeJS.ReadableStream
): Promise<number> {
  await fs.promises.mkdir(HIGHLIGHTS_DIR, { recursive: true });
  const file = reelFile(matchSlug, mapNumber, playerId);
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
  const moments = await db.queryOneAsync<{ n: number | string }>(
    "SELECT COUNT(*) AS n FROM cs2_highlights WHERE match_slug = ? AND map_number = ? AND player_id = ? AND status = 'done'",
    [matchSlug, mapNumber, playerId]
  );
  await db.runAsync(
    `INSERT INTO cs2_highlight_reels (match_slug, map_number, player_id, moments, clip_path, clip_bytes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (match_slug, map_number, player_id) DO UPDATE SET
       moments = EXCLUDED.moments, clip_path = EXCLUDED.clip_path, clip_bytes = EXCLUDED.clip_bytes,
       created_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
    [matchSlug, mapNumber, playerId, Number(moments?.n ?? 0), path.basename(file), size]
  );
  return size;
}

/** A player's finished highlights, best first, for their profile. */
export async function playerHighlights(playerId: string) {
  const rows = await db.queryAsync<{
    id: number;
    match_slug: string;
    map_number: number;
    kind: string;
    title: string;
    score: number;
    status: string;
    created_at: number;
    map_name: string | null;
  }>(
    `SELECT h.id, h.match_slug, h.map_number, h.kind, h.title, h.score, h.status, h.created_at, j.map_name
       FROM cs2_highlights h
       LEFT JOIN cs2_demo_jobs j ON j.match_slug = h.match_slug AND j.map_number = h.map_number
      WHERE h.player_id = ? AND h.status IN ('done', 'pending', 'recording')
      ORDER BY (h.status = 'done') DESC, h.score DESC, h.id DESC
      LIMIT 24`,
    [playerId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    matchSlug: r.match_slug,
    mapNumber: Number(r.map_number),
    map: r.map_name,
    kind: r.kind,
    title: r.title,
    score: Number(r.score),
    status: r.status,
    video: r.status === 'done' ? `/api/game/cs2/highlights/${r.id}.mp4` : null,
    createdAt: Number(r.created_at),
  }));
}

/** A player's reels, newest first, for their profile. */
export async function playerReels(playerId: string) {
  const rows = await db.queryAsync<{
    match_slug: string;
    map_number: number;
    moments: number;
    clip_path: string;
    created_at: number;
    map_name: string | null;
  }>(
    `SELECT r.match_slug, r.map_number, r.moments, r.clip_path, r.created_at, j.map_name
       FROM cs2_highlight_reels r
       LEFT JOIN cs2_demo_jobs j ON j.match_slug = r.match_slug AND j.map_number = r.map_number
      WHERE r.player_id = ?
      ORDER BY r.created_at DESC
      LIMIT 12`,
    [playerId]
  );
  return rows.map((r) => ({
    matchSlug: r.match_slug,
    mapNumber: Number(r.map_number),
    map: r.map_name,
    moments: Number(r.moments),
    video: `/api/game/cs2/highlights/${encodeURIComponent(r.clip_path)}`,
    createdAt: Number(r.created_at),
  }));
}

// ---------------------------------------------------------------------------
// Match reels: each player's best highlight of a map, one after the other
// ---------------------------------------------------------------------------

/** A match reel needs this many players with a recorded highlight. */
const MATCH_REEL_MIN_PLAYERS = 2;

/**
 * Queue the match reel of each map these highlights belong to, once none of
 * the map's highlights is still waiting to be recorded.
 */
export async function queueMatchReelFor(highlightIds: number[]): Promise<void> {
  if (highlightIds.length === 0) return;
  try {
    const maps = await db.queryAsync<{ match_slug: string; map_number: number }>(
      `SELECT DISTINCT match_slug, map_number FROM cs2_highlights
        WHERE id IN (${highlightIds.map(() => '?').join(', ')})`,
      highlightIds
    );
    for (const m of maps) {
      const state = await db.queryOneAsync<{ waiting: number | string; players: number | string }>(
        `SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'recording')) AS waiting,
                COUNT(DISTINCT player_id) FILTER (WHERE status = 'done') AS players
           FROM cs2_highlights WHERE match_slug = ? AND map_number = ?`,
        [m.match_slug, m.map_number]
      );
      if (Number(state?.waiting ?? 1) > 0 || Number(state?.players ?? 0) < MATCH_REEL_MIN_PLAYERS) continue;
      await db.runAsync(
        `INSERT INTO cs2_match_reels (match_slug, map_number) VALUES (?, ?)
         ON CONFLICT (match_slug, map_number) DO UPDATE SET status = 'pending', attempts = 0, error = NULL
           WHERE cs2_match_reels.status IN ('failed')`,
        [m.match_slug, m.map_number]
      );
    }
  } catch (error) {
    log.warn('[HIGHLIGHTS] Could not queue a match reel', { error: (error as Error).message });
  }
}

export interface MatchReelClip {
  highlightId: number;
  playerId: string;
  playerName: string;
  team: string | null;
  avatarUrl: string | null;
  title: string;
  /** Where the recorder downloads it from (this platform). */
  url: string;
}

export interface MatchReelJob {
  kind: 'match_reel';
  matchSlug: string;
  mapNumber: number;
  match: string;
  watermark: boolean;
  clips: MatchReelClip[];
}

/** Each player's best recorded highlight of a map, in the order they happened. */
export async function bestClipPerPlayer(matchSlug: string, mapNumber: number): Promise<MatchReelClip[]> {
  const rows = await db.queryAsync<{
    id: number;
    player_id: string;
    title: string;
    slowmo_tick: number;
    name: string | null;
    avatar_url: string | null;
    team: string | null;
  }>(
    `SELECT b.id, b.player_id, b.title, b.slowmo_tick, p.name, p.avatar_url,
            (SELECT t.name FROM matches m JOIN teams t ON t.id IN (m.team1_id, m.team2_id)
              WHERE m.slug = b.match_slug
                AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.players::jsonb) e WHERE e->>'steamId' = b.player_id)
              LIMIT 1) AS team
       FROM (SELECT DISTINCT ON (player_id) id, player_id, title, slowmo_tick, match_slug
               FROM cs2_highlights
              WHERE match_slug = ? AND map_number = ? AND status = 'done'
              ORDER BY player_id, score DESC, id) b
       LEFT JOIN players p ON p.id = b.player_id
      ORDER BY b.slowmo_tick`,
    [matchSlug, mapNumber]
  );
  return rows.map((r) => ({
    highlightId: Number(r.id),
    playerId: r.player_id,
    playerName: r.name ?? r.player_id,
    team: r.team,
    avatarUrl: r.avatar_url,
    title: r.title,
    url: `/api/game/cs2/highlights/${Number(r.id)}.mp4`,
  }));
}

/** Hand the recorder a match reel to join, if one is waiting. */
export async function claimMatchReel(recorder: string): Promise<MatchReelJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.queryOneAsync<{ match_slug: string; map_number: number }>(
    `UPDATE cs2_match_reels SET status = 'recording', recorder = ?, claimed_at = ?, attempts = attempts + 1
      WHERE (match_slug, map_number) = (
        SELECT match_slug, map_number FROM cs2_match_reels
         WHERE status = 'pending' OR (status = 'recording' AND claimed_at < ?)
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING match_slug, map_number`,
    [recorder.slice(0, 120), now, now - STALE_SECONDS]
  );
  if (!row) return null;
  const clips = await bestClipPerPlayer(row.match_slug, Number(row.map_number));
  const extra = await db.queryOneAsync<{ team1: string | null; team2: string | null; tournament: string | null }>(
    `SELECT t1.name AS team1, t2.name AS team2, COALESCE(tr.name, m.played_in) AS tournament
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id
      WHERE m.slug = ?`,
    [row.match_slug]
  );
  const { settingsService } = await import('../../../services/settingsService');
  return {
    kind: 'match_reel',
    matchSlug: row.match_slug,
    mapNumber: Number(row.map_number),
    match: matchLine(extra?.team1 ?? null, extra?.team2 ?? null, extra?.tournament ?? null),
    watermark: (await settingsService.getSetting('highlights_watermark'))?.trim() !== '0',
    clips,
  };
}

export function matchReelFile(matchSlug: string, mapNumber: number): string {
  const safe = `${matchSlug}-${mapNumber}`.replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(HIGHLIGHTS_DIR, `match-${safe}.mp4`);
}

/** Store a map's match reel (an MP4 the recorder streamed up). */
export async function saveMatchReel(
  matchSlug: string,
  mapNumber: number,
  clips: number,
  body: NodeJS.ReadableStream
): Promise<number> {
  await fs.promises.mkdir(HIGHLIGHTS_DIR, { recursive: true });
  const file = matchReelFile(matchSlug, mapNumber);
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
    `INSERT INTO cs2_match_reels (match_slug, map_number, status, clips, clip_path, clip_bytes)
     VALUES (?, ?, 'done', ?, ?, ?)
     ON CONFLICT (match_slug, map_number) DO UPDATE SET status = 'done', error = NULL,
       clips = EXCLUDED.clips, clip_path = EXCLUDED.clip_path, clip_bytes = EXCLUDED.clip_bytes`,
    [matchSlug, mapNumber, clips, path.basename(file), size]
  );
  return size;
}

export async function failMatchReel(matchSlug: string, mapNumber: number, error: string): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_match_reels SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, error = ?
      WHERE match_slug = ? AND map_number = ? AND status = 'recording'`,
    [MAX_ATTEMPTS, error.slice(0, 500), matchSlug, mapNumber]
  );
}

/** A match's reels per map, and whether each is still being made. */
export async function matchReels(matchSlug: string) {
  const rows = await db.queryAsync<{ map_number: number; status: string; clips: number | null; clip_path: string | null }>(
    'SELECT map_number, status, clips, clip_path FROM cs2_match_reels WHERE match_slug = ? ORDER BY map_number',
    [matchSlug]
  );
  return rows.map((r) => ({
    mapNumber: Number(r.map_number),
    status: r.status,
    clips: r.clips === null ? null : Number(r.clips),
    video: r.status === 'done' && r.clip_path ? `/api/game/cs2/highlights/${encodeURIComponent(r.clip_path)}` : null,
  }));
}
