/**
 * Keep the CS2 maps and the default map pools in step with the catalogue
 * (maps.json, ./mapCatalog), without undoing anything an admin did.
 *
 * Runs automatically (`mode: 'auto'`: the seed hook with the bundled copy, then
 * ./autoSync in the background after the module starts and once a day) and
 * from "Sync maps" (`POST /api/maps/sync`, `mode: 'admin'`):
 *
 * - Maps in the catalogue that are not in `cs2_maps` are added. Automatically
 *   only the ones this database has never seen (`cs2_known_maps`), so a seeded
 *   map an admin deleted does not come back by itself; the admin's sync adds
 *   every missing one.
 * - A map the platform seeded (`system_managed = 1`) gets the catalogue's
 *   name and image. Any edit through the API clears the marker, and a map an
 *   admin created never has it, so those are never renamed. Nothing is ever
 *   deleted, not even a seeded map the catalogue no longer lists.
 * - The default pools (Active Duty, and the one-mode pools) are created when
 *   missing. One the platform created and nobody has edited since
 *   (`system_managed = 1`) follows the catalogue: Active Duty is maps.json's
 *   `activeDuty`, the one-mode pools every map with that prefix. A pool an
 *   admin edited or made is left alone.
 * - A catalogue older than the one last applied (`cs2_map_catalog`: the
 *   bundled copy on an offline box that once synced online) only adds maps;
 *   it never rolls names, images or pools back.
 *
 * `planMapSync` decides, from rows and the catalogue, with no database;
 * `syncCs2Maps` reads the rows, applies the plan and logs what changed.
 */

import { log } from '../../../utils/logger';
import type { SeedClient } from '../../types';
import type { CatalogMap, MapCatalog } from './mapCatalog';

export type MapSyncMode = 'auto' | 'admin';

export const ACTIVE_DUTY_POOL = 'Active Duty';

/**
 * The Active Duty list the seed hard-coded before maps.json. Migration
 * `003-catalog-markers` counts an existing Active Duty pool with exactly these
 * maps as never edited (the old seed rewrote it on every start).
 */
export const LEGACY_ACTIVE_DUTY = [
  'de_ancient',
  'de_anubis',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_vertigo',
] as const;

export interface MapRowState {
  id: string;
  displayName: string;
  imageUrl: string | null;
  systemManaged: boolean;
}

export interface PoolRowState {
  id: number;
  name: string;
  mapIds: string[];
  isDefault: boolean;
  systemManaged: boolean;
}

export interface MapSyncState {
  maps: MapRowState[];
  /** Every map id a sync has offered this database before. */
  knownIds: string[];
  pools: PoolRowState[];
  /** `generatedAt` of the catalogue last applied, if any. */
  appliedGeneratedAt?: string | null;
}

export interface PoolChange {
  id: number;
  name: string;
  mapIds: string[];
  added: string[];
  removed: string[];
}

/** What happened to the Active Duty pool, for the admin's toast and the log. */
export type ActiveDutyOutcome = 'created' | 'updated' | 'kept' | 'unchanged' | 'stale';

export interface MapSyncPlan {
  addMaps: CatalogMap[];
  updateMaps: Array<{ id: string; displayName: string; imageUrl: string; changed: string[] }>;
  /** Catalogue maps neither added nor updated: already there as they are, an admin's, or deleted on purpose. */
  skipped: number;
  insertPools: Array<{ name: string; mapIds: string[]; isDefault: boolean; enabled: boolean }>;
  updatePools: PoolChange[];
  /** Default pools an admin edited, whose maps differ from what the catalogue would give them. */
  keptPools: Array<{ name: string; catalogue: string[] }>;
  /** Catalogue ids to record as seen. */
  knownIds: string[];
  /** The catalogue is older than the one last applied: it only added maps. */
  stale: boolean;
  activeDuty: ActiveDutyOutcome;
}

interface SystemPool {
  name: string;
  isDefault: boolean;
  enabled: boolean;
  maps: (mapIds: string[], catalog: MapCatalog) => string[];
}

const byPrefix = (prefix: string) => (mapIds: string[]) => mapIds.filter((id) => id.startsWith(prefix));

const SYSTEM_POOLS: SystemPool[] = [
  {
    name: ACTIVE_DUTY_POOL,
    isDefault: true,
    enabled: true,
    maps: (mapIds, catalog) => catalog.activeDuty.filter((id) => mapIds.includes(id)),
  },
  // Disabled by default: for a "no veto" mode.
  { name: 'Defusal only', isDefault: false, enabled: false, maps: byPrefix('de_') },
  { name: 'Hostage only', isDefault: false, enabled: false, maps: byPrefix('cs_') },
  { name: 'Arms Race only', isDefault: false, enabled: false, maps: byPrefix('ar_') },
];

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function planMapSync(state: MapSyncState, catalog: MapCatalog, mode: MapSyncMode): MapSyncPlan {
  const existing = new Map(state.maps.map((map) => [map.id, map]));
  const known = new Set(state.knownIds);
  const stale = Boolean(
    state.appliedGeneratedAt && catalog.generatedAt && catalog.generatedAt < state.appliedGeneratedAt
  );

  const addMaps: CatalogMap[] = [];
  const updateMaps: MapSyncPlan['updateMaps'] = [];
  for (const map of catalog.maps) {
    const row = existing.get(map.id);
    if (!row) {
      if (mode === 'admin' || !known.has(map.id)) addMaps.push(map);
      continue;
    }
    if (!row.systemManaged || stale) continue;
    const changed: string[] = [];
    if (row.displayName !== map.displayName) changed.push(`name ${row.displayName} → ${map.displayName}`);
    if (row.imageUrl !== map.imageUrl) changed.push('image');
    if (changed.length > 0) updateMaps.push({ id: map.id, displayName: map.displayName, imageUrl: map.imageUrl, changed });
  }

  const mapIds = [...new Set([...state.maps.map((map) => map.id), ...addMaps.map((map) => map.id)])].sort();
  const hasDefault = state.pools.some((pool) => pool.isDefault);
  const insertPools: MapSyncPlan['insertPools'] = [];
  const updatePools: PoolChange[] = [];
  const keptPools: MapSyncPlan['keptPools'] = [];
  let activeDuty: ActiveDutyOutcome = stale ? 'stale' : 'unchanged';
  for (const def of SYSTEM_POOLS) {
    const wanted = [...def.maps(mapIds, catalog)].sort();
    if (wanted.length === 0) continue;
    const pool = state.pools.find((p) => p.name === def.name);
    const isActiveDuty = def.name === ACTIVE_DUTY_POOL;
    if (!pool) {
      insertPools.push({ name: def.name, mapIds: wanted, isDefault: def.isDefault && !hasDefault, enabled: def.enabled });
      if (isActiveDuty) activeDuty = 'created';
      continue;
    }
    if (stale || sameList(pool.mapIds, wanted)) continue;
    if (!pool.systemManaged) {
      keptPools.push({ name: pool.name, catalogue: wanted });
      if (isActiveDuty) activeDuty = 'kept';
      continue;
    }
    updatePools.push({
      id: pool.id,
      name: pool.name,
      mapIds: wanted,
      added: wanted.filter((id) => !pool.mapIds.includes(id)),
      removed: pool.mapIds.filter((id) => !wanted.includes(id)),
    });
    if (isActiveDuty) activeDuty = 'updated';
  }

  return {
    addMaps,
    updateMaps,
    skipped: catalog.maps.length - addMaps.length - updateMaps.length,
    insertPools,
    updatePools,
    keptPools,
    knownIds: catalog.maps.map((map) => map.id).filter((id) => !known.has(id)),
    stale,
    activeDuty,
  };
}

function parseIds(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function readMapSyncState(client: SeedClient): Promise<MapSyncState> {
  const maps = await client.query('SELECT id, display_name, image_url, system_managed FROM cs2_maps');
  const known = await client.query('SELECT id FROM cs2_known_maps');
  const pools = await client.query('SELECT id, name, map_ids, is_default, system_managed FROM cs2_map_pools');
  const applied = await client.query("SELECT generated_at FROM cs2_map_catalog WHERE slot = 'applied'");
  const generatedAt = applied.rows[0]?.generated_at;
  return {
    maps: maps.rows.map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name),
      imageUrl: row.image_url == null ? null : String(row.image_url),
      systemManaged: Number(row.system_managed) === 1,
    })),
    knownIds: known.rows.map((row) => String(row.id)),
    pools: pools.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      mapIds: parseIds(row.map_ids),
      isDefault: Number(row.is_default) === 1,
      systemManaged: Number(row.system_managed) === 1,
    })),
    appliedGeneratedAt: generatedAt == null ? null : String(generatedAt),
  };
}

export async function applyMapSync(
  client: SeedClient,
  plan: MapSyncPlan,
  catalog: MapCatalog,
  source: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  for (const map of plan.addMaps) {
    await client.query(
      `INSERT INTO cs2_maps (id, display_name, image_url, system_managed, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4, $4) ON CONFLICT (id) DO NOTHING`,
      [map.id, map.displayName, map.imageUrl, now]
    );
  }
  for (const map of plan.updateMaps) {
    // `system_managed = 1` again here: an admin may have edited it since the rows were read.
    await client.query(
      'UPDATE cs2_maps SET display_name = $2, image_url = $3, updated_at = $4 WHERE id = $1 AND system_managed = 1',
      [map.id, map.displayName, map.imageUrl, now]
    );
  }
  for (const pool of plan.insertPools) {
    await client.query(
      `INSERT INTO cs2_map_pools (name, map_ids, is_default, enabled, system_managed, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5, $5) ON CONFLICT (name) DO NOTHING`,
      [pool.name, JSON.stringify(pool.mapIds), pool.isDefault ? 1 : 0, pool.enabled ? 1 : 0, now]
    );
  }
  for (const pool of plan.updatePools) {
    await client.query(
      'UPDATE cs2_map_pools SET map_ids = $2, updated_at = $3 WHERE id = $1 AND system_managed = 1',
      [pool.id, JSON.stringify(pool.mapIds), now]
    );
  }
  if (plan.knownIds.length > 0) {
    await client.query(
      'INSERT INTO cs2_known_maps (id) SELECT unnest($1::text[]) ON CONFLICT (id) DO NOTHING',
      [plan.knownIds]
    );
  }
  if (!plan.stale) {
    await client.query(
      `INSERT INTO cs2_map_catalog (slot, generated_at, patch_version, source, synced_at)
       VALUES ('applied', $1, $2, $3, $4)
       ON CONFLICT (slot) DO UPDATE SET generated_at = EXCLUDED.generated_at,
         patch_version = EXCLUDED.patch_version, source = EXCLUDED.source, synced_at = EXCLUDED.synced_at`,
      [catalog.generatedAt, catalog.patchVersion, source, now]
    );
  }
}

export interface MapSyncResult {
  plan: MapSyncPlan;
  catalog: MapCatalog;
}

/** Read, plan, apply, log. Throws on a database error. */
export async function syncCs2Maps(
  client: SeedClient,
  catalog: MapCatalog,
  mode: MapSyncMode,
  source: string
): Promise<MapSyncResult> {
  const plan = planMapSync(await readMapSyncState(client), catalog, mode);
  await applyMapSync(client, plan, catalog, source);

  const from = `maps.json (${source}${catalog.patchVersion ? `, patch ${catalog.patchVersion}` : ''})`;
  if (plan.addMaps.length > 0) {
    log.info(`[CS2 maps] Added ${plan.addMaps.length} map(s) from ${from}: ${plan.addMaps.map((m) => m.id).join(', ')}`);
  }
  for (const map of plan.updateMaps) {
    log.info(`[CS2 maps] Updated ${map.id} from ${from}: ${map.changed.join(', ')}`);
  }
  for (const pool of plan.insertPools) {
    log.info(`[CS2 maps] Created the ${pool.name} pool: ${pool.mapIds.join(', ')}`);
  }
  for (const pool of plan.updatePools) {
    const diff = [...pool.added.map((id) => `+${id}`), ...pool.removed.map((id) => `-${id}`)].join(' ');
    log.info(`[CS2 maps] Updated the ${pool.name} pool (not edited by an admin): ${diff}`);
  }
  for (const pool of plan.keptPools) {
    log.info(
      `[CS2 maps] Left the ${pool.name} pool as an admin edited it; ${from} would make it ${pool.catalogue.join(', ')}`
    );
  }
  if (plan.stale) {
    log.database(`[CS2 maps] ${from} is older than the map list last applied; only new maps were added`);
  } else if (
    plan.addMaps.length + plan.updateMaps.length + plan.insertPools.length + plan.updatePools.length ===
    0
  ) {
    log.database(`[CS2 maps] Nothing to change from ${from}`);
  }
  return { plan, catalog };
}
