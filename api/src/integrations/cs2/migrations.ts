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
 *
 * `004-map-modes` adds a map's type (maps/mapModes.ts).
 *
 * `005-fleet` adds the Ready Up fleet registry (fleet/registry.ts).
 *
 * `006-fleet-match` adds what the platform needs to drive a match over the
 * fleet link (Ready Up's step 3): a server's transport, the live match state
 * (fleet/state.ts), the inbound event log and the answers to the platform's
 * own commands (fleet/inbound.ts, fleet/reliable.ts).
 *
 * `007-fleet-demo-streams` adds the demos Ready Up streams over the fleet link
 * while it records (fleet/demoStream.ts, FLEET.md §12.2).
 */

import type { ModuleMigration } from '../types';

export const CS2_TABLES_MIGRATION_ID = '001-tables';
export const CS2_AT_COLUMNS_MIGRATION_ID = '002-at-columns';
export const CS2_CATALOG_MARKERS_MIGRATION_ID = '003-catalog-markers';
export const CS2_MAP_MODES_MIGRATION_ID = '004-map-modes';
export const CS2_FLEET_MIGRATION_ID = '005-fleet';
export const CS2_FLEET_MATCH_MIGRATION_ID = '006-fleet-match';
export const CS2_FLEET_DEMO_STREAMS_MIGRATION_ID = '007-fleet-demo-streams';

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
  {
    // A map's type (maps/mapModes.ts): defusal, hostage, wingman, armsrace,
    // deathmatch or other; NULL when not known. Existing maps get it from
    // their id prefix here; the next map sync fills the catalogue's own
    // types, and a Workshop map gets it from its Steam tags when added.
    // Every statement can run twice.
    id: CS2_MAP_MODES_MIGRATION_ID,
    up: `
    ALTER TABLE cs2_maps ADD COLUMN IF NOT EXISTS game_mode TEXT;

    UPDATE cs2_maps SET game_mode = 'defusal' WHERE game_mode IS NULL AND id LIKE 'de\\_%';
    UPDATE cs2_maps SET game_mode = 'hostage' WHERE game_mode IS NULL AND id LIKE 'cs\\_%';
    UPDATE cs2_maps SET game_mode = 'armsrace' WHERE game_mode IS NULL AND id LIKE 'ar\\_%';
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
  {
    // Driving a match over the fleet link (Ready Up's
    // docs/fleet-step3-platform-notes.md §2-§3). Every statement can run twice.
    //
    // - cs2_servers.transport: how the platform talks to the server, 'rcon'
    //   (the plugin + RCON path, every server so far) or 'fleet' (a Ready Up
    //   server on the fleet link, cs2_servers.fleet_server_id). One fleet
    //   server backs at most one cs2_servers row.
    // - cs2_match_live_state: the MatchState per match (fleet/state.ts), with
    //   the assignment epoch (fencing), the server's live_rev and the
    //   platform's config_rev. `state` / `map_stats` / `map_rounds` are JSON.
    // - cs2_fleet_events: every reliable server message, written before it is
    //   acked (persist-before-ack), unique per (server, stream id, seq) so a
    //   replay after a lost ack is not stored twice. `processed_at` stays NULL
    //   until the message was applied, so a crash in between is replayed.
    // - cs2_fleet_commands: the platform's match.* / cmd messages and their
    //   one cmd.result (envelope `ref` = the message id). The outbox row goes
    //   at the ack; this one keeps the answer.
    id: CS2_FLEET_MATCH_MIGRATION_ID,
    up: `
    ALTER TABLE cs2_servers ADD COLUMN IF NOT EXISTS transport TEXT NOT NULL DEFAULT 'rcon';
    ALTER TABLE cs2_servers ADD COLUMN IF NOT EXISTS fleet_server_id TEXT REFERENCES cs2_fleet_servers(id) ON DELETE SET NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS cs2_servers_fleet_server_idx ON cs2_servers(fleet_server_id) WHERE fleet_server_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS cs2_match_live_state (
      match_slug TEXT PRIMARY KEY, -- matches.slug = the fleet match_id
      epoch INTEGER NOT NULL DEFAULT 0, -- highest assignment epoch of the match (fencing, FLEET.md §11.4)
      server_id TEXT REFERENCES cs2_fleet_servers(id) ON DELETE SET NULL, -- the server holding that epoch
      live_rev INTEGER NOT NULL DEFAULT 0, -- server-owned; rev of the last applied patch
      config_rev INTEGER NOT NULL DEFAULT 0, -- platform-owned; the match.update CAS base
      state TEXT, -- MatchState JSON; NULL until the first snapshot
      map_stats TEXT, -- MapStats JSON from the last snapshot that had one
      map_rounds TEXT, -- JSON {"<map>": RoundSummary[]} from event.round_end, pruned by rounds_voided
      needs_snapshot INTEGER NOT NULL DEFAULT 0, -- 1 while a rev gap waits for a state.snapshot
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_match_live_state_server_idx ON cs2_match_live_state(server_id);

    CREATE TABLE IF NOT EXISTS cs2_fleet_events (
      id BIGSERIAL PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES cs2_fleet_servers(id) ON DELETE CASCADE,
      stream_id TEXT NOT NULL, -- hello.stream.id
      seq INTEGER NOT NULL,
      message_id TEXT NOT NULL, -- envelope id (ULID)
      type TEXT NOT NULL,
      match_slug TEXT, -- payload.match_id, when there is one
      epoch INTEGER, -- envelope epoch
      rev INTEGER, -- payload.rev (state.patch, event.*)
      ref TEXT, -- envelope ref (cmd.result: the platform message it answers)
      message TEXT NOT NULL, -- the envelope as JSON
      received_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      processed_at INTEGER, -- NULL until applied (state store, normalizer, command answers)
      error TEXT -- why applying it failed, if it did
    );

    CREATE UNIQUE INDEX IF NOT EXISTS cs2_fleet_events_stream_seq_idx ON cs2_fleet_events(server_id, stream_id, seq);
    CREATE INDEX IF NOT EXISTS cs2_fleet_events_match_idx ON cs2_fleet_events(match_slug, id);
    CREATE INDEX IF NOT EXISTS cs2_fleet_events_pending_idx ON cs2_fleet_events(server_id, id) WHERE processed_at IS NULL;

    CREATE TABLE IF NOT EXISTS cs2_fleet_commands (
      message_id TEXT PRIMARY KEY, -- envelope id; cmd.result.ref
      server_id TEXT NOT NULL REFERENCES cs2_fleet_servers(id) ON DELETE CASCADE,
      seq INTEGER, -- outbox seq, once appended
      type TEXT NOT NULL, -- match.assign | match.update | match.unassign | cmd
      match_slug TEXT,
      epoch INTEGER,
      name TEXT, -- cmd name
      status TEXT NOT NULL DEFAULT 'pending', -- pending | ok | rejected | failed | expired
      error_code TEXT,
      result TEXT, -- cmd.result payload JSON
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      answered_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_commands_match_idx ON cs2_fleet_commands(match_slug, created_at);
    CREATE INDEX IF NOT EXISTS cs2_fleet_commands_server_idx ON cs2_fleet_commands(server_id, status);
`,
  },
  {
    // Demos streamed over the fleet link while they record (FLEET.md §12.2,
    // fleet/demoStream.ts). Every statement can run twice.
    //
    // - cs2_fleet_demo_streams: one row per demo_id (the server's ULID). The
    //   bytes go to `part_path` (under DATA_DIR/demos, relative) at the offsets
    //   the chunks name; `received_offset` is how many bytes are stored
    //   contiguously from 0 (what demo.ack answers). After demo.end matched
    //   size + sha256 the file moves to `path` (demos/<match>/map<N>/<file>, the
    //   same tree HTTP uploads use) and the match / map rows point at it.
    //   `map_number` is the platform's (0-based). A row that is not complete
    //   and has not moved for FLEET_DEMO_STREAM_EXPIRE_DAYS is dropped with its
    //   part file.
    id: CS2_FLEET_DEMO_STREAMS_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_fleet_demo_streams (
      demo_id TEXT PRIMARY KEY, -- demo.begin demo_id (ULID, generated by the server)
      server_id TEXT NOT NULL, -- cs2_fleet_servers.id that streams it (no key: the demo outlives the server)
      match_slug TEXT NOT NULL, -- matches.slug = the fleet match_id
      map_number INTEGER NOT NULL, -- platform map number, 0-based (fleet map_number - 1)
      epoch INTEGER, -- envelope epoch of the demo.begin: the assignment it belongs to
      file TEXT NOT NULL, -- the .dem basename on the server
      chunk_size INTEGER NOT NULL,
      recording INTEGER NOT NULL DEFAULT 1, -- 1 while the server said the file may still grow
      part_path TEXT NOT NULL, -- the file being received, relative to DATA_DIR/demos
      path TEXT, -- the verified file, relative to DATA_DIR/demos (set when complete)
      received_offset BIGINT NOT NULL DEFAULT 0, -- bytes stored contiguously from 0
      size BIGINT, -- final size (demo.end), once verified
      sha256 TEXT, -- of the final file, hex, once verified
      state TEXT NOT NULL DEFAULT 'receiving', -- receiving | complete | rejected
      error TEXT, -- rejected: the demo.ack error code (too_large)
      checksum_failures INTEGER NOT NULL DEFAULT 0,
      started_at BIGINT, -- recording start, unix ms
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_demo_streams_match_idx ON cs2_fleet_demo_streams(match_slug, map_number);
    CREATE INDEX IF NOT EXISTS cs2_fleet_demo_streams_state_idx ON cs2_fleet_demo_streams(state, updated_at);
`,
  },
];
