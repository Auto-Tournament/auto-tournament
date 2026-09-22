/**
 * CS2 default data: the map catalogue and the default map pools.
 *
 * Run through `GameIntegration.seed` after the core schema is created or
 * migrated (every API start, and after a database reset). Moved here from
 * `config/database.schema.ts` (`getDefaultMapsSQL`, `getDefaultMapPoolsSQL`)
 * and `config/database.ts` unchanged: maps are only fetched when the `maps`
 * table is empty, pools are upserted every time.
 */

import { log } from '../../../utils/logger';
import type { SeedClient } from '../../types';

/**
 * Default maps to insert on schema initialization
 * Fetches from GitHub repository: https://github.com/Auto-Tournament/cs2-server-manager/tree/master/map_thumbnails
 * Falls back to hardcoded maps if GitHub fetch fails (e.g., rate limiting, network errors, etc.)
 */
async function getDefaultMapsSQL(): Promise<string> {
  let maps: Array<{ id: string; displayName: string; imageUrl: string }> = [];

  try {
    // Fetch from GitHub repository - this is the source of truth
    const { fetchCS2MapsFromWiki } = await import('./fetchCS2Maps');
    try {
      maps = await fetchCS2MapsFromWiki();
    } catch (err) {
      const { log } = await import('../../../utils/logger');
      const error = err as Error;
      log.warn(
        `[PostgreSQL] Failed to fetch maps from GitHub repository (wiki). Falling back to hardcoded maps. Reason: ${error.message}`
      );
      maps = [];
    }
  } catch (err) {
    // Dynamic import of fetchCS2MapsFromWiki failed – also fall back
    const { log } = await import('../../../utils/logger');
    const error = err as Error;
    log.warn(
      `[PostgreSQL] Failed to load fetchCS2MapsFromWiki helper. Falling back to hardcoded maps. Reason: ${error.message}`
    );
    maps = [];
  }

  // Fallback to hardcoded maps if fetch failed or returned empty (e.g., rate limiting)
  if (maps.length === 0) {
    const { log } = await import('../../../utils/logger');
    log.warn(
      'Failed to fetch maps from GitHub repository. Using fallback maps that match the repository.'
    );
    const fallbackMaps = getFallbackMaps();
    return generateMapsSQL(fallbackMaps);
  }

  // Convert fetched maps to the format expected by generateMapsSQL
  const formattedMaps = maps.map((map) => ({
    id: map.id,
    display_name: map.displayName,
    image_url: map.imageUrl,
  }));

  return generateMapsSQL(formattedMaps);
}

/**
 * Fallback hardcoded maps (used if GitHub fetch fails, e.g., rate limiting)
 * This list matches the actual maps in the repository:
 * https://github.com/Auto-Tournament/cs2-server-manager/tree/master/map_thumbnails
 */
function getFallbackMaps(): Array<{ id: string; display_name: string; image_url: string }> {
  const GITHUB_RAW_BASE =
    'https://raw.githubusercontent.com/Auto-Tournament/cs2-server-manager/master/map_thumbnails';

  return [
    {
      id: 'ar_baggage',
      display_name: 'Baggage',
      image_url: `${GITHUB_RAW_BASE}/ar_baggage.webp`,
    },
    {
      id: 'ar_pool_day',
      display_name: 'Pool Day',
      image_url: `${GITHUB_RAW_BASE}/ar_pool_day.webp`,
    },
    {
      id: 'ar_shoots',
      display_name: 'Shoots',
      image_url: `${GITHUB_RAW_BASE}/ar_shoots.webp`,
    },
    {
      id: 'ar_shoots_night',
      display_name: 'Shoots (Night)',
      image_url: `${GITHUB_RAW_BASE}/ar_shoots_night.webp`,
    },
    {
      id: 'cs_agency',
      display_name: 'Agency',
      image_url: `${GITHUB_RAW_BASE}/cs_agency.webp`,
    },
    {
      id: 'cs_italy',
      display_name: 'Italy',
      image_url: `${GITHUB_RAW_BASE}/cs_italy.webp`,
    },
    {
      id: 'cs_office',
      display_name: 'CS Office',
      image_url: `${GITHUB_RAW_BASE}/cs_office.webp`,
    },
    {
      id: 'de_ancient',
      display_name: 'Ancient',
      image_url: `${GITHUB_RAW_BASE}/de_ancient.webp`,
    },
    {
      id: 'de_ancient_night',
      display_name: 'Ancient (Night)',
      image_url: `${GITHUB_RAW_BASE}/de_ancient_night.webp`,
    },
    {
      id: 'de_anubis',
      display_name: 'Anubis',
      image_url: `${GITHUB_RAW_BASE}/de_anubis.webp`,
    },
    {
      id: 'de_dust2',
      display_name: 'Dust II',
      image_url: `${GITHUB_RAW_BASE}/de_dust2.webp`,
    },
    {
      id: 'de_golden',
      display_name: 'Golden',
      image_url: `${GITHUB_RAW_BASE}/de_golden.webp`,
    },
    {
      id: 'de_inferno',
      display_name: 'Inferno',
      image_url: `${GITHUB_RAW_BASE}/de_inferno.webp`,
    },
    {
      id: 'de_mirage',
      display_name: 'Mirage',
      image_url: `${GITHUB_RAW_BASE}/de_mirage.webp`,
    },
    {
      id: 'de_nuke',
      display_name: 'Nuke',
      image_url: `${GITHUB_RAW_BASE}/de_nuke.webp`,
    },
    {
      id: 'de_overpass',
      display_name: 'Overpass',
      image_url: `${GITHUB_RAW_BASE}/de_overpass.webp`,
    },
    {
      id: 'de_palacio',
      display_name: 'Palacio',
      image_url: `${GITHUB_RAW_BASE}/de_palacio.webp`,
    },
    {
      id: 'de_rooftop',
      display_name: 'Rooftop',
      image_url: `${GITHUB_RAW_BASE}/de_rooftop.webp`,
    },
    {
      id: 'de_train',
      display_name: 'Train',
      image_url: `${GITHUB_RAW_BASE}/de_train.webp`,
    },
    {
      id: 'de_vertigo',
      display_name: 'Vertigo',
      image_url: `${GITHUB_RAW_BASE}/de_vertigo.webp`,
    },
  ];
}

/**
 * Generate SQL from maps array
 */
function generateMapsSQL(
  maps: Array<{ id: string; display_name: string; image_url: string }>
): string {
  const now = Math.floor(Date.now() / 1000);
  const values = maps
    .map(
      (map) =>
        `('${map.id}', '${map.display_name.replace(/'/g, "''")}', '${
          map.image_url
        }', ${now}, ${now})`
    )
    .join(',\n    ');

  return `
    INSERT INTO maps (id, display_name, image_url, created_at, updated_at)
    VALUES
      ${values}
    ON CONFLICT (id) DO NOTHING;
  `;
}

/**
 * Default map pools to insert on schema initialization
 * Creates pools based on map types (de_, cs_, ar_) and Active Duty pool
 */
async function getDefaultMapPoolsSQL(client: SeedClient): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Query all maps from the database
  const mapsResult = await client.query('SELECT id FROM maps ORDER BY id');
  const allMapIds = (mapsResult.rows as Array<{ id: string }>).map((row) => row.id);

  // Group maps by prefix
  const defusalMaps: string[] = [];
  const hostageMaps: string[] = [];
  const armsRaceMaps: string[] = [];

  for (const mapId of allMapIds) {
    if (mapId.startsWith('de_')) {
      defusalMaps.push(mapId);
    } else if (mapId.startsWith('cs_')) {
      hostageMaps.push(mapId);
    } else if (mapId.startsWith('ar_')) {
      armsRaceMaps.push(mapId);
    }
  }

  // Active Duty map pool (all 7 competitive maps, filtered to only include maps that exist)
  const activeDutyMapIds = [
    'de_ancient',
    'de_anubis',
    'de_dust2',
    'de_inferno',
    'de_mirage',
    'de_nuke',
    'de_vertigo',
  ];
  const activeDutyMaps = activeDutyMapIds.filter((id) => allMapIds.includes(id));

  const pools: Array<{ name: string; mapIds: string[]; isDefault: number; enabled: number }> = [];

  // Add Active Duty pool if we have any of those maps
  if (activeDutyMaps.length > 0) {
    pools.push({
      name: 'Active Duty',
      mapIds: activeDutyMaps,
      isDefault: 1,
      enabled: 1, // Active Duty is enabled by default
    });
  }

  // Add Defusal pool if we have de_ maps
  if (defusalMaps.length > 0) {
    pools.push({
      name: 'Defusal only',
      mapIds: defusalMaps,
      isDefault: 0,
      enabled: 0, // Disabled by default - for future "no veto" mode
    });
  }

  // Add Hostage pool if we have cs_ maps
  if (hostageMaps.length > 0) {
    pools.push({
      name: 'Hostage only',
      mapIds: hostageMaps,
      isDefault: 0,
      enabled: 0, // Disabled by default - for future "no veto" mode
    });
  }

  // Add Arms Race pool if we have ar_ maps
  if (armsRaceMaps.length > 0) {
    pools.push({
      name: 'Arms Race only',
      mapIds: armsRaceMaps,
      isDefault: 0,
      enabled: 0, // Disabled by default - for future "no veto" mode
    });
  }

  // Generate SQL for all pools
  const values = pools
    .map((pool) => {
      const mapIdsJson = JSON.stringify(pool.mapIds).replace(/'/g, "''");
      const escapedName = pool.name.replace(/'/g, "''");
      return `('${escapedName}', '${mapIdsJson}', ${pool.isDefault}, ${pool.enabled}, ${now}, ${now})`;
    })
    .join(',\n      ');

  return `
    INSERT INTO map_pools (name, map_ids, is_default, enabled, created_at, updated_at)
    VALUES
      ${values}
    ON CONFLICT (name) DO UPDATE SET
      map_ids = EXCLUDED.map_ids,
      enabled = EXCLUDED.enabled,
      updated_at = EXCLUDED.updated_at;
  `;
}

/**
 * Insert the default maps when the `maps` table is empty (first start or after
 * a wipe), then upsert the default map pools.
 */
export async function seedCs2Maps(client: SeedClient): Promise<void> {
  // Insert default maps (only if maps table is empty - first initialization or after wipe)
  // This prevents fetching from GitHub on every server restart/reload
  // But ensures maps are regenerated when database is wiped
  try {
    // The maps table should exist at this point (created by schema SQL above)
    // But handle the case where it might not exist yet
    let mapsCount = 0;
    try {
      const mapsCheck = await client.query('SELECT COUNT(*) as count FROM maps');
      mapsCount = parseInt(String(mapsCheck.rows[0]?.count || '0'), 10);
    } catch (err) {
      const error = err as Error;
      // If table doesn't exist, that's unexpected but we'll skip map insertion
      if (error.message.includes('does not exist')) {
        log.warn('[PostgreSQL] Maps table does not exist, skipping map insertion');
        return;
      }
      throw err; // Re-throw other errors
    }

    if (mapsCount === 0) {
      // Maps table is empty - this is first initialization or after database wipe
      // Fetch fresh maps from GitHub repository: https://github.com/Auto-Tournament/cs2-server-manager/tree/master/map_thumbnails
      // Falls back to hardcoded maps if GitHub fetch fails (e.g., rate limiting)
      log.database(
        '[PostgreSQL] Maps table is empty, fetching and inserting default maps from GitHub...'
      );
      try {
        const defaultMapsSQL = await getDefaultMapsSQL();
        await client.query(defaultMapsSQL);
        log.success('[PostgreSQL] Default maps inserted (from GitHub repository or fallback)');
      } catch (fetchError) {
        const error = fetchError as Error;
        log.error(`[PostgreSQL] Failed to initialize maps: ${error.message}`);
        // Don't throw - fallback maps should have been used, but if that also failed, log and continue
        // The application can still function without maps (they can be added manually or synced later)
        log.warn(
          '[PostgreSQL] Continuing without default maps. Maps can be added manually or synced via /api/maps/sync'
        );
      }
    } else {
      // Maps already exist - skip fetching from wiki (saves time and API calls)
      log.database(
        `[PostgreSQL] Maps table already has ${mapsCount} maps, skipping map insertion`
      );
    }
  } catch (err) {
    const error = err as Error;
    // If it's a map fetch error, we already logged it above, just re-throw
    if (error.message.includes('GitHub') || error.message.includes('maps')) {
      throw err;
    }
    log.warn(`[PostgreSQL] Failed to insert default maps: ${error.message}`);
    // Don't throw for other errors - continue
  }

  // Insert default map pools
  try {
    const defaultMapPoolsSQL = await getDefaultMapPoolsSQL(client);
    await client.query(defaultMapPoolsSQL);
    log.database('[PostgreSQL] Default map pools inserted');
  } catch (err) {
    const error = err as Error;
    log.warn(`[PostgreSQL] Failed to insert default map pools: ${error.message}`);
    // Don't throw - continue
  }
}
