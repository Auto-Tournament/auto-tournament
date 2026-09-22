import fs from 'fs';
import path from 'path';
import { log } from '../../../utils/logger';
import { MAP_IMAGES_DIR, LEGACY_MAP_IMAGES_DIR } from '../../../config/publicPaths';

/**
 * One-time startup fix for installs affected by the bug fixed alongside this
 * module (see PR #284's "Judgement calls" section): in the bundled build --
 * and therefore Docker -- uploaded map images were written to
 * `LEGACY_MAP_IMAGES_DIR`, one directory above where `/map-images` is
 * actually served from (`MAP_IMAGES_DIR`), so uploads never showed up.
 *
 * Called on every start (see `integrations/cs2/index.ts`'s `seed` hook). It
 * is cheap to call repeatedly: once every legacy file has been moved (or
 * there never were any, as in dev), `existsSync` short-circuits immediately.
 */
export function migrateLegacyMapImages(): void {
  if (LEGACY_MAP_IMAGES_DIR === MAP_IMAGES_DIR) return;
  if (!fs.existsSync(LEGACY_MAP_IMAGES_DIR)) return;

  let entries: string[];
  try {
    entries = fs.readdirSync(LEGACY_MAP_IMAGES_DIR);
  } catch (err) {
    log.warn(`[map-images] Failed to read legacy image directory ${LEGACY_MAP_IMAGES_DIR}`, {
      error: err,
    });
    return;
  }

  if (entries.length === 0) {
    tryRemoveEmptyDir(LEGACY_MAP_IMAGES_DIR);
    return;
  }

  fs.mkdirSync(MAP_IMAGES_DIR, { recursive: true });

  let moved = 0;
  let skipped = 0;

  for (const name of entries) {
    const from = path.join(LEGACY_MAP_IMAGES_DIR, name);
    const to = path.join(MAP_IMAGES_DIR, name);

    try {
      if (!fs.statSync(from).isFile()) continue;
    } catch {
      continue;
    }

    if (fs.existsSync(to)) {
      // Already present in the correct directory (e.g. re-uploaded since the
      // fix shipped). Leave the legacy copy alone rather than overwrite a
      // newer file.
      skipped += 1;
      continue;
    }

    try {
      fs.renameSync(from, to);
      moved += 1;
    } catch (err) {
      log.warn(`[map-images] Failed to move legacy map image ${name}`, { error: err });
    }
  }

  if (moved > 0 || skipped > 0) {
    log.success(
      `[map-images] Migrated ${moved} map image(s) out of the legacy directory` +
        (skipped > 0 ? ` (${skipped} already present in the correct directory, left as-is)` : '')
    );
  }

  tryRemoveEmptyDir(LEGACY_MAP_IMAGES_DIR);
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
