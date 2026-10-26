/**
 * Dropping the highest quality (highlights_keep_masters): when a video has
 * lower qualities cut from it (cuts), its highest one is the biggest file by
 * far (a 4K 240 fps reel: 880 MB for three minutes). After the set time its
 * top cut takes the video's place, under the video's own name so links and
 * downloads keep working, and its clean twin and overlay recipe go with it.
 * Such a video can no longer be dressed again or joined into a reel at its
 * highest quality; a clip waits until its match's reels are made.
 */
import fs from 'fs';
import path from 'path';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { settingsService } from '../../../services/settingsService';
import { HIGHLIGHTS_DIR, cutFileOf, forgetCutList, twinFileOf } from './highlights';

const SWEEP_MS = 3600_000;
const PER_SWEEP = 200;

/** How old (seconds) a video must be before its highest quality goes; null: never. */
export function keepSeconds(setting: string | null | undefined): number | null {
  const v = (setting ?? '').trim();
  if (v === 'reels') return 0;
  const days = Number(v);
  return v !== '' && Number.isInteger(days) && days > 0 ? days * 86400 : null;
}

/**
 * Put a video's top cut in its place and drop its clean twin and overlay recipe.
 * False when it has no cut (one quality: nothing to drop to).
 */
export async function promoteTopCut(video: string): Promise<boolean> {
  const base = path.basename(video).replace(/\.mp4$/, '');
  const top = (await fs.promises.readdir(path.dirname(video)))
    .flatMap((n) => {
      const m = /^(.+)\.(\d{3,4})p(\d{2,3})\.mp4$/.exec(n);
      return m?.[1] === base
        ? [{ name: `${m[2]}p${m[3]}`, height: Number(m[2]), fps: Number(m[3]) }]
        : [];
    })
    .sort((a, b) => b.height - a.height || b.fps - a.fps)
    .at(0);
  if (!top) return false;
  await fs.promises.rename(cutFileOf(video, top.name), video);
  await Promise.all(
    (['clean', 'overlay'] as const).map((t) =>
      fs.promises.rm(twinFileOf(video, t), { force: true })
    )
  );
  forgetCutList();
  return true;
}

// Each table with videos: when its videos were made, and (clips) what else must be done first.
const TABLES = [
  {
    table: 'cs2_highlights',
    key: 'id',
    made: 'COALESCE(done_at, created_at)',
    // Reels are joined from the clips' highest quality: not while one of its match's is still to be made.
    ready: `status = 'done'
      AND NOT EXISTS (SELECT 1 FROM cs2_highlights c WHERE c.match_slug = t.match_slug AND c.status IN ('pending', 'recording'))
      AND NOT EXISTS (SELECT 1 FROM cs2_match_reels r WHERE r.match_slug = t.match_slug AND r.status IN ('pending', 'waiting', 'recording'))
      AND NOT EXISTS (SELECT 1 FROM cs2_team_reels r WHERE r.match_slug = t.match_slug AND r.status IN ('pending', 'waiting', 'recording'))`,
  },
  { table: 'cs2_highlight_reels', key: 'ctid', made: 'created_at', ready: 'TRUE' },
  {
    table: 'cs2_match_reels',
    key: 'ctid',
    made: 'COALESCE(done_at, created_at)',
    ready: "status = 'done'",
  },
  { table: 'cs2_team_reels', key: 'ctid', made: 'created_at', ready: "status = 'done'" },
  { table: 'cs2_tournament_reels', key: 'ctid', made: 'created_at', ready: "status = 'done'" },
] as const;

export async function dropMasters(now = Math.floor(Date.now() / 1000)): Promise<number> {
  const keep = keepSeconds(await settingsService.getSetting('highlights_keep_masters'));
  if (keep === null) return 0;
  let dropped = 0;
  for (const t of TABLES) {
    const rows = await db.queryAsync<{ key: string; clip_path: string }>(
      `SELECT ${t.key}::text AS key, clip_path FROM ${t.table} t
        WHERE clip_path IS NOT NULL AND master_dropped_at IS NULL AND ${t.made} <= ? AND ${t.ready}
        LIMIT ${PER_SWEEP}`,
      [now - keep]
    );
    for (const r of rows) {
      const video = path.join(HIGHLIGHTS_DIR, path.basename(r.clip_path));
      try {
        if (!fs.existsSync(video) || !(await promoteTopCut(video))) continue;
        const { size } = await fs.promises.stat(video);
        await db.runAsync(
          `UPDATE ${t.table} SET master_dropped_at = ?, clip_bytes = ? WHERE ${t.key}::text = ?`,
          [now, size, r.key]
        );
        dropped++;
      } catch (error) {
        log.warn('[HIGHLIGHTS] could not drop a highest quality', { video: r.clip_path, error });
      }
    }
  }
  if (dropped)
    log.info(
      `[HIGHLIGHTS] ${dropped} video(s) now keep their top cut instead of the highest quality`
    );
  return dropped;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startMasterSweep(): void {
  if (timer) return;
  const run = () =>
    void dropMasters().catch((error: unknown) =>
      log.warn('[HIGHLIGHTS] master sweep failed', { error })
    );
  run();
  timer = setInterval(run, SWEEP_MS);
  timer.unref();
}

export function stopMasterSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
