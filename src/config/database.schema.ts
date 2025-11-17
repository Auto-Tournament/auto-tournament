/**
 * Database schema definitions
 * Converts SQLite-specific syntax to database-agnostic SQL
 */

export interface SchemaDefinition {
  sqlite: string;
  postgres: string;
}

/**
 * Convert SQLite SQL to PostgreSQL-compatible SQL
 */
function sqliteToPostgres(sql: string): string {
  return sql
    // INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
    .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
    // INTEGER PRIMARY KEY -> SERIAL PRIMARY KEY (for auto-increment)
    .replace(/INTEGER PRIMARY KEY CHECK \(id = 1\)/gi, 'SERIAL PRIMARY KEY CHECK (id = 1)')
    // TEXT -> VARCHAR or TEXT (PostgreSQL handles both)
    .replace(/\bTEXT\b/gi, 'TEXT')
    // INTEGER -> INTEGER (same)
    .replace(/\bINTEGER\b/gi, 'INTEGER')
    // strftime('%s', 'now') -> EXTRACT(EPOCH FROM NOW())::INTEGER
    .replace(/strftime\('%s', 'now'\)/gi, "EXTRACT(EPOCH FROM NOW())::INTEGER")
    // CREATE TABLE IF NOT EXISTS -> same
    // CREATE INDEX IF NOT EXISTS -> same
    // FOREIGN KEY -> same
    // ON DELETE -> same
    // DEFAULT -> same
    // NOT NULL -> same
    // UNIQUE -> same
    // PRIMARY KEY -> same
    // CHECK -> same
    ;
}

/**
 * Get schema SQL for a specific database type
 */
export function getSchemaSQL(dbType: 'sqlite' | 'postgres'): string {
  const sqliteSchema = `
    -- Servers table
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      password TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    -- Application settings table
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    -- Teams table (must be created before matches due to foreign key)
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tag TEXT,
      discord_role_id TEXT,
      players TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

    -- Tournament settings table
    CREATE TABLE IF NOT EXISTS tournament (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      format TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'setup',
      maps TEXT NOT NULL,
      team_ids TEXT NOT NULL,
      settings TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      started_at INTEGER,
      completed_at INTEGER
    );

    -- Matches table
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      tournament_id INTEGER DEFAULT 1,
      round INTEGER NOT NULL,
      match_number INTEGER NOT NULL,
      team1_id TEXT,
      team2_id TEXT,
      winner_id TEXT,
      server_id TEXT,
      config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      next_match_id INTEGER,
      demo_file_path TEXT,
      veto_state TEXT,
      current_map TEXT,
      map_number INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      loaded_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE SET NULL,
      FOREIGN KEY (tournament_id) REFERENCES tournament(id) ON DELETE CASCADE,
      FOREIGN KEY (team1_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (team2_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (winner_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (next_match_id) REFERENCES matches(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_matches_slug ON matches(slug);
    CREATE INDEX IF NOT EXISTS idx_matches_server_id ON matches(server_id);
    CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
    CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(round);
    CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

    -- Match events table
    CREATE TABLE IF NOT EXISTS match_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_slug TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_data TEXT NOT NULL,
      received_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_match_events_slug ON match_events(match_slug);
    CREATE INDEX IF NOT EXISTS idx_match_events_type ON match_events(event_type);

    -- Match map results table
    CREATE TABLE IF NOT EXISTS match_map_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_slug TEXT NOT NULL,
      map_number INTEGER NOT NULL,
      map_name TEXT,
      team1_score INTEGER NOT NULL DEFAULT 0,
      team2_score INTEGER NOT NULL DEFAULT 0,
      winner_team TEXT,
      completed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      UNIQUE(match_slug, map_number),
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_match_map_results_slug ON match_map_results(match_slug);
    CREATE INDEX IF NOT EXISTS idx_match_map_results_map ON match_map_results(map_number);

    CREATE INDEX IF NOT EXISTS idx_servers_enabled ON servers(enabled);
  `;

  if (dbType === 'sqlite') {
    return sqliteSchema;
  }

  // Convert to PostgreSQL
  return sqliteToPostgres(sqliteSchema);
}

