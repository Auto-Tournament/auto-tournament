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
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

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
      maps TEXT NOT NULL,
      team_ids TEXT NOT NULL,
      settings TEXT,
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
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
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
      completed_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      UNIQUE(match_slug, map_number),
      FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_match_map_results_slug ON match_map_results(match_slug);
    CREATE INDEX IF NOT EXISTS idx_match_map_results_map ON match_map_results(map_number);

    CREATE INDEX IF NOT EXISTS idx_servers_enabled ON servers(enabled);
  `;
}

