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
 * `007-round-backups` adds the round backup store (fleet/backups.ts): the
 * backups Ready Up sends inline (`event.backup`) and the audit log of round
 * restores (fleet/restore.ts).
 *
 * `008-fleet-demo-streams` adds the demos Ready Up streams over the fleet link
 * while it records (fleet/demoStream.ts, FLEET.md §12.2).
 *
 * `009-fleet-hosts` adds the host channel (FLEET.md §18): csm host agents,
 * their tokens, codes, outbound stream, commands and health events
 * (fleet/hosts/registry.ts), and ties per-machine fleet keys to their host.
 *
 * `010-fleet-driver` adds what the fleet driver (fleet/driver.ts) keeps per
 * assignment: the match's connect password and the config last sent (the
 * base for `match.update`), and the audit log of admin `exec` commands.
 *
 * `011-fleet-server-prefs` adds what the platform pushes to Ready Up servers
 * outside a match (fleet/push/): the fleet-wide lists with their revs
 * (admins.set, server.config) and each server's settings overrides,
 * whitelist / practice / plugins choices and what was last pushed.
 *
 * `012-fleet-connect-address` adds where players connect to a Ready Up server
 * (fleet/address.ts): the fleet link's peer address and whether an admin set
 * the linked row's host / port by hand.
 *
 * `013-fleet-failover` adds failover proposals (fleet/failover.ts, FLEET.md
 * §11): a Ready Up server that died or hung mid-match, the spare server and
 * round backup proposed, and what the admin (or auto-failover) decided.
 *
 * `014-fleet-autoscale` adds the automatic scaler's activity log
 * (fleet/autoscale/): each start, stop, create and link it did, and why. Its
 * settings are the 'autoscale' row of `cs2_fleet_lists`.
 *
 * `015-fleet-plugins-state` keeps what a Ready Up server said about its
 * plugins in its last hello (`plugins_state`: installed, disabled), for the
 * plugin picker's "not installed" warning (fleet/push/pluginSets.ts). The
 * fleet default plugin set is the 'plugins_default' row of `cs2_fleet_lists`.
 */

import type { ModuleMigration } from '../types';

export const CS2_TABLES_MIGRATION_ID = '001-tables';
export const CS2_AT_COLUMNS_MIGRATION_ID = '002-at-columns';
export const CS2_CATALOG_MARKERS_MIGRATION_ID = '003-catalog-markers';
export const CS2_MAP_MODES_MIGRATION_ID = '004-map-modes';
export const CS2_FLEET_MIGRATION_ID = '005-fleet';
export const CS2_FLEET_MATCH_MIGRATION_ID = '006-fleet-match';
export const CS2_ROUND_BACKUPS_MIGRATION_ID = '007-round-backups';
export const CS2_FLEET_DEMO_STREAMS_MIGRATION_ID = '008-fleet-demo-streams';
export const CS2_FLEET_HOSTS_MIGRATION_ID = '009-fleet-hosts';
export const CS2_FLEET_DRIVER_MIGRATION_ID = '010-fleet-driver';
export const CS2_FLEET_SERVER_PREFS_MIGRATION_ID = '011-fleet-server-prefs';
export const CS2_FLEET_CONNECT_ADDRESS_MIGRATION_ID = '012-fleet-connect-address';
export const CS2_FLEET_FAILOVER_MIGRATION_ID = '013-fleet-failover';
export const CS2_FLEET_AUTOSCALE_MIGRATION_ID = '014-fleet-autoscale';
export const CS2_FLEET_PLUGINS_STATE_MIGRATION_ID = '015-fleet-plugins-state';
export const CS2_SERVER_TOURNAMENT_USE_MIGRATION_ID = '016-server-tournament-use';
export const CS2_SERVER_SKINS_MIGRATION_ID = '017-server-skins';
export const CS2_SKINS_MIGRATION_ID = '018-skins';
export const CS2_PLAYER_MAP_STATS_MIGRATION_ID = '019-player-map-stats';
export const CS2_DEMO_ANALYSIS_MIGRATION_ID = '020-demo-analysis';
export const CS2_DEMO_ANALYSIS_V2_MIGRATION_ID = '021-demo-analysis-v2';
export const CS2_MAP_RADARS_MIGRATION_ID = '022-map-radars';
export const CS2_HIGHLIGHTS_MIGRATION_ID = '023-highlights';
export const CS2_HIGHLIGHT_REELS_MIGRATION_ID = '024-highlight-reels';
export const CS2_MATCH_REELS_MIGRATION_ID = '025-match-reels';
export const CS2_HIGHLIGHTS_PLAYER_MIGRATION_ID = '026-highlights-player';
export const CS2_REEL_STARTS_MIGRATION_ID = '027-reel-starts';
export const CS2_TEAM_REELS_MIGRATION_ID = '028-team-reels';

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
    // 3.0: the plugin is MatchZy Enhanced, and its columns say so.
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
    // Round backups (FLEET.md §12.1, §12.3; Ready Up's
    // docs/fleet-step3-platform-notes.md §7). Every statement can run twice.
    //
    // - cs2_match_round_backups: one CS2 round backup file per (match, map,
    //   round), the newest one Ready Up sent (a round replayed after a restore
    //   comes again with other content and replaces it). `data` is the whole
    //   file, base64, as it goes back out in `cmd restore_round` / a resume.
    //   Backups are 10-60 KB (at most 4 MiB by the schema), so they live in
    //   the database rather than on DATA_DIR: a failover never depends on the
    //   API's disk. `map_number` is the fleet's (1-based). `superseded_at` is
    //   set when a restore voided the rounds after it.
    // - cs2_match_round_backup_parts: parts of a file sent in several frames
    //   (`part` / `parts`), until the last one arrives and the file is checked.
    // - cs2_match_round_restores: the audit log of "restore to round N": who,
    //   which backup, over which transport, the fleet command and its answer.
    id: CS2_ROUND_BACKUPS_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_match_round_backups (
      id BIGSERIAL PRIMARY KEY,
      match_slug TEXT NOT NULL, -- matches.slug = the fleet match_id
      map_number INTEGER NOT NULL, -- fleet map number, 1-based
      round INTEGER NOT NULL, -- the round the backup starts (1-based)
      epoch INTEGER, -- the assignment that sent it
      server_id TEXT, -- cs2_fleet_servers.id that sent it (no key: the history outlives the server)
      file TEXT NOT NULL, -- CS2's file name on that server
      size INTEGER NOT NULL, -- bytes of the file
      sha256 TEXT NOT NULL, -- of the file, hex
      score_team1 INTEGER NOT NULL DEFAULT 0, -- map score at the start of the round
      score_team2 INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL, -- the file, base64
      superseded_at INTEGER, -- a restore voided this round (it is from the abandoned timeline)
      stored_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS cs2_match_round_backups_key_idx ON cs2_match_round_backups(match_slug, map_number, round);
    CREATE INDEX IF NOT EXISTS cs2_match_round_backups_stored_idx ON cs2_match_round_backups(stored_at);

    CREATE TABLE IF NOT EXISTS cs2_match_round_backup_parts (
      match_slug TEXT NOT NULL,
      map_number INTEGER NOT NULL,
      round INTEGER NOT NULL,
      sha256 TEXT NOT NULL, -- of the whole file: parts of another version never mix
      part INTEGER NOT NULL, -- 1-based
      parts INTEGER NOT NULL,
      data TEXT NOT NULL, -- this part, base64
      received_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (match_slug, map_number, round, sha256, part)
    );

    CREATE TABLE IF NOT EXISTS cs2_match_round_restores (
      id TEXT PRIMARY KEY, -- ULID; sent as cmd.audit_id
      match_slug TEXT NOT NULL,
      map_number INTEGER NOT NULL, -- fleet map number, 1-based
      round INTEGER NOT NULL,
      transport TEXT NOT NULL, -- 'fleet' | 'rcon'
      server_id TEXT, -- fleet server id or cs2_servers.id
      epoch INTEGER,
      backup_id BIGINT, -- cs2_match_round_backups.id (fleet)
      backup_sha256 TEXT,
      inline INTEGER NOT NULL DEFAULT 0, -- 1 = the backup went inline in the command
      command_id TEXT, -- cs2_fleet_commands.message_id (fleet)
      actor TEXT, -- requestActorId: Steam ID or token:<label>
      status TEXT NOT NULL DEFAULT 'pending', -- pending | ok | rejected | failed | expired
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      answered_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_match_round_restores_match_idx ON cs2_match_round_restores(match_slug, created_at);
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
  {
    // The host channel (FLEET.md §18, D17): csm on each machine as a host
    // agent. Mirrors the server tables of 005 with a separate identity:
    // - cs2_fleet_hosts: one row per machine (machine_id = /etc/machine-id),
    //   pending until csm enrolls with the one-time code; the last
    //   host.inventory as JSON; presence and the stream state for resume.
    // - cs2_fleet_host_tokens: rhs_<id>_<secret>, only sha256(secret) stored.
    // - cs2_fleet_host_enrollment_codes: one-time codes for "Add machine".
    // - cs2_fleet_host_outbox: the platform's reliable stream per host.
    // - cs2_fleet_host_commands: every command sent to a host, its progress
    //   and its one host.result; `forced_by` / `force_reason` are the audit
    //   row for a disruptive action during a match (§18.2).
    // - cs2_fleet_host_events: host.health reports, unique per stream + seq.
    // - cs2_fleet_enrollment_keys.host_id / command_id: keys the platform
    //   minted for a server.create on that host (FLEET.md §4.1 B).
    // Every statement can run twice.
    id: CS2_FLEET_HOSTS_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_fleet_hosts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      machine_id TEXT, -- /etc/machine-id; NULL while pending
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'enrolled' | 'revoked'
      enrolled_via TEXT, -- 'code' | 'key'
      enrollment_key_id TEXT,
      hostname TEXT,
      os TEXT,
      csm_version TEXT,
      capabilities TEXT, -- JSON array, from hello
      inventory TEXT, -- JSON, the last host.inventory
      inventory_at INTEGER,
      protocol INTEGER,
      boot_id TEXT,
      session_id TEXT,
      online INTEGER NOT NULL DEFAULT 0,
      connected_at INTEGER,
      last_seen INTEGER,
      rx_stream_id TEXT,
      rx_seq INTEGER NOT NULL DEFAULT 0,
      tx_seq INTEGER NOT NULL DEFAULT 0,
      tx_acked INTEGER NOT NULL DEFAULT 0,
      rotate_requested_at INTEGER,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS cs2_fleet_hosts_machine_idx ON cs2_fleet_hosts(tenant_id, machine_id);

    CREATE TABLE IF NOT EXISTS cs2_fleet_host_tokens (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      host_id TEXT NOT NULL REFERENCES cs2_fleet_hosts(id) ON DELETE CASCADE,
      secret_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      last_used_at INTEGER,
      rotated_from TEXT,
      expires_at INTEGER,
      activated_at INTEGER,
      revoked_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_host_tokens_host_idx ON cs2_fleet_host_tokens(host_id);

    CREATE TABLE IF NOT EXISTS cs2_fleet_host_enrollment_codes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      code_hash TEXT NOT NULL UNIQUE,
      host_id TEXT NOT NULL REFERENCES cs2_fleet_hosts(id) ON DELETE CASCADE,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_host_enrollment_codes_host_idx ON cs2_fleet_host_enrollment_codes(host_id);

    CREATE TABLE IF NOT EXISTS cs2_fleet_host_outbox (
      host_id TEXT NOT NULL REFERENCES cs2_fleet_hosts(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL, -- the envelope as JSON (secrets are minted at send time, never stored)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      expires_at INTEGER,
      PRIMARY KEY (host_id, seq)
    );

    CREATE TABLE IF NOT EXISTS cs2_fleet_host_commands (
      message_id TEXT PRIMARY KEY, -- envelope id; host.result ref
      host_id TEXT NOT NULL REFERENCES cs2_fleet_hosts(id) ON DELETE CASCADE,
      seq INTEGER,
      type TEXT NOT NULL,
      server TEXT, -- the server-N it targets, when one
      payload TEXT NOT NULL, -- JSON, without secrets
      status TEXT NOT NULL DEFAULT 'pending', -- pending | ok | rejected | failed
      error_code TEXT,
      error_message TEXT,
      output TEXT,
      progress_step TEXT,
      progress_pct REAL,
      progress_at INTEGER,
      issued_by TEXT,
      forced_by TEXT, -- audit: set when the admin confirmed a disruptive action during a match
      force_reason TEXT,
      meta TEXT, -- JSON the platform keeps with the command (server.create: servers before it, the follow-up)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      answered_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_host_commands_host_idx ON cs2_fleet_host_commands(host_id, created_at);

    CREATE TABLE IF NOT EXISTS cs2_fleet_host_events (
      id BIGSERIAL PRIMARY KEY,
      host_id TEXT NOT NULL REFERENCES cs2_fleet_hosts(id) ON DELETE CASCADE,
      stream_id TEXT,
      seq INTEGER, -- NULL when csm sent it ephemeral
      server TEXT NOT NULL,
      event TEXT NOT NULL, -- crashed | exited | hung | recovered | restarted
      exit_code INTEGER,
      detail TEXT,
      received_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS cs2_fleet_host_events_stream_seq_idx ON cs2_fleet_host_events(host_id, stream_id, seq) WHERE seq IS NOT NULL;
    CREATE INDEX IF NOT EXISTS cs2_fleet_host_events_host_idx ON cs2_fleet_host_events(host_id, id);

    ALTER TABLE cs2_fleet_enrollment_keys ADD COLUMN IF NOT EXISTS host_id TEXT REFERENCES cs2_fleet_hosts(id) ON DELETE SET NULL;
    ALTER TABLE cs2_fleet_enrollment_keys ADD COLUMN IF NOT EXISTS command_id TEXT;
`,
  },
  {
    // The fleet driver (fleet/driver.ts). Every statement can run twice.
    //
    // - cs2_fleet_assignments: one row per match on a fleet server: the
    //   epoch and server it was last assigned to, the sv_password generated
    //   for it (FLEET.md D9: shown to the roster and admins only), and the
    //   match.assign config the server acked (JSON), which `match.update`
    //   diffs against. `ended_at` is set when the platform unassigned it.
    // - cs2_fleet_audit: root-only `cmd exec` (FLEET.md §7.4, D10). The row is
    //   written before the command is sent and its id goes out as
    //   `audit_id`; the answer is stored on it.
    id: CS2_FLEET_DRIVER_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_fleet_assignments (
      match_slug TEXT PRIMARY KEY, -- matches.slug = the fleet match_id
      epoch INTEGER NOT NULL,
      server_id TEXT REFERENCES cs2_fleet_servers(id) ON DELETE SET NULL, -- fleet server
      cs2_server_id TEXT, -- the linked cs2_servers row (matches.server_id)
      password TEXT NOT NULL, -- sv_password for this assignment
      config TEXT, -- match.assign config JSON the server acked (password removed)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      ended_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_assignments_server_idx ON cs2_fleet_assignments(server_id);

    CREATE TABLE IF NOT EXISTS cs2_fleet_audit (
      id TEXT PRIMARY KEY, -- ULID; cmd.audit_id
      actor TEXT, -- requestActorId: Steam ID or token:<label>
      server_id TEXT, -- fleet server
      match_slug TEXT,
      command TEXT NOT NULL, -- the exec line as sent
      message_id TEXT, -- the cmd envelope id (cs2_fleet_commands)
      status TEXT NOT NULL DEFAULT 'pending', -- pending | ok | rejected | failed | expired | timeout
      error_code TEXT,
      output TEXT, -- cmd.result.output (console lines, <= 8 KiB)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      answered_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_audit_server_idx ON cs2_fleet_audit(server_id, created_at);
`,
  },
  {
    // Server-level pushes (FLEET.md §7.5, cmd settings.set / whitelist.set /
    // practice.set / plugins.set of §7.4). Every statement can run twice.
    //
    // - cs2_fleet_lists: one row per fleet-wide list the platform versions.
    //   'admins': the admins.set rev, the hash of the list it was built from
    //   and `data` = the extra in-game admins (JSON). 'server_config': the
    //   server.config rev (bumped on any settings change) and `data` = the
    //   fleet default settings (JSON).
    // - cs2_fleet_server_prefs: per server, its settings override (JSON, on
    //   top of the fleet default), the whitelist / practice / plugins choices
    //   last sent, and `pushed` (JSON): what went out when (rev, seq, command
    //   id) so the UI can show acked / answered.
    id: CS2_FLEET_SERVER_PREFS_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_fleet_lists (
      name TEXT PRIMARY KEY, -- 'admins' | 'server_config'
      rev INTEGER NOT NULL DEFAULT 0,
      hash TEXT, -- sha256 of what the rev was built from
      data TEXT, -- JSON; see above
      updated_by TEXT,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE TABLE IF NOT EXISTS cs2_fleet_server_prefs (
      server_id TEXT PRIMARY KEY REFERENCES cs2_fleet_servers(id) ON DELETE CASCADE,
      settings TEXT, -- JSON override of the fleet default settings
      whitelist TEXT, -- JSON {enabled, steamids}
      practice INTEGER, -- 1 on, 0 off, NULL never set
      plugins TEXT, -- JSON {enable, disable}
      pushed TEXT, -- JSON {admins, server_config, settings, whitelist, practice, plugins}
      updated_by TEXT,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );
`,
  },
  {
    // The connect address of Ready Up servers (fleet/address.ts, FLEET.md
    // §6.1). Every statement can run twice.
    //
    // - cs2_fleet_servers.peer_addr: the client address of its last hello
    //   (or enrollment), after the trusted proxy hops.
    // - cs2_servers.host_override: 1 when an admin set host / port by hand
    //   (the link route, the address route, the server editor, or linking an
    //   existing RCON row); a later hello then leaves them alone.
    id: CS2_FLEET_CONNECT_ADDRESS_MIGRATION_ID,
    up: `
    ALTER TABLE cs2_fleet_servers ADD COLUMN IF NOT EXISTS peer_addr TEXT;
    ALTER TABLE cs2_servers ADD COLUMN IF NOT EXISTS host_override INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    // Fleet failover (fleet/failover.ts, FLEET.md §11). Every statement can
    // run twice.
    //
    // - cs2_fleet_failovers: one row per failover, and its audit record:
    //   which server of which epoch went down and why, the server and round
    //   backup the match moved (or resumed in place) with, who decided, and
    //   what became of it (moved with the new epoch, dismissed, withdrawn when
    //   the server came back). At most one open (or moving) row per match. The settings (auto-failover,
    //   reserve) are the 'failover' row of cs2_fleet_lists
    //   (`data` = {"auto": boolean, "reserve": number | null}).
    id: CS2_FLEET_FAILOVER_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_fleet_failovers (
      id TEXT PRIMARY KEY, -- ULID
      match_slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', -- open | moving | moved | dismissed | withdrawn
      reason TEXT NOT NULL, -- offline | hung | exited
      detail TEXT,
      phase TEXT, -- the match phase when it went down
      from_server_id TEXT, -- fleet server that went down
      from_cs2_server_id TEXT,
      from_epoch INTEGER NOT NULL,
      down_since INTEGER, -- unix s
      target_cs2_server_id TEXT, -- the proposed spare (linked cs2_servers row)
      map_number INTEGER NOT NULL, -- fleet map number (1-based)
      round INTEGER NOT NULL DEFAULT 0, -- backup round; 0 = the map restarts from warmup
      backup_id BIGINT,
      backup_sha256 TEXT,
      score TEXT, -- JSON map score at the start of the round
      state TEXT, -- JSON {state, mapStats}: the platform's last MatchState of the failed epoch
      auto INTEGER NOT NULL DEFAULT 0, -- 1 = accepted by auto-failover
      new_epoch INTEGER,
      new_cs2_server_id TEXT,
      command_id TEXT, -- the match.assign envelope id
      inline INTEGER NOT NULL DEFAULT 0, -- 1 = backup sent inline, 0 = backup_ref or none
      decided_by TEXT,
      decided_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_failovers_match_idx ON cs2_fleet_failovers(match_slug, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS cs2_fleet_failovers_open_idx ON cs2_fleet_failovers(match_slug) WHERE status IN ('open', 'moving');
`,
  },
  {
    // Automatic server scaling (fleet/autoscale/). Every statement can run
    // twice.
    //
    // - cs2_fleet_autoscale_events: what the scaler did and why (the Servers
    //   page's activity list): start / stop / create / link, or a note when
    //   it could not do what was needed. The scaler keeps the newest rows.
    //   The settings are the 'autoscale' row of cs2_fleet_lists (`data` =
    //   {"enabled", "leadTimeSeconds", "cooldownSeconds", "maxServersPerHost"}).
    id: CS2_FLEET_AUTOSCALE_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_fleet_autoscale_events (
      id SERIAL PRIMARY KEY,
      at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      action TEXT NOT NULL, -- start | stop | create | link | note
      host_id TEXT, -- cs2_fleet_hosts.id (no key: a removed machine keeps its history)
      host_name TEXT,
      server TEXT, -- csm's server-N
      fleet_server_id TEXT,
      server_name TEXT,
      reason TEXT NOT NULL,
      command_id TEXT, -- cs2_fleet_host_commands.message_id
      outcome TEXT NOT NULL DEFAULT 'sent', -- sent | linked | refused | failed | note
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS cs2_fleet_autoscale_events_at_idx ON cs2_fleet_autoscale_events(at);
`,
  },
  {
    id: CS2_FLEET_PLUGINS_STATE_MIGRATION_ID,
    up: `
    -- hello.plugins_state: the plugins a Ready Up server has (installed) and keeps off (disabled)
    ALTER TABLE cs2_fleet_servers ADD COLUMN IF NOT EXISTS plugins_state TEXT;
`,
  },
  {
    // 0 = a practice/community server: allocation, auto-scaling and failover
    // never hand it tournament matches. It still counts toward the license.
    id: CS2_SERVER_TOURNAMENT_USE_MIGRATION_ID,
    up: `
    ALTER TABLE cs2_servers ADD COLUMN IF NOT EXISTS tournament_use INTEGER NOT NULL DEFAULT 1;
`,
  },
  {
    // 1 = the platform's virtual skins go to this server (fleet/push/skins.ts).
    // Off by default: an admin turns it on per server.
    id: CS2_SERVER_SKINS_MIGRATION_ID,
    up: `
    ALTER TABLE cs2_servers ADD COLUMN IF NOT EXISTS skins INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    // Virtual skins (skins/skinService.ts), which core created until they
    // moved into this module. An instance that ran core's version already has
    // the tables; the ALTER is for one from before the variant column.
    id: CS2_SKINS_MIGRATION_ID,
    up: `
    -- Virtual skins (owned on the platform; Ready Up servers with skins on
    -- show the equipped ones): what each player owns, rolled like a case (float and pattern), and where it came from.
    CREATE TABLE IF NOT EXISTS cs2_player_skins (
      id SERIAL PRIMARY KEY,
      player_uid UUID NOT NULL, -- players.uid
      weapon TEXT NOT NULL, -- 'weapon_ak47', 'weapon_knife_karambit', 'sporty_gloves', ... (csm skins.json)
      weapon_name TEXT NOT NULL,
      paint_kit INTEGER NOT NULL,
      name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      image TEXT NOT NULL, -- file name under csm's skin_images
      float_value REAL NOT NULL,
      pattern INTEGER NOT NULL,
      source TEXT NOT NULL, -- 'matchmaking' | 'tournament' | 'admin'
      source_label TEXT, -- the map, or the tournament's name
      source_ref TEXT, -- the match slug, or 'tournament:<id>:<name>'
      place INTEGER, -- tournament placement (1, 2, 3)
      variant TEXT, -- a phase of a multi-phase finish: 'Sapphire', 'Phase 2', ... (null for most skins)
      seen BOOLEAN NOT NULL DEFAULT FALSE, -- the owner has seen the "new skin" reveal
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS cs2_player_skins_owner_idx ON cs2_player_skins(player_uid);
    CREATE INDEX IF NOT EXISTS cs2_player_skins_source_ref_idx ON cs2_player_skins(source_ref);

    -- The skin equipped per slot (a weapon, or 'knife' / 'gloves').
    CREATE TABLE IF NOT EXISTS cs2_player_loadout (
      player_uid UUID NOT NULL,
      slot TEXT NOT NULL,
      skin_id INTEGER NOT NULL REFERENCES cs2_player_skins(id) ON DELETE CASCADE,
      PRIMARY KEY (player_uid, slot)
    );

    -- The profile's skin showcase: up to eight skins in the owner's order, some shown big.
    CREATE TABLE IF NOT EXISTS cs2_player_skin_showcase (
      player_uid UUID PRIMARY KEY,
      items TEXT NOT NULL DEFAULT '[]' -- JSON [{ skinId, big }]
    );
    ALTER TABLE cs2_player_skins ADD COLUMN IF NOT EXISTS variant TEXT;
`,
  },
  {
    // The numbers a Ready Up server sends at map end that player_match_stats
    // has no column for (fleet/mapStats.ts): openings, clutches, multi-kills,
    // flashes on teammates, and rounds per side. One row per player per map;
    // a replayed map_result overwrites its row.
    id: CS2_PLAYER_MAP_STATS_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_player_map_stats (
      match_slug TEXT NOT NULL,
      map_number INTEGER NOT NULL, -- 0-based, as match_map_results
      player_id TEXT NOT NULL, -- Steam ID 64
      map_name TEXT,
      team TEXT NOT NULL, -- 'team1' | 'team2'
      rounds_played INTEGER NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      assists INTEGER NOT NULL DEFAULT 0,
      damage INTEGER NOT NULL DEFAULT 0,
      headshot_kills INTEGER NOT NULL DEFAULT 0,
      kast_rounds INTEGER NOT NULL DEFAULT 0,
      entry_kills INTEGER NOT NULL DEFAULT 0, -- opening kills, both sides
      entry_deaths INTEGER NOT NULL DEFAULT 0,
      trade_kills INTEGER NOT NULL DEFAULT 0,
      clutches_won INTEGER NOT NULL DEFAULT 0, -- 1vX rounds won, any X
      enemies_flashed INTEGER NOT NULL DEFAULT 0,
      friendlies_flashed INTEGER NOT NULL DEFAULT 0,
      multi_1k INTEGER NOT NULL DEFAULT 0, -- rounds with exactly one kill
      multi_2k INTEGER NOT NULL DEFAULT 0,
      multi_3k INTEGER NOT NULL DEFAULT 0,
      multi_4k INTEGER NOT NULL DEFAULT 0,
      multi_5k INTEGER NOT NULL DEFAULT 0,
      ct_rounds INTEGER NOT NULL DEFAULT 0, -- rounds played on CT
      ct_rounds_won INTEGER NOT NULL DEFAULT 0,
      t_rounds INTEGER NOT NULL DEFAULT 0,
      t_rounds_won INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (match_slug, map_number, player_id)
    );

    CREATE INDEX IF NOT EXISTS cs2_player_map_stats_player_idx ON cs2_player_map_stats(player_id);
`,
  },
  {
    // Demo analysis (demos/jobs.ts): the worker container reads each stored
    // demo after the match and fills in what live events don't carry.
    id: CS2_DEMO_ANALYSIS_MIGRATION_ID,
    up: `
    -- What only the demo gives, next to the map stats Ready Up sends.
    -- source: 'fleet' (Ready Up's map_result) or 'demo' (only the demo had it).
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'fleet';
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS demo_analyzed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS traded_deaths INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS clutches_played INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS utility_damage INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS money_spent INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS shots INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS hits INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS spray_shots INTEGER NOT NULL DEFAULT 0; -- 4th bullet of a spray on
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS spray_hits INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS crosshair_angle_sum REAL NOT NULL DEFAULT 0; -- degrees off the head before a duel's first shot, summed
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS crosshair_samples INTEGER NOT NULL DEFAULT 0;

    -- One job per stored demo map; the worker claims, analyzes and reports.
    CREATE TABLE IF NOT EXISTS cs2_demo_jobs (
      match_slug TEXT NOT NULL,
      map_number INTEGER NOT NULL, -- 0-based
      demo_path TEXT NOT NULL, -- under DEMOS_DIR
      status TEXT NOT NULL DEFAULT 'pending', -- pending | running | done | failed
      attempts INTEGER NOT NULL DEFAULT 0,
      worker TEXT,
      claimed_at INTEGER,
      finished_at INTEGER,
      error TEXT,
      analyzer_version INTEGER,
      map_name TEXT,
      rounds TEXT, -- JSON RoundInfo[]
      kills TEXT, -- JSON KillInfo[]
      replay_path TEXT, -- gzip JSON under DATA_DIR/demo-replays
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (match_slug, map_number)
    );

    CREATE INDEX IF NOT EXISTS cs2_demo_jobs_status_idx ON cs2_demo_jobs(status, created_at);
`,
  },
  {
    // Demo analysis v2 (worker AnalyzerVersion 2): time to damage.
    id: CS2_DEMO_ANALYSIS_V2_MIGRATION_ID,
    up: `
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS time_to_damage_sum REAL NOT NULL DEFAULT 0; -- ms from spotting an enemy to first hurting them, summed
    ALTER TABLE cs2_player_map_stats ADD COLUMN IF NOT EXISTS time_to_damage_samples INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    // Map radars for the 2D replay, read out of a CS2 install's own files by
    // the worker (worker/radar.go): the image and where world coordinates
    // land on it, per vertical level (Nuke's "lower").
    id: CS2_MAP_RADARS_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_map_radars (
      map TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'default',
      png BYTEA NOT NULL,
      crc BIGINT NOT NULL, -- the game texture's CRC, so the worker skips unchanged ones
      pos_x REAL NOT NULL,
      pos_y REAL NOT NULL,
      scale REAL NOT NULL,
      altitude_min REAL,
      altitude_max REAL,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (map, level)
    );
`,
  },
  {
    // Highlights (demos/highlights.ts): each player's best moments of a map,
    // picked from its analysis, and the clip the recorder made of each.
    id: CS2_HIGHLIGHTS_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_highlights (
      id SERIAL PRIMARY KEY,
      match_slug TEXT NOT NULL,
      map_number INTEGER NOT NULL,
      player_id TEXT NOT NULL, -- Steam ID 64
      kind TEXT NOT NULL, -- 'ace' | '4k' | '3k' | '2k' | 'clutch' | 'flair'
      score INTEGER NOT NULL,
      round INTEGER NOT NULL,
      start_tick INTEGER NOT NULL,
      end_tick INTEGER NOT NULL,
      slowmo_tick INTEGER NOT NULL, -- the last kill: the slow motion lands here
      kill_ticks TEXT NOT NULL, -- JSON number[]
      title TEXT NOT NULL, -- "3 kills · AK-47 · round 14"
      status TEXT NOT NULL DEFAULT 'pending', -- pending | recording | done | failed | skipped
      attempts INTEGER NOT NULL DEFAULT 0,
      recorder TEXT,
      claimed_at INTEGER,
      error TEXT,
      clip_path TEXT, -- under DATA_DIR/highlights
      clip_bytes BIGINT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      UNIQUE (match_slug, map_number, player_id, start_tick)
    );

    CREATE INDEX IF NOT EXISTS cs2_highlights_player_idx ON cs2_highlights(player_id, score DESC);
    CREATE INDEX IF NOT EXISTS cs2_highlights_status_idx ON cs2_highlights(status, score DESC);
`,
  },
  {
    // A player's reel of a map: their highlights there, one after the other,
    // made by the recorder with the clips.
    id: CS2_HIGHLIGHT_REELS_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_highlight_reels (
      match_slug TEXT NOT NULL,
      map_number INTEGER NOT NULL,
      player_id TEXT NOT NULL, -- Steam ID 64
      moments INTEGER NOT NULL, -- how many highlights it joins
      clip_path TEXT NOT NULL, -- under DATA_DIR/highlights
      clip_bytes BIGINT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (match_slug, map_number, player_id)
    );

    CREATE INDEX IF NOT EXISTS cs2_highlight_reels_player_idx ON cs2_highlight_reels(player_id, created_at DESC);
`,
  },
  {
    // A map's match reel: each player's best highlight there, one after the
    // other. Queued once the map's highlights are all recorded.
    id: CS2_MATCH_REELS_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_match_reels (
      match_slug TEXT NOT NULL,
      map_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | recording | done | failed
      attempts INTEGER NOT NULL DEFAULT 0,
      recorder TEXT,
      claimed_at INTEGER,
      error TEXT,
      clips INTEGER, -- how many players' highlights it joins
      clip_path TEXT, -- under DATA_DIR/highlights
      clip_bytes BIGINT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (match_slug, map_number)
    );

    CREATE INDEX IF NOT EXISTS cs2_match_reels_status_idx ON cs2_match_reels(status, created_at);
`,
  },
  {
    // What the highlight player needs, and a tournament's own reel:
    // - each clip's kill markers and slow motion (seconds in the video), so
    //   the scrubber can show them;
    // - which clips each reel joins, in order, for its chapters;
    // - the one highlight a player picked as their favourite (their profile
    //   leads with it);
    // - the tournament reel: its best plays, made once it is over.
    id: CS2_HIGHLIGHTS_PLAYER_MIGRATION_ID,
    up: `
    ALTER TABLE cs2_highlights ADD COLUMN IF NOT EXISTS markers TEXT; -- JSON { duration, kills: number[], slowmo: [from, to] | null }
    ALTER TABLE cs2_highlight_reels ADD COLUMN IF NOT EXISTS clip_ids TEXT; -- JSON number[]: the highlights it joins, in order
    ALTER TABLE cs2_match_reels ADD COLUMN IF NOT EXISTS clip_ids TEXT; -- JSON number[]

    CREATE TABLE IF NOT EXISTS cs2_highlight_favourites (
      player_id TEXT PRIMARY KEY, -- Steam ID 64
      highlight_id INTEGER NOT NULL REFERENCES cs2_highlights(id) ON DELETE CASCADE,
      set_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE TABLE IF NOT EXISTS cs2_tournament_reels (
      tournament_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | recording | done | failed
      attempts INTEGER NOT NULL DEFAULT 0,
      recorder TEXT,
      claimed_at INTEGER,
      error TEXT,
      clip_ids TEXT, -- JSON number[]: the highlights it joins, in order
      clip_path TEXT, -- under DATA_DIR/highlights
      clip_bytes BIGINT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );
`,
  },
  {
    // Where each clip starts in its reel, in seconds, as the recorder made it
    // (after the intro, across wipes and fades): the chapters and the music's
    // intro level read it instead of adding up clip lengths.
    id: CS2_REEL_STARTS_MIGRATION_ID,
    up: `
    ALTER TABLE cs2_highlight_reels ADD COLUMN IF NOT EXISTS clip_starts TEXT; -- JSON number[], one per clip_ids
    ALTER TABLE cs2_match_reels ADD COLUMN IF NOT EXISTS clip_starts TEXT; -- JSON number[]
    ALTER TABLE cs2_tournament_reels ADD COLUMN IF NOT EXISTS clip_starts TEXT; -- JSON number[]
`,
  },
  {
    // A team's best plays of a match, for the team to share (demos/teamReels.ts).
    id: CS2_TEAM_REELS_MIGRATION_ID,
    up: `
    CREATE TABLE IF NOT EXISTS cs2_team_reels (
      match_slug TEXT NOT NULL,
      team_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | recording | done | failed
      attempts INTEGER NOT NULL DEFAULT 0,
      recorder TEXT,
      claimed_at INTEGER,
      error TEXT,
      clips INTEGER,
      clip_ids TEXT, -- JSON number[]: the highlights it joins, in order
      clip_starts TEXT, -- JSON number[]: where each starts in it, in seconds
      clip_path TEXT, -- under DATA_DIR/highlights
      clip_bytes BIGINT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (match_slug, team_id)
    );
    CREATE INDEX IF NOT EXISTS cs2_team_reels_status_idx ON cs2_team_reels(status, created_at);
`,
  },
];
