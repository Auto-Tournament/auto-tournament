import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { log } from '../utils/logger';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'tournament.db');

/**
 * Database class for easy SQLite operations
 */
class DatabaseManager {
  private db: BetterSqlite3.Database;

  constructor() {
    // Ensure data directory exists
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    // Create database connection
    this.db = new Database(DB_PATH, {
      // Only enable SQL logging if LOG_LEVEL is debug
      verbose: process.env.LOG_LEVEL === 'debug' ? console.log : undefined,
    });

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    log.database(`Database connected: ${DB_PATH}`);
    this.initializeSchema();
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    // Create servers table
    this.db.exec(`
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
    `);

    // Tournament settings table (only one tournament at a time)
    this.db.exec(`
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
    `);

    // Matches table with bracket support
    this.db.exec(`
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
    `);

    // Migration: Add demo_file_path column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE matches ADD COLUMN demo_file_path TEXT;`);
    } catch {
      // Column already exists, ignore
    }

    // Migration: Add veto_state column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE matches ADD COLUMN veto_state TEXT;`);
    } catch {
      // Column already exists, ignore
    }

    // Migration: Add current_map and map_number columns
    try {
      this.db.exec(`ALTER TABLE matches ADD COLUMN current_map TEXT;`);
    } catch {
      // Column already exists, ignore
    }
    try {
      this.db.exec(`ALTER TABLE matches ADD COLUMN map_number INTEGER DEFAULT 0;`);
    } catch {
      // Column already exists, ignore
    }

    this.db.exec(`
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
    `);

    // Teams table
    this.db.exec(`
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
        `);

    // Create indexes
    this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_servers_enabled ON servers(enabled);
        `);

    log.success('Database schema initialized');
  }

  /**
   * Get all records from a table
   */
  getAll<T>(table: string, where?: string, params?: unknown[]): T[] {
    let query = `SELECT * FROM ${table}`;
    if (where) {
      query += ` WHERE ${where}`;
    }
    const stmt = this.db.prepare(query);
    return (params ? stmt.all(...params) : stmt.all()) as T[];
  }

  /**
   * Get a single record by condition
   */
  getOne<T>(table: string, where: string, params: unknown[]): T | undefined {
    const query = `SELECT * FROM ${table} WHERE ${where} LIMIT 1`;
    const stmt = this.db.prepare(query);
    return stmt.get(...params) as T | undefined;
  }

  /**
   * Insert a record
   */
  insert(table: string, data: Record<string, unknown>): BetterSqlite3.RunResult {
    const columns = Object.keys(data).join(', ');
    const placeholders = Object.keys(data)
      .map(() => '?')
      .join(', ');
    const values = Object.values(data);

    const query = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;
    const stmt = this.db.prepare(query);
    return stmt.run(...values);
  }

  /**
   * Update a record
   */
  update(
    table: string,
    data: Record<string, unknown>,
    where: string,
    whereParams: unknown[]
  ): void {
    const setClauses = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(', ');
    const values = [...Object.values(data), ...whereParams];

    const query = `UPDATE ${table} SET ${setClauses} WHERE ${where}`;
    const stmt = this.db.prepare(query);
    stmt.run(...values);
  }

  /**
   * Delete a record
   */
  delete(table: string, where: string, params: unknown[]): void {
    const query = `DELETE FROM ${table} WHERE ${where}`;
    const stmt = this.db.prepare(query);
    stmt.run(...params);
  }

  /**
   * Execute custom query
   */
  query<T>(sql: string, params?: unknown[]): T[] {
    const stmt = this.db.prepare(sql);
    return (params ? stmt.all(...params) : stmt.all()) as T[];
  }

  /**
   * Execute custom query (single result)
   */
  queryOne<T>(sql: string, params?: unknown[]): T | undefined {
    const stmt = this.db.prepare(sql);
    return (params ? stmt.get(...params) : stmt.get()) as T | undefined;
  }

  /**
   * Execute raw SQL
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    log.database('Database connection closed');
  }
}

// Export singleton instance
export const db = new DatabaseManager();
