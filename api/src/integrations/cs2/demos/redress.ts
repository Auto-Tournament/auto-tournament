/**
 * Redress: a clip or reel dressed again from its clean twin and its overlay's
 * recipe (worker/overlay.go), without CS2: after a new caption card design, a
 * name fixed, another tournament's tag. An admin queues it; an idle recorder
 * (version 6) takes a batch, draws the overlay over each clean video and puts
 * the dressed one back. The twins stay as they are.
 */

import fs from 'fs';
import path from 'path';
import { db } from '../../../config/database';
import { HIGHLIGHTS_DIR, twinFileOf } from './highlights';

/** How many videos one claim hands out (a clip takes seconds, a reel a minute). */
const BATCH = 25;
/** A batch not back after this long goes out again. */
const STALE_SECONDS = 60 * 60;
const MAX_ATTEMPTS = 3;

/** Only files the recorder named: a clip or a reel, never a path. */
export const REDRESS_FILE =
  /^(?:\d+|(?:reel|match|tournament|team)-[A-Za-z0-9_-][A-Za-z0-9_.-]*?)\.mp4$/;

/** Every video with a clean twin and a recipe beside it. */
export async function redressable(): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(HIGHLIGHTS_DIR);
  } catch {
    return [];
  }
  const have = new Set(names);
  return names
    .filter((n) => n.endsWith('.overlay.json'))
    .map((n) => n.replace(/\.overlay\.json$/, '.mp4'))
    .filter(
      (v) =>
        REDRESS_FILE.test(v) &&
        have.has(v) &&
        have.has(path.basename(twinFileOf(path.join(HIGHLIGHTS_DIR, v), 'clean')))
    );
}

/** Queue videos for redressing (all of them that can be, by default); how many. */
export async function queueRedress(files?: string[]): Promise<number> {
  const all = await redressable();
  const want = files ? all.filter((f) => files.includes(f)) : all;
  for (const file of want) {
    await db.runAsync(
      `INSERT INTO cs2_redress_queue (file, status, attempts, error, claimed_at) VALUES (?, 'queued', 0, NULL, NULL)
       ON CONFLICT (file) DO UPDATE SET status = 'queued', attempts = 0, error = NULL, claimed_at = NULL`,
      [file]
    );
  }
  return want.length;
}

export interface RedressJob {
  kind: 'redress';
  files: Array<{ file: string; url: string; upload: string; fail: string }>;
}

/** A batch for an idle recorder, or null. */
export async function claimRedress(): Promise<RedressJob | null> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db.queryAsync<{ file: string }>(
    `SELECT file FROM cs2_redress_queue
      WHERE status = 'queued' OR (status = 'working' AND claimed_at < ?)
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
