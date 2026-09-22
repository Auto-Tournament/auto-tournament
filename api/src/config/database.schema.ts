/**
 * Database schema definitions for PostgreSQL
 */

/**
 * Get PostgreSQL schema SQL
 */
export function getSchemaSQL(): string {
  return `
    -- Servers table
    CREATE TABLE IF NOT EXISTS servers (
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
      cs2_update_checked_at INTEGER, -- Unix timestamp when CS2 UpToDateCheck was last performed by MAT (Steam API)
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
    
    CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);
    CREATE INDEX IF NOT EXISTS idx_servers_last_seen ON servers(last_seen);

    -- Application settings table
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    -- Teams table (must be created before matches due to foreign key)
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tag TEXT,
      discord_role_id TEXT,
      players TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

    -- Tournament settings table
    CREATE TABLE IF NOT EXISTS tournament (
      id SERIAL PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'setup',
      -- cs2-owned columns (maps, map_sequence, max_rounds, overtime_*): only the CS2
      -- integration validates them (validateTournamentSettings). Folding them into
      -- tournament.integration_settings is later work.
      maps TEXT NOT NULL, -- cs2-owned: JSON array of map ids (the map pool)
      team_ids TEXT NOT NULL,
      settings TEXT,
      game TEXT NOT NULL DEFAULT 'cs2', -- Game integration that owns this row (integrations/registry)
      -- Shuffle tournament specific fields
      map_sequence TEXT, -- cs2-owned: JSON array of maps in order (number of maps = number of rounds)
      team_size INTEGER DEFAULT 5, -- Number of players per team (default: 5 for 5v5)
      max_rounds INTEGER DEFAULT 24, -- cs2-owned: max rounds per map
      overtime_mode TEXT DEFAULT 'enabled', -- cs2-owned: 'enabled' or 'disabled'
      overtime_segments INTEGER, -- cs2-owned. Optional: max number of overtime segments (MatchZy overtime_limit). NULL/0 = unlimited.
      elo_template_id TEXT, -- Reference to elo_calculation_templates table (nullable)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      started_at INTEGER,
      completed_at INTEGER
    );

    -- Matches table
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      tournament_id INTEGER DEFAULT 1,
      round INTEGER NOT NULL,
      match_number INTEGER NOT NULL,
      -- Optional logical bracket grouping for visualization / wiring:
      -- 'WB' (winners), 'LB' (losers), 'GF' (grand final), 'GF_RESET' (optional reset)
      bracket TEXT,
      team1_id TEXT,
      team2_id TEXT,
      winner_id TEXT,
      server_id TEXT,
      config TEXT NOT NULL,
      game TEXT NOT NULL DEFAULT 'cs2', -- Game integration that owns this row (integrations/registry)
      status TEXT NOT NULL DEFAULT 'pending',
      -- Optional explicit slot wiring: where the inputs for this match come from.
      -- When populated, runtime progression can be driven entirely by these
      -- fields instead of inferring from slug/round patterns.
      team1_from_match_id INTEGER,
      team1_from_outcome TEXT, -- 'winner' | 'loser'
      team2_from_match_id INTEGER,
      team2_from_outcome TEXT, -- 'winner' | 'loser'
      next_match_id INTEGER,
      demo_file_path TEXT,
      -- Integration-owned: the CS2 map veto's progress (integrations/cs2/veto).
      -- Only CS2 writes it; core match views still read it for display.
      -- Moving it into an integration_state JSONB column is later work.
      veto_state TEXT,
      current_map TEXT,
      map_number INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      loaded_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE SET NULL,
      FOREIGN KEY (tournament_id) REFERENCES tournament(id) ON DELETE CASCADE,
      FOREIGN KEY (team1_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (team2_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (winner_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (team1_from_match_id) REFERENCES matches(id) ON DELETE SET NULL,
      FOREIGN KEY (team2_from_match_id) REFERENCES matches(id) ON DELETE SET NULL,
      FOREIGN KEY (next_match_id) REFERENCES matches(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_matches_slug ON matches(slug);
    CREATE INDEX IF NOT EXISTS idx_matches_server_id ON matches(server_id);
    CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round);
    CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
    CREATE INDEX IF NOT EXISTS idx_matches_team_from_match1 ON matches(team1_from_match_id);
    CREATE INDEX IF NOT EXISTS idx_matches_team_from_match2 ON matches(team2_from_match_id);

    -- Match events table
    CREATE TABLE IF NOT EXISTS match_events (
      id SERIAL PRIMARY KEY,
      match_slug TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT NOT NULL,
      received_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_match_events_slug ON match_events(match_slug);
    CREATE INDEX IF NOT EXISTS idx_match_events_type ON match_events(event_type);

    -- Match map results table
    CREATE TABLE IF NOT EXISTS match_map_results (
      id SERIAL PRIMARY KEY,
      match_slug TEXT NOT NULL,
      map_number INTEGER NOT NULL,
      map_name TEXT,
      team1_score INTEGER NOT NULL DEFAULT 0,
      team2_score INTEGER NOT NULL DEFAULT 0,
      winner_team TEXT,
      demo_file_path TEXT,
      completed_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      UNIQUE(match_slug, map_number),
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_match_map_results_slug ON match_map_results(match_slug);
    CREATE INDEX IF NOT EXISTS idx_match_map_results_map ON match_map_results(map_number);

    CREATE INDEX IF NOT EXISTS idx_servers_enabled ON servers(enabled);

    -- Maps table (cs2-owned: integrations/cs2/maps, seeded by the CS2 seed hook)
    CREATE TABLE IF NOT EXISTS maps (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      image_url TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_maps_id ON maps(id);

    -- Map pools table (cs2-owned: integrations/cs2/maps, seeded by the CS2 seed hook)
    CREATE TABLE IF NOT EXISTS map_pools (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      map_ids TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_map_pools_name ON map_pools(name);
    CREATE INDEX IF NOT EXISTS idx_map_pools_default ON map_pools(is_default);
    CREATE INDEX IF NOT EXISTS idx_map_pools_enabled ON map_pools(enabled);

    -- Tournament templates table
    CREATE TABLE IF NOT EXISTS tournament_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      format TEXT NOT NULL,
      map_pool_id INTEGER,
      maps TEXT,
      team_ids TEXT,
      settings TEXT NOT NULL,
      game TEXT NOT NULL DEFAULT 'cs2', -- Game integration that owns this row (integrations/registry)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      FOREIGN KEY (map_pool_id) REFERENCES map_pools(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tournament_templates_name ON tournament_templates(name);
    CREATE INDEX IF NOT EXISTS idx_tournament_templates_type ON tournament_templates(type);

    -- Manual match templates table (for standalone/manual matches)
    CREATE TABLE IF NOT EXISTS manual_match_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      best_of TEXT NOT NULL, -- 'bo1' | 'bo3' | 'bo5'
      use_veto INTEGER NOT NULL DEFAULT 0,
      starting_side TEXT NOT NULL, -- 'knife' | 'team1_ct' | 'team2_ct'
      knife_mode TEXT NOT NULL, -- 'default' | 'enabled' | 'disabled'
      players_per_team INTEGER NOT NULL DEFAULT 5,
      max_rounds INTEGER NOT NULL DEFAULT 24,
      overtime_enabled INTEGER NOT NULL DEFAULT 1,
      overtime_max_rounds INTEGER,
      map_pool_id INTEGER,
      maps TEXT, -- JSON array of map IDs
      game TEXT NOT NULL DEFAULT 'cs2', -- Game integration that owns this row (integrations/registry)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      FOREIGN KEY (map_pool_id) REFERENCES map_pools(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_manual_match_templates_name ON manual_match_templates(name);

    -- Players table
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, -- Steam ID
      name TEXT NOT NULL,
      avatar_url TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0, -- 1 = can reach the admin dashboard
      -- Admin-facing Skill Rating (for compatibility and display)
      current_elo INTEGER NOT NULL DEFAULT 1500, -- Skill Rating (ordinal * 200 + 1500)
      starting_elo INTEGER NOT NULL DEFAULT 1500, -- Initial Skill Rating seed
      -- OpenSkill internal values
      openskill_mu REAL NOT NULL DEFAULT 25.0,
      openskill_sigma REAL NOT NULL DEFAULT 8.333,
      match_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      discord_id TEXT, -- Discord user ID (17-20 digit string). Contact data only, admin-only, not unique (a parent may list theirs on several children)
      discord_id_edited_at INTEGER, -- Epoch of the last explicit edit (admin or the player) that set OR cleared discord_id; NULL = only ever filled by an import. Imports never touch a row where this is set. Internal, never in a response
      uid UUID NOT NULL DEFAULT gen_random_uuid(), -- Stable account id, never regenerated. Player-owned data (player_games, ...) keys on this rather than the Steam ID, so 3.1 can have accounts without Steam
      games_prompt_dismissed_at INTEGER -- Epoch when the player skipped or answered the "What do you play?" dialog; NULL = show it while they have no games
    );

    CREATE INDEX IF NOT EXISTS idx_players_name ON players(name);
    CREATE INDEX IF NOT EXISTS idx_players_elo ON players(current_elo);
    CREATE INDEX IF NOT EXISTS idx_players_discord_id ON players(discord_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_players_uid ON players(uid);

    -- Game catalogue: games players can say they play. Rows come from IGDB
    -- search results when IGDB credentials are configured, from Wikidata
    -- search results otherwise (the keyless default so search works out of
    -- the box), and from the built-in list (installed game modules + popular
    -- esports). External results are upserted so repeat queries and chips
    -- render from here.
    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      igdb_id INTEGER UNIQUE,
      wikidata_id TEXT UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      cover_url TEXT,
      logo_url TEXT,
      release_year INTEGER,
      genres TEXT, -- JSON array of up to 3 genre names, e.g. '["Shooter","Tactical"]' (matches the maps/team_ids convention: JSON text, not a native array)
      source TEXT NOT NULL DEFAULT 'builtin', -- 'igdb' | 'wikidata' | 'builtin'
      enriched_at INTEGER, -- epoch of the last successful built-in enrichment (image/genres/year from Wikidata or IGDB); NULL = never enriched
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_games_name ON games(LOWER(name));

    -- Games a player plays, keyed on players.uid (not the Steam ID). The
    -- foreign key to players(uid) is added in database.ts once the column is
    -- guaranteed to exist on upgraded instances.
    CREATE TABLE IF NOT EXISTS player_games (
      player_uid UUID NOT NULL,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (player_uid, game_id)
    );

    CREATE INDEX IF NOT EXISTS idx_player_games_game ON player_games(game_id);

    -- Auth identities table: links external auth providers (Discord, Keycloak, GitHub, etc.)
    -- to a Steam player ID so that once a user has linked Steam, future logins via
    -- the same provider automatically resolve their Steam identity.
    CREATE TABLE IF NOT EXISTS auth_identities (
      id SERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      steam_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      UNIQUE (provider, provider_user_id),
      FOREIGN KEY (steam_id) REFERENCES players(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_identities_provider_user
      ON auth_identities(provider, provider_user_id);

    -- Accounts a player holds with an external provider (Steam, Discord, and
    -- later Epic, Riot, ...), prepared for the identity step. No login or
    -- roster path reads it yet: players.id (Steam) and auth_identities stay
    -- the source of truth, and services/playerIdentity.ts mirrors their writes
    -- here. Backfilled once (the linked_accounts_backfill migration in
    -- database.ts) from players (steam) and auth_identities (discord only).
    -- players.discord_id is never copied: it is unverified contact data and
    -- not unique.
    CREATE TABLE IF NOT EXISTS linked_accounts (
      id SERIAL PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, -- 'steam' | 'discord' | ...
      external_id TEXT NOT NULL, -- The provider's account id (Steam ID64, Discord user id)
      verified BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = the holder proved it by signing in with the provider
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      UNIQUE (provider, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_linked_accounts_player ON linked_accounts(player_id);

    -- One row per hand-written migration in database.ts (backfills, data
    -- rewrites) once it has been applied, so it never runs twice. Column
    -- additions need no row: the auto-migrator (getSchemaColumns) detects them.
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    -- Player rating history table
    CREATE TABLE IF NOT EXISTS player_rating_history (
      id SERIAL PRIMARY KEY,
      player_id TEXT NOT NULL,
      -- NULL once the match is gone: deleting a tournament keeps its history
      -- (reset removes it instead), so the row carries its own labels.
      match_slug TEXT,
      match_label TEXT,
      tournament_name TEXT,
      -- Display values (for admin/UI)
      elo_before INTEGER NOT NULL,
      elo_after INTEGER NOT NULL,
      elo_change INTEGER NOT NULL,
      -- OpenSkill values
      mu_before REAL NOT NULL,
      mu_after REAL NOT NULL,
      sigma_before REAL NOT NULL,
      sigma_after REAL NOT NULL,
      -- Stat-based adjustments (if template enabled)
      base_elo_after INTEGER, -- Base ELO from OpenSkill (before adjustments)
      stat_adjustment INTEGER, -- ELO adjustment from stats (can be negative)
      template_id TEXT, -- Reference to elo_calculation_templates table
      match_result TEXT NOT NULL, -- 'win' or 'loss'
      performance_data TEXT, -- JSON with ADR, damage, etc. (future)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_player_rating_history_player ON player_rating_history(player_id);
    CREATE INDEX IF NOT EXISTS idx_player_rating_history_match ON player_rating_history(match_slug);
    CREATE INDEX IF NOT EXISTS idx_player_rating_history_created ON player_rating_history(created_at);

    -- ELO calculation templates table
    CREATE TABLE IF NOT EXISTS elo_calculation_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled BOOLEAN NOT NULL DEFAULT false,
      -- Stat weights (JSON object)
      weights TEXT NOT NULL DEFAULT '{}',
      -- Optional caps
      max_adjustment INTEGER,
      min_adjustment INTEGER,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_elo_templates_name ON elo_calculation_templates(name);
    CREATE INDEX IF NOT EXISTS idx_elo_templates_enabled ON elo_calculation_templates(enabled);

    -- Player match stats table (for tracking individual player performance)
    CREATE TABLE IF NOT EXISTS player_match_stats (
      id SERIAL PRIMARY KEY,
      player_id TEXT NOT NULL,
      match_slug TEXT NOT NULL,
      team TEXT NOT NULL, -- 'team1' or 'team2'
      won_match BOOLEAN NOT NULL,
      adr REAL, -- Average Damage per Round
      total_damage INTEGER,
      kills INTEGER,
      deaths INTEGER,
      assists INTEGER,
      headshots INTEGER,
      flash_assists INTEGER,
      utility_damage INTEGER,
      kast REAL, -- KAST percentage (0-100)
      mvps INTEGER,
      score INTEGER,
      rounds_played INTEGER,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_player_match_stats_player ON player_match_stats(player_id);
    CREATE INDEX IF NOT EXISTS idx_player_match_stats_match ON player_match_stats(match_slug);
    CREATE INDEX IF NOT EXISTS idx_player_match_stats_team ON player_match_stats(team);

    -- Shuffle tournament players registration table
    CREATE TABLE IF NOT EXISTS shuffle_tournament_players (
      tournament_id INTEGER NOT NULL DEFAULT 1,
      player_id TEXT NOT NULL,
      registered_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (tournament_id, player_id),
      FOREIGN KEY (tournament_id) REFERENCES tournament(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_shuffle_tournament_players_tournament ON shuffle_tournament_players(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_shuffle_tournament_players_player ON shuffle_tournament_players(player_id);

    -- Session table for connect-pg-simple (express-session PostgreSQL store)
    -- This table is required for session persistence across API restarts
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP WITH TIME ZONE NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
  `;
}

/**
 * A column that `getSchemaSQL()` declares, in a form that can be handed to
 * `ALTER TABLE ... ADD COLUMN`.
 */
export interface SchemaColumn {
  table: string;
  column: string;
  /** Column definition with anything that cannot be added retroactively removed. */
  type: string;
}

/**
 * Every column declared by `getSchemaSQL()`, derived from the schema itself.
 *
 * `CREATE TABLE IF NOT EXISTS` only ever creates missing *tables* — it never adds
 * a column to a table that already exists. Instances that were created before a
 * column was introduced therefore need an explicit `ALTER TABLE ADD COLUMN`.
 * That list used to be maintained by hand and drifted from the schema, which is
 * how upgraded instances ended up without `servers.status` and crashed the
 * health monitor with `column "status" does not exist`. Deriving it here means
 * adding a column to the schema is enough — there is no second list to forget.
 *
 * The definition is sanitised so it is legal on a table that already has rows:
 * - `PRIMARY KEY` / `UNIQUE` / `REFERENCES` are dropped (constraints belong to
 *   the create statement; re-adding them here would fail or lock).
 * - `NOT NULL` is dropped unless the column also has a `DEFAULT`, because
 *   Postgres cannot add a NOT NULL column to a non-empty table without one.
 */
export function getSchemaColumns(): SchemaColumn[] {
  const sql = getSchemaSQL();
  const columns: SchemaColumn[] = [];

  const tableRe = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/g;
  let table: RegExpExecArray | null;

  while ((table = tableRe.exec(sql)) !== null) {
    const [, tableName, body] = table;

    for (const rawLine of body.split('\n')) {
      const line = rawLine.split('--')[0].trim().replace(/,$/, '');
      if (!line) continue;
      // Table-level constraints, not columns.
      if (/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) continue;

      const match = /^(\w+)\s+(.+)$/.exec(line);
      if (!match) continue;
      const [, column, rawType] = match;

      // SERIAL columns are identity columns of a table we would never be adding to.
      if (/\bSERIAL\b/i.test(rawType)) continue;

      let type = rawType
        .replace(/\s+PRIMARY KEY\b/gi, '')
        .replace(/\s+UNIQUE\b/gi, '')
        .replace(/\s+REFERENCES\s+\w+\s*\([^)]*\)(\s+ON\s+(DELETE|UPDATE)\s+[A-Z ]+)*/gi, '')
        .trim();

      if (!/\bDEFAULT\b/i.test(type)) {
        type = type.replace(/\s*\bNOT NULL\b/gi, '').trim();
      }

      if (!type) continue;
      columns.push({ table: tableName, column, type });
    }
  }

  return columns;
}
