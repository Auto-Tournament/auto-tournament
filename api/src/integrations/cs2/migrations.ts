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
 */

import type { ModuleMigration } from '../types';

export const CS2_TABLES_MIGRATION_ID = '001-tables';
export const CS2_AT_COLUMNS_MIGRATION_ID = '002-at-columns';
export const CS2_FLEET_MIGRATION_ID = '003-fleet';

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
    // The Ready Up fleet registry (FLEET.md §4, §19.2 items 1-2). Module
    // tables must start with `cs2_`, so FLEET.md's `fleet_*` tables are
    // `cs2_fleet_*` here. `tenant_id` is reserved (D4) and always 'default'.
    // Times are Unix seconds like the rest of the schema.
    id: CS2_FLEET_MIGRATION_ID,
    up: `
    -- Enrolled (or, for a one-time code, pending) Ready Up servers
    CREATE TABLE IF NOT EXISTS cs2_fleet_servers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      install_id TEXT, -- random id Ready Up writes once; NULL while pending
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'enrolled' | 'revoked'
      enrolled_via TEXT, -- 'code' | 'key'
      enrollment_key_id TEXT,
      availability TEXT, -- from hello: available | busy | draining | error
      versions TEXT, -- JSON, from hello (or enroll)
      capabilities TEXT, -- JSON array, from hello
      host TEXT, -- JSON {hostname, game_port, tv_port, public_addr, status_port}
      health TEXT, -- JSON, the last ping's health
      selftest TEXT, -- JSON, from hello
      protocol INTEGER, -- negotiated protocol major
      boot_id TEXT,
      session_id TEXT,
      online INTEGER NOT NULL DEFAULT 0,
      connected_at INTEGER,
      last_seen INTEGER,
      rx_stream_id TEXT, -- the server's outbound stream id (hello.stream.id)
      rx_seq INTEGER NOT NULL DEFAULT 0, -- highest contiguous server seq processed
      tx_seq INTEGER NOT NULL DEFAULT 0, -- last seq the platform assigned
      tx_acked INTEGER NOT NULL DEFAULT 0, -- highest platform seq the server acked
      rotate_requested_at INTEGER, -- an admin asked for a new token while it was offline
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS cs2_fleet_servers_install_idx ON cs2_fleet_servers(tenant_id, install_id);
    CREATE INDEX IF NOT EXISTS cs2_fleet_servers_status_idx ON cs2_fleet_servers(status);

    -- Server tokens rus_<id>_<secret>: only sha256(secret) is stored
    CREATE TABLE IF NOT EXISTS cs2_fleet_tokens (
      id TEXT PRIMARY KEY, -- the <id> part
      tenant_id TEXT NOT NULL DEFAULT 'default',
      server_id TEXT NOT NULL REFERENCES cs2_fleet_servers(id) ON DELETE CASCADE,
      secret_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      last_used_at INTEGER,
      rotated_from TEXT, -- the token this one replaces
      expires_at INTEGER, -- set when superseded by a rotation (old_valid_until)
      activated_at INTEGER, -- a rotated token: when the server confirmed it (auth.rotated or used)
      revoked_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_tokens_server_idx ON cs2_fleet_tokens(server_id);

    -- One-time enrollment codes RUE-XXXX-XXXX-XXXX-XXXX (hashed, single use)
    CREATE TABLE IF NOT EXISTS cs2_fleet_enrollment_codes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      code_hash TEXT NOT NULL UNIQUE,
      server_id TEXT NOT NULL REFERENCES cs2_fleet_servers(id) ON DELETE CASCADE,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_enrollment_codes_server_idx ON cs2_fleet_enrollment_codes(server_id);

    -- Reusable fleet enrollment keys rfk_<id>_<secret> (hashed)
    CREATE TABLE IF NOT EXISTS cs2_fleet_enrollment_keys (
      id TEXT PRIMARY KEY, -- the <id> part
      tenant_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      name_prefix TEXT,
      max_servers INTEGER,
      expires_at INTEGER,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      last_used_at INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_at INTEGER,
      revoked_at INTEGER
    );

    -- The platform's outbound stream per server: reliable messages kept until acked (FLEET.md §6.4)
    CREATE TABLE IF NOT EXISTS cs2_fleet_outbox (
      server_id TEXT NOT NULL REFERENCES cs2_fleet_servers(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL, -- the envelope as JSON (secrets are never stored here)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      expires_at INTEGER,
      PRIMARY KEY (server_id, seq)
    );
`,
  },
];
