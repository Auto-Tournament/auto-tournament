import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';
import { DATA_DIR, LEGACY_DATA_DIR } from './dataDir';

/**
 * One-time startup fix for installs affected by the bug fixed alongside this
 * module (see `dataDir.ts`): in the bundled build -- and therefore Docker --
 * `DATA_DIR` resolved one directory above where `docker/docker-compose.yml`
 * mounts the persistent volume, so demos and event logs written there lived
 * only in the container's writable layer and were lost every time the
 * container was recreated (every update).
 *
 * Called at core startup (`index.ts`), before any module that reads or
 * writes under `DATA_DIR` at import time (e.g. the demos route, the event
 * logger). It is cheap to call repeatedly: once every legacy file has been
 * moved (or there never were any, as in dev), `existsSync` short-circuits
 * immediately.
 *
 * Recurses into subdirectories (`demos/`, `logs/events/`, ...) merging them
 * into the matching directory under `DATA_DIR` rather than moving the whole
 * legacy tree in one shot, so a partial migration (or a destination that
 * already has some files, e.g. from a previous partial run) still makes
 * progress. Never overwrites: a name that already exists at the destination
 * is left in place under the legacy directory instead.
 */
export function migrateLegacyDataDir(): void {
  if (LEGACY_DATA_DIR === DATA_DIR) return;
  if (!fs.existsSync(LEGACY_DATA_DIR)) return;

  const stats = mergeLegacyDataDir(LEGACY_DATA_DIR, DATA_DIR);

  if (stats.moved > 0 || stats.skipped > 0) {
    log.success(
      `[data-dir] Migrated ${stats.moved} item(s) out of the legacy data directory ${LEGACY_DATA_DIR}` +
        (stats.skipped > 0
          ? ` (${stats.skipped} left in place because a file with the same name already exists in ${DATA_DIR})`
          : '')
    );
  }
}

/**
 * The recursive move/merge itself, factored out from `migrateLegacyDataDir`
 * (which always calls it with `LEGACY_DATA_DIR`/`DATA_DIR`) so it can be unit
 * tested against throwaway directories -- see `tests/api/data-dir-migration.spec.ts`.
 */
export function mergeLegacyDataDir(from: string, to: string): { moved: number; skipped: number } {
  const stats = { moved: 0, skipped: 0 };
  moveTreeMerging(from, to, stats);
  return stats;
}

function moveTreeMerging(from: string, to: string, stats: { moved: number; skipped: number }): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(from, { withFileTypes: true });
  } catch (err) {
    log.warn(`[data-dir] Failed to read legacy data directory ${from}`, { error: err });
    return;
  }

  if (entries.length === 0) {
    tryRemoveEmptyDir(from);
    return;
  }

  fs.mkdirSync(to, { recursive: true });

  for (const entry of entries) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(toPath) && renameOrCopy(fromPath, toPath, 'directory')) {
        stats.moved += 1;
        continue;
      }
      // Destination already exists, or the directory couldn't be moved/copied
      // whole (e.g. the plain `rename` fast path below only handles files, not
      // directories, across devices): merge contents one level down instead
      // of clobbering.
      moveTreeMerging(fromPath, toPath, stats);
      continue;
    }

    if (!entry.isFile()) {
      // Symlinks, sockets, etc. -- nothing legitimate should land here, skip.
      continue;
    }

    if (fs.existsSync(toPath)) {
      // Already present in the correct directory. Leave the legacy copy
      // alone rather than overwrite a newer file.
      stats.skipped += 1;
      continue;
    }

    if (renameOrCopy(fromPath, toPath, 'file')) {
      stats.moved += 1;
    }
  }

  tryRemoveEmptyDir(from);
}

/**
 * Moves `fromPath` to `toPath`, preferring a plain `rename` (instant, no data
 * duplication) and falling back to copy-then-delete when `rename` can't do
 * it. Returns whether the move succeeded.
 *
 * `LEGACY_DATA_DIR` and `DATA_DIR` are on different filesystems in the exact
 * case this migration exists for: `DATA_DIR` is the bind-mounted volume,
 * `LEGACY_DATA_DIR` is the container's own writable layer. `fs.renameSync`
 * fails there with `EXDEV` ("cross-device link") -- verified against a real
 * `docker/Dockerfile` build, where every legacy file was silently left behind
 * until this fallback was added. A plain recursive copy handles both the
 * `EXDEV` file case and any directory, at the cost of a real copy instead of
 * a pointer swap; these are one-time, low-volume migrations, so that's fine.
 */
function renameOrCopy(fromPath: string, toPath: string, kind: 'file' | 'directory'): boolean {
  if (kind === 'file') {
    try {
      fs.renameSync(fromPath, toPath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') {
        log.warn(`[data-dir] Failed to move legacy file ${fromPath}`, { error: err });
        return false;
      }
      // Cross-device: copy then remove the original.
    }
    try {
      fs.copyFileSync(fromPath, toPath);
      fs.unlinkSync(fromPath);
      return true;
    } catch (err) {
      log.warn(`[data-dir] Failed to copy legacy file ${fromPath}`, { error: err });
      return false;
    }
  }

  // Directories: only take the whole-subtree fast path when it's a plain
  // same-device rename. Anything else (EXDEV or otherwise) falls back to the
  // caller merging file-by-file, which itself uses the same rename-then-copy
  // fallback -- rather than duplicating a recursive copy here.
  try {
    fs.renameSync(fromPath, toPath);
    return true;
  } catch {
    return false;
  }
}

function tryRemoveEmptyDir(dir: string): void {
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    // Best-effort cleanup only -- leaving an empty legacy directory behind is harmless.
  }
}
