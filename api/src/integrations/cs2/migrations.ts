/**
 * CS2's own schema (`GameIntegration.migrations`, run by
 * config/moduleMigrations.ts). CS2 owns `cs2_servers`, `cs2_maps` and
 * `cs2_map_pools`; core's schema file no longer creates them.
 *
 * Rules, the same as every module migration:
 * - A migration's id and SQL never change once shipped: the platform stores a
 *   checksum and refuses a module whose applied migration was edited. A
 *   change is a new migration appended at the end.
 * - There is no column auto-migrator for these tables. Core's column-adding
 *   pass (`getSchemaColumns`) only covers core's schema, so a new CS2 column
 *   is an `ALTER TABLE cs2_… ADD COLUMN …` migration here.
 *
 * `001-tables` is what a fresh database gets. An install upgraded from 2.x
 * already has these tables under their old names (`servers`, `maps`,
 * `map_pools`): core renames them and records `001-tables` as applied before
 * this module's migrations run (config/cs2TableHandover.ts), so both end in
 * the same schema. That handover also reads the column list from this SQL, so
 * keep each column on its own line in the `CREATE TABLE` bodies.
 *
 * `001-tables` still says `matchzy_*` for six columns of `cs2_servers`, and
 * its comments name the plugin's 2.x name: its SQL is checksummed and never
 * changes. `002-at-columns` renames those columns to `at_*`, on a fresh and an
 * upgraded database alike.
 *
 * `003-catalog-markers` adds what the map sync (maps/mapSync.ts) needs to
 * tell the platform's own maps and pools from an admin's.
 */

import type { ModuleMigration } from '../types';

export const CS2_TABLES_MIGRATION_ID = '001-tables';
export const CS2_AT_COLUMNS_MIGRATION_ID = '002-at-columns';
export const CS2_CATALOG_MARKERS_MIGRATION_ID = '003-catalog-markers';

export const CS2_MIGRATIONS: ReadonlyArray<ModuleMigration> = [
  {
    id: CS2_TABLES_MIGRATION_ID,
    up: `
    -- The game server fleet
    CREATE TABLE IF NOT EXISTS cs2_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      password TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      matchzy_config TEXT, -- JSON blob with per-server MatchZy ConVar overrides
      persistent_config_sent INTEGER, -- Unix timestamp when persistent config was last sent (NULL = never sent)
      plugin_version TEXT, -- MatchZy Enhanced version (e.g., "1.3.6")
      hostname TEXT, -- Server hostname from CS2 (from hostname convar)
      last_seen INTEGER, -- Unix timestamp of last event received (heartbeat)
      status TEXT DEFAULT 'unknown', -- 'online', 'offline', 'unknown'
      cs2_required_version INTEGER, -- If set, server has reported CS2 update required
      cs2_update_phase TEXT, -- 'available' | 'shutdown' (best-effort)
      cs2_update_required_at INTEGER, -- Unix timestamp when update was last reported
      cs2_update_checked_at INTEGER, -- Unix timestamp when CS2 UpToDateCheck was last performed (Steam API)
      cs2_build_id INTEGER, -- Best-effort: CS2 server build ID parsed from the version output
      cs2_version_string TEXT, -- Best-effort: raw/parsed version output (display only)
      cs2_version_fetched_at INTEGER, -- Unix timestamp when cs2_version_string/build_id was last fetched via RCON
      matchzy_db_ok INTEGER, -- Best-effort: MatchZy plugin DB reachable (1/0)
      matchzy_db_type TEXT, -- Best-effort: 'sqlite' | 'mysql'
      matchzy_db_error TEXT, -- Best-effort: last DB error message (if any)
      matchzy_db_last_ok_at INTEGER, -- Unix timestamp when DB was last reported OK
      matchzy_db_last_seen_at INTEGER, -- Unix timestamp when DB health was last reported
      server_can_reach_api_at INTEGER, -- Unix timestamp when server last successfully sent any event to /api/events
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_servers_status_idx ON cs2_servers(status);
    CREATE INDEX IF NOT EXISTS cs2_servers_last_seen_idx ON cs2_servers(last_seen);
    CREATE INDEX IF NOT EXISTS cs2_servers_enabled_idx ON cs2_servers(enabled);

    -- The map catalogue (seeded by the CS2 seed hook when empty)
    CREATE TABLE IF NOT EXISTS cs2_maps (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      image_url TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_maps_id_idx ON cs2_maps(id);

    -- Map pools (the defaults are upserted by the CS2 seed hook)
    CREATE TABLE IF NOT EXISTS cs2_map_pools (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      map_ids TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_map_pools_name_idx ON cs2_map_pools(name);
    CREATE INDEX IF NOT EXISTS cs2_map_pools_default_idx ON cs2_map_pools(is_default);
    CREATE INDEX IF NOT EXISTS cs2_map_pools_enabled_idx ON cs2_map_pools(enabled);
`,
  },
  {
    // 3.0: the plugin is Auto Tournament CS2, and its columns say so.
    id: CS2_AT_COLUMNS_MIGRATION_ID,
    up: `
    ALTER TABLE cs2_servers RENAME COLUMN matchzy_config TO at_config;
    ALTER TABLE cs2_servers RENAME COLUMN matchzy_db_ok TO at_db_ok;
    ALTER TABLE cs2_servers RENAME COLUMN matchzy_db_type TO at_db_type;
    ALTER TABLE cs2_servers RENAME COLUMN matchzy_db_error TO at_db_error;
    ALTER TABLE cs2_servers RENAME COLUMN matchzy_db_last_ok_at TO at_db_last_ok_at;
    ALTER TABLE cs2_servers RENAME COLUMN matchzy_db_last_seen_at TO at_db_last_seen_at;
`,
  },
  {
    // maps.json is the source of the map list and the Active Duty pool
    // (maps/mapSync.ts). The sync may only change what the platform seeded
    // and nobody has edited since: `system_managed = 1`. Maps and pools an
    // admin creates get 0, and an edit through the API sets 0.
    // `cs2_known_maps` is every map id a sync has offered, so a seeded map an
    // admin deleted is not added back at the next start. `cs2_map_catalog`
    // is the one maps.json last applied (its `generatedAt`), so an older copy
    // (the bundled one, offline) never rolls names or Active Duty back.
    //
    // On an existing database: a map counts as seeded when its image is still
    // the cs2-server-manager thumbnail and it was never updated; the one-mode
    // pools do (the old seed rewrote them at every start); Active Duty does
    // when it still holds the old hard-coded list (LEGACY_ACTIVE_DUTY).
    // Every statement can run twice.
    id: CS2_CATALOG_MARKERS_MIGRATION_ID,
    up: `
    ALTER TABLE cs2_maps ADD COLUMN IF NOT EXISTS system_managed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cs2_map_pools ADD COLUMN IF NOT EXISTS system_managed INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS cs2_known_maps (
      id TEXT PRIMARY KEY,
      first_seen_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE TABLE IF NOT EXISTS cs2_map_catalog (
      slot TEXT PRIMARY KEY, -- one row, 'applied'
      generated_at TEXT,
      patch_version TEXT,
      source TEXT,
      synced_at INTEGER
    );

    UPDATE cs2_maps SET system_managed = 1
      WHERE image_url LIKE 'https://raw.githubusercontent.com/%/cs2-server-manager/%/map_thumbnails/%'
        AND updated_at = created_at;

    UPDATE cs2_map_pools SET system_managed = 1
      WHERE name IN ('Defusal only', 'Hostage only', 'Arms Race only')
         OR (name = 'Active Duty'
             AND map_ids = '["de_ancient","de_anubis","de_dust2","de_inferno","de_mirage","de_nuke","de_vertigo"]');

    INSERT INTO cs2_known_maps (id) SELECT id FROM cs2_maps ON CONFLICT (id) DO NOTHING;
`,
  },
];
