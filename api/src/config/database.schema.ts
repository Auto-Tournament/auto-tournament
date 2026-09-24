/**
 * Database schema definitions for PostgreSQL
 */

/**
 * Get PostgreSQL schema SQL
 */
export function getSchemaSQL(): string {
  return `
    -- CS2's tables (cs2_servers, cs2_maps, cs2_map_pools) are not here: CS2
    -- creates them with its own migrations (integrations/cs2/migrations.ts),
    -- and an install upgraded from 2.x has them renamed from servers, maps and
    -- map_pools (config/cs2TableHandover.ts).

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
      team_ids TEXT NOT NULL,
      -- JSON object. The game module's own settings are one key in it (CS2:
      -- cs2, holding the map pool, map sequence, max rounds and overtime that
      -- 2.x kept in columns here); the core stores them without reading them.
      settings TEXT,
      game TEXT NOT NULL DEFAULT 'cs2', -- Game integration that owns this row (integrations/registry)
      team_size INTEGER DEFAULT 5, -- Number of players per team (default: 5 for 5v5)
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
      -- server_id references cs2_servers(id) ON DELETE SET NULL. That table is
      -- CS2's and does not exist yet when this runs on a fresh database, so the
      -- key is added in database.ts once CS2's migrations have created it.
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

    -- Tournament templates table
    CREATE TABLE IF NOT EXISTS tournament_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      format TEXT NOT NULL,
      team_ids TEXT,
      settings TEXT NOT NULL, -- JSON; the game module's object under its key (CS2: cs2, with the map pool id and maps)
      game TEXT NOT NULL DEFAULT 'cs2', -- Game integration that owns this row (integrations/registry)
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
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
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
      -- map_pool_id references cs2_map_pools(id) ON DELETE SET NULL, added in
      -- database.ts once CS2's migrations have created that table.
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

    -- Game packs: a game this instance can run because an admin imported a
    -- file describing it, rather than because a module shipped it. A pack is
    -- data only — no code — and runs on the engine named in \`engine\`, which
    -- must be an installed module that runs any catalogue game (manual-report).
    -- See api/src/services/gamePackService.ts.
    CREATE TABLE IF NOT EXISTS game_packs (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      engine TEXT NOT NULL, -- integration id that runs it, e.g. 'manual-report'
      version TEXT, -- the pack's own version string, for "update available"
      source TEXT NOT NULL DEFAULT 'uploaded', -- 'uploaded' | 'index'
      origin TEXT, -- where an 'index' pack came from, for updates
      definition TEXT NOT NULL, -- the validated pack JSON, as stored
      icon TEXT, -- the pack's square tile (SVG markup), already sanitised
      installed_by TEXT, -- admin account uid, best effort
      installed_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

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

    -- One row per migration a game module brought with it
    -- (GameIntegration.migrations), once applied. The checksum is of the
    -- migration's SQL as it ran: a module that later ships a different body
    -- under the same id is refused rather than run again. See
    -- config/moduleMigrations.ts.
    CREATE TABLE IF NOT EXISTS module_migrations (
      module_id TEXT NOT NULL,
      migration_id TEXT NOT NULL,
      checksum TEXT NOT NULL, -- sha256 hex of the migration's SQL
      applied_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (module_id, migration_id)
    );

    -- Who belongs to a team, and who may act for it (3.0 phase D).
    --
    -- Keyed on players.uid, never a Steam ID: a 3.1 account without Steam can
    -- captain a team. The foreign key to players(uid) is added in database.ts
    -- once the column and its unique index are guaranteed to exist on an
    -- upgraded instance (the same reason as player_games).
    --
    -- teams.players (JSON) stays the roster of record that match configs are
    -- built from; this table mirrors it (services/teamMembers.ts) and adds the
    -- role. Nothing reads it yet: the manual-report module (phase D2 onwards)
    -- authorises a report by it.
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      account_uid UUID NOT NULL, -- players.uid
      role TEXT NOT NULL DEFAULT 'member', -- 'captain' | 'member'
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (team_id, account_uid)
    );

    CREATE INDEX IF NOT EXISTS idx_team_members_account ON team_members(account_uid);
    CREATE INDEX IF NOT EXISTS idx_team_members_role ON team_members(team_id, role);

    -- Reported match results (3.0 phase D), one row per revision.
    --
    -- A report is the raw claim; nothing is final until it is confirmed or an
    -- admin resolves it, at which point the module turns it into normalized
    -- map_result / series_end events. At most one row per match is open
    -- ('submitted' or 'disputed') - idx_match_reports_open. A newer report
    -- supersedes the open one instead of replacing it, so the history stays.
    --
    -- The *_uid columns are players.uid values with no foreign key on purpose:
    -- deleting an account must not erase who reported what.
    CREATE TABLE IF NOT EXISTS match_reports (
      id SERIAL PRIMARY KEY,
      match_slug TEXT NOT NULL REFERENCES matches(slug) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 1, -- 1, 2, ... within the match
      status TEXT NOT NULL DEFAULT 'submitted', -- 'submitted' | 'confirmed' | 'disputed' | 'superseded' | 'withdrawn'
      source TEXT NOT NULL DEFAULT 'report', -- 'report' (a team) | 'admin' (an override)
      submitted_by_uid UUID, -- players.uid of the reporter; NULL = the system
      submitted_by_team TEXT, -- 'team1' | 'team2'; NULL for an admin report
      result TEXT NOT NULL, -- JSON: the reported per-map scores and the series result
      confirmation TEXT NOT NULL DEFAULT 'opponent', -- 'opponent' | 'none', from the tournament's setup at submit time
      confirm_deadline INTEGER, -- Epoch the timeout action fires at; NULL = no timeout
      timeout_action TEXT, -- 'auto_confirm' | 'escalate'; NULL = no timeout
      confirmed_by_uid UUID, -- players.uid of the opponent who confirmed it
      confirmed_at INTEGER,
      disputed_by_uid UUID,
      disputed_at INTEGER,
      dispute_reason TEXT,
      resolved_by_uid UUID, -- The admin who resolved, overrode or reopened it
      resolved_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      UNIQUE (match_slug, revision)
    );

    CREATE INDEX IF NOT EXISTS idx_match_reports_match ON match_reports(match_slug);
    CREATE INDEX IF NOT EXISTS idx_match_reports_status ON match_reports(status);
    -- The timeout sweeper's query: open reports whose deadline has passed.
    CREATE INDEX IF NOT EXISTS idx_match_reports_deadline ON match_reports(confirm_deadline);
    -- At most one open report per match.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_match_reports_open
      ON match_reports(match_slug) WHERE status IN ('submitted', 'disputed');

    -- Audit trail for match_reports (3.0 phase D): every state change, who made
    -- it and why. Append only, and kept for as long as the match exists.
    CREATE TABLE IF NOT EXISTS match_report_actions (
      id SERIAL PRIMARY KEY,
      report_id INTEGER REFERENCES match_reports(id) ON DELETE CASCADE,
      match_slug TEXT NOT NULL REFERENCES matches(slug) ON DELETE CASCADE,
      action TEXT NOT NULL, -- 'submit' | 'confirm' | 'dispute' | 'withdraw' | 'supersede' | 'resolve' | 'override' | 'reopen' | 'timeout_auto_confirm' | 'timeout_escalate'
      actor_uid UUID, -- players.uid; NULL = the system (the timeout sweeper)
      actor_role TEXT NOT NULL DEFAULT 'system', -- 'captain' | 'admin' | 'system'
      detail TEXT, -- JSON: the reason, the values that changed
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_match_report_actions_match ON match_report_actions(match_slug);
    CREATE INDEX IF NOT EXISTS idx_match_report_actions_report ON match_report_actions(report_id);

    -- Extra stats a tournament asks reporters for (3.0 phase D), e.g. goals in
    -- Rocket League. A game with no live events records what people type in, so
    -- the fields belong to the tournament rather than to the game.
    CREATE TABLE IF NOT EXISTS custom_stat_fields (
      id SERIAL PRIMARY KEY,
      tournament_id INTEGER NOT NULL DEFAULT 1 REFERENCES tournament(id) ON DELETE CASCADE,
      key TEXT NOT NULL, -- Stable id within the tournament, e.g. 'goals'
      label TEXT NOT NULL,
      value_type TEXT NOT NULL DEFAULT 'number', -- 'number' | 'text'
      scope TEXT NOT NULL DEFAULT 'player', -- 'player' | 'team'
      required INTEGER NOT NULL DEFAULT 0,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      UNIQUE (tournament_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_custom_stat_fields_tournament ON custom_stat_fields(tournament_id);

    -- The values reported for those fields (3.0 phase D). One row per field per
    -- player (or per team, for a team-scoped field) per map, with map_number 0
    -- for a series total. player_uid is players.uid; its foreign key is added
    -- in database.ts, like team_members.
    CREATE TABLE IF NOT EXISTS match_stat_values (
      id SERIAL PRIMARY KEY,
      match_slug TEXT NOT NULL REFERENCES matches(slug) ON DELETE CASCADE,
      map_number INTEGER NOT NULL DEFAULT 0, -- 0 = the series total, 1.. = that map
      field_id INTEGER NOT NULL REFERENCES custom_stat_fields(id) ON DELETE CASCADE,
      player_uid UUID, -- players.uid for a player value; NULL for a team value
      team TEXT, -- 'team1' | 'team2'
      value_number REAL,
      value_text TEXT,
      report_id INTEGER REFERENCES match_reports(id) ON DELETE SET NULL, -- The report that carried this value
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    -- One value per field per player, and one per field per team. Two partial
    -- indexes rather than one UNIQUE: Postgres counts NULLs as distinct, so a
    -- table constraint over (..., player_uid, team) would not hold for the team
    -- rows, where player_uid is NULL.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_match_stat_values_player
      ON match_stat_values(match_slug, map_number, field_id, player_uid) WHERE player_uid IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_match_stat_values_team
      ON match_stat_values(match_slug, map_number, field_id, team) WHERE player_uid IS NULL;
    CREATE INDEX IF NOT EXISTS idx_match_stat_values_match ON match_stat_values(match_slug);
    CREATE INDEX IF NOT EXISTS idx_match_stat_values_field ON match_stat_values(field_id);

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
 * Core's tables only. A module's tables (CS2's `cs2_servers`, `cs2_maps`,
 * `cs2_map_pools`) are not in core's schema, so this pass never adds a column
 * to them: a module changes its own columns with a new migration of its own
 * (`GameIntegration.migrations`, see integrations/cs2/migrations.ts).
 *
 * `CREATE TABLE IF NOT EXISTS` only ever creates missing *tables* — it never adds
 * a column to a table that already exists. Instances that were created before a
 * column was introduced therefore need an explicit `ALTER TABLE ADD COLUMN`.
 * That list used to be maintained by hand and drifted from the schema, which is
 * how upgraded instances ended up without `servers.status` (now CS2's
 * `cs2_servers.status`) and crashed the health monitor with `column "status"
 * does not exist`. Deriving it here means adding a column to the schema is
 * enough — there is no second list to forget.
 *
 * The definition is sanitised so it is legal on a table that already has rows:
 * - `PRIMARY KEY` / `UNIQUE` / `REFERENCES` are dropped (constraints belong to
 *   the create statement; re-adding them here would fail or lock).
 * - `NOT NULL` is dropped unless the column also has a `DEFAULT`, because
 *   Postgres cannot add a NOT NULL column to a non-empty table without one.
 */
export function getSchemaColumns(): SchemaColumn[] {
  return parseSchemaColumns(getSchemaSQL());
}

/**
 * The columns of every `CREATE TABLE IF NOT EXISTS` in `sql`, sanitised as
 * described on `getSchemaColumns`. Each column must sit on its own line.
 * Also used by config/cs2TableHandover.ts on CS2's first migration, to bring
 * a renamed 2.x table to the columns that migration declares.
 */
export function parseSchemaColumns(sql: string): SchemaColumn[] {
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
