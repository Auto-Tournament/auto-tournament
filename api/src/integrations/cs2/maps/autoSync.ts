/**
 * Map syncs against the live maps.json: the admin's "Sync maps"
 * (`POST /api/maps/sync`) and the automatic ones, in the background after the
 * CS2 module starts and then once a day, so new maps and Active Duty changes
 * arrive without anyone pressing a button. The rules are ./mapSync's: nothing
 * an admin made or edited is touched.
 *
 * The seed hook (./seed) applies only the bundled copy, with no network, so a
 * start never waits on GitHub.
 */

import { db } from '../../../config/database';
import { log } from '../../../utils/logger';
import { loadMapCatalog, type LoadedMapCatalog } from './mapCatalog';
import { syncCs2Maps, type MapSyncMode, type MapSyncResult } from './mapSync';
import { mapService } from './mapService';
import { getHostView } from '../fleet/hosts/registry';
import { hostEvents } from '../fleet/hosts/service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A host that reconnects often syncs the maps at most this often. */
const HOST_SYNC_EVERY_MS = 60 * 60 * 1000;
let lastHostSync = 0;

export type MapSyncRun = MapSyncResult & Pick<LoadedMapCatalog, 'source' | 'error'>;

/** Fetch maps.json (or fall back to the bundled copy) and sync, in one transaction. */
export async function runMapSync(mode: MapSyncMode): Promise<MapSyncRun> {
  const { catalog, source, error } = await loadMapCatalog();
  const result = await db.withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const synced = await syncCs2Maps(client, catalog, mode, source);
      await client.query('COMMIT');
      return synced;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
  // The map types it filled in, for the tournament map-type rule (mapModes.ts).
  await mapService.getAllMaps().catch(() => undefined);
  return { ...result, source, error };
}

let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;

function runInBackground(why: string): void {
  if (running) return;
  running = runMapSync('auto')
    .then(() => undefined)
    .catch((err) => {
      log.warn(
        `[CS2 maps] The ${why} map sync failed: ${err instanceof Error ? err.message : String(err)}`
      );
    })
    .finally(() => {
      running = null;
    });
}

// At startup the csm host is usually not connected yet: sync again once one that builds maps.json is.
async function onHostOnline(hostId: string): Promise<void> {
  if (Date.now() - lastHostSync < HOST_SYNC_EVERY_MS) return;
  const host = await getHostView(hostId).catch(() => null);
  if (!host?.capabilities.includes('catalog.v1')) return;
  if (running) await running;
  lastHostSync = Date.now();
  runInBackground('host');
}
const hostOnline = (hostId: string) => void onHostOnline(hostId);

/** Sync now, when a csm host connects, then once a day, in the background. Never throws, never blocks. */
export function startMapAutoSync(): void {
  stopMapAutoSync();
  runInBackground('startup');
  hostEvents.on('online', hostOnline);
  timer = setInterval(() => runInBackground('daily'), DAY_MS);
  timer.unref?.();
}

export function stopMapAutoSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  hostEvents.off('online', hostOnline);
}
