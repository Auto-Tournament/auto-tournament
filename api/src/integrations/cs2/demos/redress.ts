/**
 * Redress: the clips dressed again from their clean twins and overlay recipes
 * (worker/overlay.go), without CS2: after a new caption card design, a name
 * fixed, another tournament's tag. Then every reel is made again from the
 * clean clips, with its own overlay. An admin queues it; an idle recorder
 * (version 6) takes the clips in batches, draws the overlay over each and puts
 * the dressed clip back. Once no clip is left, the reels go back to their own
 * queues (match, team and tournament reels) or out as `player_reel` jobs.
 */

import fs from 'fs';
import path from 'path';
import { db } from '../../../config/database';
import { HIGHLIGHTS_DIR, parseMarkers, twinFileOf } from './highlights';

/** How many videos one claim hands out (a clip takes seconds, a reel a minute). */
const BATCH = 25;
/** A batch not back after this long goes out again. */
const STALE_SECONDS = 60 * 60;
const MAX_ATTEMPTS = 3;

/** Only files the recorder named: a clip or a reel, never a path. */
export const REDRESS_FILE =
  /^(?:\d+|(?:reel|match|tournament|team)-[A-Za-z0-9_-][A-Za-z0-9_.-]*?)\.mp4$/;

const CLIP_FILE = /^\d+\.mp4$/;
const REEL_FILE = /^(?:reel|match|tournament|team)-[A-Za-z0-9_-][A-Za-z0-9_.-]*?\.mp4$/;

async function highlightFiles(): Promise<string[]> {
  try {
    return await fs.promises.readdir(HIGHLIGHTS_DIR);
  } catch {
    return [];
  }
}

/** Every clip with a clean twin and a recipe beside it. */
export async function redressable(): Promise<string[]> {
  const names = await highlightFiles();
  const have = new Set(names);
  return names
    .filter((n) => n.endsWith('.overlay.json'))
    .map((n) => n.replace(/\.overlay\.json$/, '.mp4'))
    .filter(
      (v) =>
        CLIP_FILE.test(v) &&
        have.has(v) &&
        have.has(path.basename(twinFileOf(path.join(HIGHLIGHTS_DIR, v), 'clean')))
    );
}

/**
 * Queue the clips for redressing (all of them that can be, by default) and
 * every reel to be made again after them; how many clips.
 */
export async function queueRedress(files?: string[]): Promise<number> {
  const all = await redressable();
  const clips = files ? all.filter((f) => files.includes(f)) : all;
  const reels = clips.length ? (await highlightFiles()).filter((n) => REEL_FILE.test(n)) : [];
  for (const file of [...clips, ...reels]) {
    await db.runAsync(
      `INSERT INTO cs2_redress_queue (file, status, attempts, error, claimed_at) VALUES (?, 'queued', 0, NULL, NULL)
       ON CONFLICT (file) DO UPDATE SET status = 'queued', attempts = 0, error = NULL, claimed_at = NULL`,
      [file]
    );
  }
  return clips.length;
}

export interface RedressJob {
  kind: 'redress';
  files: Array<{ file: string; url: string; upload: string; fail: string }>;
}

/** A player's reel made again from its clips (the recorder joins it like a match reel). */
export interface PlayerReelJob {
  kind: 'player_reel';
  matchSlug: string;
  mapNumber: number;
  match: string;
  watermark: boolean;
  intro: { kicker: string; title: string; meta: string; map: string; date: string };
  clips: Array<{
    highlightId: number;
    playerId: string;
    playerName: string;
    title: string;
    url: string;
    markers: unknown;
  }>;
  upload: string;
  fail: string;
}

/**
 * Work for an idle recorder, or null: a batch of clips while any is left,
 * then the reels made from them.
 */
export async function claimRedress(): Promise<RedressJob | PlayerReelJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const waiting = await db.queryAsync<{ file: string; status: string; claimed_at: number | null }>(
    `SELECT file, status, claimed_at FROM cs2_redress_queue WHERE status IN ('queued', 'working')
      ORDER BY created_at, file`
  );
  const clips = waiting.filter((r) => CLIP_FILE.test(r.file));
  if (clips.length > 0) return claimClips(now);
  // The clips are done: the reels again, from them.
  for (const r of waiting) {
    if (r.status === 'working' && Number(r.claimed_at) >= now - STALE_SECONDS) continue;
    const job = await reelAgain(r.file, now);
    if (job) return job;
  }
  return null;
}

async function claimClips(now: number): Promise<RedressJob | null> {
  const rows = await db.queryAsync<{ file: string }>(
    `SELECT file FROM cs2_redress_queue
      WHERE file ~ '^[0-9]+\\.mp4$' AND (status = 'queued' OR (status = 'working' AND claimed_at < ?))
      ORDER BY created_at, file LIMIT ?`,
    [now - STALE_SECONDS, BATCH]
  );
  if (rows.length === 0) return null;
  const files = rows.map((r) => r.file);
  await db.runAsync(
    `UPDATE cs2_redress_queue SET status = 'working', claimed_at = ?, attempts = attempts + 1
      WHERE file IN (${files.map(() => '?').join(', ')})`,
    [now, ...files]
  );
  return {
    kind: 'redress',
    files: files.map((file) => ({
      file,
      url: `/api/game/cs2/highlights/${encodeURIComponent(file)}`,
      upload: `/api/game/cs2/recorder/redress/${encodeURIComponent(file)}`,
      fail: `/api/game/cs2/recorder/redress/${encodeURIComponent(file)}/fail`,
    })),
  };
}

/**
 * A reel to make again: a match's, team's or tournament's goes back to its
 * own queue (its recorder job reads the clips afresh); a player's goes out as
 * a job of its own. Null when it went back (or is gone).
 */
async function reelAgain(file: string, now: number): Promise<PlayerReelJob | null> {
  const requeue = async (table: string) => {
    await db.runAsync(
      `UPDATE ${table} SET status = 'pending', attempts = 0, error = NULL WHERE clip_path = ?`,
      [file]
    );
    await db.runAsync('DELETE FROM cs2_redress_queue WHERE file = ?', [file]);
    return null;
  };
  if (file.startsWith('match-')) return requeue('cs2_match_reels');
  if (file.startsWith('team-')) return requeue('cs2_team_reels');
  if (file.startsWith('tournament-')) return requeue('cs2_tournament_reels');
  const reel = await db.queryOneAsync<{
    match_slug: string;
    map_number: number;
    player_id: string;
    clip_ids: string | null;
  }>(
    'SELECT match_slug, map_number, player_id, clip_ids FROM cs2_highlight_reels WHERE clip_path = ?',
    [file]
  );
  let ids: number[] = [];
  try {
    ids = reel?.clip_ids ? (JSON.parse(reel.clip_ids) as unknown[]).map(Number) : [];
  } catch {
    ids = [];
  }
  if (!reel || ids.length < 2) {
    await db.runAsync('DELETE FROM cs2_redress_queue WHERE file = ?', [file]);
    return null;
  }
  const rows = await db.queryAsync<{ id: number; title: string; markers: string | null }>(
    `SELECT id, title, markers FROM cs2_highlights
      WHERE id IN (${ids.map(() => '?').join(', ')}) AND status = 'done'`,
    ids
  );
  const clips = ids
    .map((id) => rows.find((r) => Number(r.id) === id))
    .filter((r): r is NonNullable<typeof r> => !!r);
  const extra = await db.queryOneAsync<{
    name: string | null;
    map_name: string | null;
    team1: string | null;
    team2: string | null;
    tournament: string | null;
  }>(
    `SELECT (SELECT name FROM players WHERE id = ?) AS name,
            (SELECT map_name FROM cs2_demo_jobs WHERE match_slug = ? AND map_number = ?) AS map_name,
            t1.name AS team1, t2.name AS team2, COALESCE(tr.name, m.played_in) AS tournament
       FROM (SELECT 1) one
       LEFT JOIN matches m ON m.slug = ?
       LEFT JOIN teams t1 ON t1.id = m.team1_id
       LEFT JOIN teams t2 ON t2.id = m.team2_id
       LEFT JOIN tournament tr ON tr.id = m.tournament_id`,
    [reel.player_id, reel.match_slug, Number(reel.map_number), reel.match_slug]
  );
  await db.runAsync(
    `UPDATE cs2_redress_queue SET status = 'working', claimed_at = ?, attempts = attempts + 1 WHERE file = ?`,
    [now, file]
  );
  const name = extra?.name ?? reel.player_id;
  const teams = [extra?.team1, extra?.team2].filter(Boolean).join(' vs ');
  const { settingsService } = await import('../../../services/settingsService');
  const route = `/api/game/cs2/recorder/reels/${encodeURIComponent(reel.match_slug)}/${Number(reel.map_number)}/${encodeURIComponent(reel.player_id)}`;
  return {
    kind: 'player_reel',
    matchSlug: reel.match_slug,
    mapNumber: Number(reel.map_number),
    match: [teams, extra?.tournament].filter(Boolean).join(' · '),
    watermark: (await settingsService.getSetting('highlights_watermark'))?.trim() !== '0',
    intro: {
      kicker: 'Player reel',
      title: name,
      meta: [`${clips.length} highlights`, teams, extra?.tournament].filter(Boolean).join(' · '),
      map: extra?.map_name ?? '',
      date: new Date().toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    },
    clips: clips.map((c) => ({
      highlightId: Number(c.id),
      playerId: reel.player_id,
      playerName: name,
      title: c.title,
      url: `/api/game/cs2/highlights/${Number(c.id)}.mp4`,
      markers: parseMarkers(c.markers),
    })),
    upload: route,
    fail: `/api/game/cs2/recorder/redress/${encodeURIComponent(file)}/fail`,
  };
}

/** The dressed video back: it replaces the old one; the twins stay. */
export async function saveRedressed(file: string, body: NodeJS.ReadableStream): Promise<number> {
  const target = path.join(HIGHLIGHTS_DIR, file);
  if (!fs.existsSync(target)) throw new Error('No such video');
  const tmp = `${target}.redress.part`;
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    body.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);
    body.on('error', reject);
  });
  const { size } = await fs.promises.stat(tmp);
  await fs.promises.rename(tmp, target);
  // Clips keep their size in the database.
  const clip = /^(\d+)\.mp4$/.exec(file);
  if (clip) {
    await db.runAsync('UPDATE cs2_highlights SET clip_bytes = ? WHERE id = ?', [
      size,
      Number(clip[1]),
    ]);
  }
  await db.runAsync('DELETE FROM cs2_redress_queue WHERE file = ?', [file]);
  return size;
}

/** The recorder could not redress it: again later, a few times. */
export async function failRedress(file: string, error: string): Promise<void> {
  await db.runAsync(
    `UPDATE cs2_redress_queue SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END,
       error = ?, claimed_at = NULL WHERE file = ?`,
    [MAX_ATTEMPTS, error.slice(0, 500), file]
  );
}

/** How the queue stands, for the admin. */
export async function redressStatus(): Promise<{
  queued: number;
  working: number;
  failed: number;
  available: number;
}> {
  const rows = await db.queryAsync<{ status: string; n: number | string }>(
    'SELECT status, COUNT(*) AS n FROM cs2_redress_queue GROUP BY status'
  );
  const count = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  return {
    queued: count('queued'),
    working: count('working'),
    failed: count('failed'),
    available: (await redressable()).length,
  };
}
