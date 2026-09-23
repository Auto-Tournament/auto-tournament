import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';
import { MAP_IMAGES_DIR, LEGACY_MAP_IMAGES_DIRS } from './publicPaths';

/**
 * One-time startup fix for installs whose uploaded map images are still
 * sitting inside the container image instead of on the mounted volume.
 *
 * Map images used to be written under `PUBLIC_DIR` (see `publicPaths.ts`),
 * which is build output baked into the image -- so every container recreate,
 * i.e. every update, silently deleted every image an admin had uploaded.
 * `MAP_IMAGES_DIR` now lives under `DATA_DIR`, the bind-mounted volume; this
 * moves whatever the old locations still hold into it.
 *
 * Called at core startup (`index.ts`), before the map upload route is
 * imported -- that module creates `MAP_IMAGES_DIR` as soon as it loads, and
 * `/map-images` is served straight off the directory, so the move wants to
 * be done before either happens. Running it from core rather than the CS2
 * module's `seed` hook (where the previous, `PUBLIC_DIR`-to-`PUBLIC_DIR`
 * migration lived) also means it still runs on an install where CS2 is not
 * registered.
 *
 * It is cheap to call repeatedly: once a legacy directory is empty and gone,
 * `existsSync` short-circuits immediately.
 */
export function migrateLegacyMapImages(): void {
  let moved = 0;
  let skipped = 0;
  const movedNames: string[] = [];

  for (const legacyDir of LEGACY_MAP_IMAGES_DIRS) {
    if (path.resolve(legacyDir) === path.resolve(MAP_IMAGES_DIR)) continue;
    if (!fs.existsSync(legacyDir)) continue;

    const stats = moveMapImages(legacyDir, MAP_IMAGES_DIR);
    moved += stats.moved;
    skipped += stats.skipped;
    movedNames.push(...stats.movedNames);
  }

  if (moved > 0 || skipped > 0) {
    log.success(
      `[map-images] Moved ${moved} map image(s) onto the persistent data directory ${MAP_IMAGES_DIR}` +
        (movedNames.length > 0 ? `: ${movedNames.join(', ')}` : '') +
        (skipped > 0
          ? ` (${skipped} left in place because a file with the same name already exists in ${MAP_IMAGES_DIR})`
          : '')
    );
  }
}

/**
 * The move itself, factored out from `migrateLegacyMapImages` (which calls it
 * once per entry in `LEGACY_MAP_IMAGES_DIRS`) so it can be unit tested
 * against throwaway directories -- see `tests/api/map-images-migration.spec.ts`.
 *
 * Flat by design: uploaded images are written straight into the directory as
 * `<mapId>.<ext>` by `integrations/cs2/maps/routes.ts`, so there are no
 * subdirectories to recurse into. Anything that is not a regular file is
 * ignored rather than moved.
 *
 * Never overwrites: a name that already exists at the destination (e.g. the
 * image was re-uploaded after the upgrade, so the newer file is already
 * there) is counted as skipped and left behind in the legacy directory
 * rather than clobbering it.
 */
export function moveMapImages(
  from: string,
  to: string
): { moved: number; skipped: number; movedNames: string[] } {
  const result = { moved: 0, skipped: 0, movedNames: [] as string[] };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(from, { withFileTypes: true });
  } catch (err) {
    log.warn(`[map-images] Failed to read legacy image directory ${from}`, { error: err });
    return result;
  }

  if (entries.length === 0) {
    tryRemoveEmptyDir(from);
    return result;
  }

  fs.mkdirSync(to, { recursive: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);

    if (fs.existsSync(toPath)) {
      result.skipped += 1;
      continue;
    }

    if (renameOrCopy(fromPath, toPath)) {
      result.moved += 1;
      result.movedNames.push(entry.name);
    }
  }

  tryRemoveEmptyDir(from);
  return result;
}

/**
 * Moves one file, preferring a plain `rename` (instant, no data duplication)
 * and falling back to copy-then-delete when `rename` reports `EXDEV`.
 *
 * That fallback is not theoretical here -- it is the whole point of this
 * migration. The legacy directories sit in the container's own writable
 * layer while `MAP_IMAGES_DIR` is a bind-mounted volume, which is a
 * different filesystem, and `fs.renameSync` across the two fails with
 * `EXDEV` ("cross-device link"). The equivalent `DATA_DIR` migration (#292)
 * hit exactly this against a real Docker build, where a rename-only version
 * quietly left every file behind.
 */
function renameOrCopy(fromPath: string, toPath: string): boolean {
  try {
    fs.renameSync(fromPath, toPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') {
      log.warn(`[map-images] Failed to move legacy map image ${fromPath}`, { error: err });
      return false;
    }
    // Cross-device: copy then remove the original.
  }

  try {
    fs.copyFileSync(fromPath, toPath);
    fs.unlinkSync(fromPath);
    return true;
  } catch (err) {
    log.warn(`[map-images] Failed to copy legacy map image ${fromPath}`, { error: err });
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
