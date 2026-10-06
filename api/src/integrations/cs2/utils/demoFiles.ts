/**
 * Where demos live on disk, and how a stored demo is attached to its match.
 *
 * Shared by the two ways a demo reaches the platform: the HTTP upload
 * (routes/demos.ts, the plugin and Ready Up without a fleet link) and the
 * fleet demo stream (fleet/demoStream.ts, FLEET.md §12.2). Both end with a
 * file under `DEMOS_DIR` and `linkStoredDemo`, so the match page, the
 * download route and the demo status routes see them the same way.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../../../config/dataDir';
import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { emitMatchUpdate } from '../../../services/socketService';
import { getMapResults } from '../../../services/matchMapResultService';
import { enqueueDemoJob } from '../demos/jobs';
import type { DbMatchRow } from '../../../types/database.types';

/** Demos, under DATA_DIR so they survive container recreates (config/dataDir.ts). */
export const DEMOS_DIR = path.join(DATA_DIR, 'demos');

/** Create `DEMOS_DIR` when it is missing. */
export function ensureDemosDir(): void {
  if (!fs.existsSync(DEMOS_DIR)) {
    fs.mkdirSync(DEMOS_DIR, { recursive: true });
    log.server(`Created demos directory: ${DEMOS_DIR}`);
  }
}

/**
 * Point the match (and, with a map number, its map result) at a demo file
 * stored at `DEMOS_DIR/<relativePath>`, then tell the frontend.
 *
 * `mapNumber` is the platform's (0-based); NaN skips the per-map row. Returns
 * whether a map result row took the path (false when the map has no result
 * row yet, or no map number was given).
 */
export async function linkStoredDemo(
  matchSlug: string,
  relativePath: string,
  mapNumber: number,
  logPrefix = '[Demo Upload]'
): Promise<boolean> {
  // The match-level path (older clients and the single-demo routes read it).
  await db.updateAsync('matches', { demo_file_path: relativePath }, 'slug = ?', [matchSlug]);

  let mapLinked = false;
  if (!isNaN(mapNumber)) {
    try {
      const result = await db.runAsync(
        `UPDATE match_map_results
         SET demo_file_path = ?
         WHERE match_slug = ? AND map_number = ?`,
        [relativePath, matchSlug, mapNumber]
      );
      mapLinked = result.changes > 0;
      // The worker reads it after the match (demos/jobs.ts).
      if (mapLinked) await enqueueDemoJob(matchSlug, mapNumber, relativePath);
      log.debug(`${logPrefix} Stored demo path for map`, {
        matchSlug,
        mapNumber,
        demoPath: relativePath,
        mapLinked,
      });
    } catch (error) {
      log.warn(`${logPrefix} Failed to store demo path for map`, {
        matchSlug,
        mapNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Tell the frontend that a demo arrived.
  try {
    const updatedMatch = await db.queryOneAsync<DbMatchRow>('SELECT * FROM matches WHERE slug = ?', [
      matchSlug,
    ]);
    if (updatedMatch) {
      const mapResults = await getMapResults(matchSlug);
      emitMatchUpdate({
        slug: matchSlug,
        id: updatedMatch.id,
        status: updatedMatch.status,
        mapResults,
      });
      log.debug(`${logPrefix} Emitted match update`, { matchSlug });
    }
  } catch (updateError) {
    log.warn(`${logPrefix} Failed to emit match update`, {
      matchSlug,
      error: updateError instanceof Error ? updateError.message : String(updateError),
    });
  }
  return mapLinked;
}
