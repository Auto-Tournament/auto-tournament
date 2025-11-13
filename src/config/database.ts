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

  // Add near the top of the class (private helpers)
  private safeJson(value: unknown): string {
    try {
      // Avoid logging huge blobs and secrets-looking keys
      return JSON.stringify(value, (k, v) => {
        const key = k.toLowerCase?.() ?? '';
        if (/(password|secret|token|key)/.test(key)) return '***';
        if (typeof v === 'string' && v.length > 500) return v.slice(0, 500) + '…';
        return v;
      });
    } catch {
      return String(value);
    }
  }

  private logRunResult(op: string, table: string, res: BetterSqlite3.RunResult) {
    const meta = `changes=${res.changes} lastInsertRowid=${String(res.lastInsertRowid)}`;
    if (res.changes > 0) {
      log.success(`[DB] ${op} ${table} OK (${meta})`);
    } else {
      // 0 changes can be perfectly fine (e.g., idempotent updates), but we surface it distinctly
      log.database(`[DB] ${op} ${table}: no rows changed (${meta})`);
    }
  }

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

    // Application settings table (key/value store for runtime configuration)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
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
   * Get application setting by key
   */
  getAppSetting(key: string): string | null {
    try {
      const stmt = this.db.prepare('SELECT value FROM app_settings WHERE key = ?');
      const row = stmt.get(key) as { value: string | null } | undefined;
      log.database(`[DB] SETTINGS get key=${key} ${row ? 'found' : 'missing'}`);
      return row?.value ?? null;
    } catch (err) {
      log.error(`[DB] SETTINGS get failed for key=${key}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Set or delete an application setting
   */
  setAppSetting(key: string, value: string | null): void {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      throw new Error('Setting key is required');
    }

    try {
      if (value === null) {
        const stmt = this.db.prepare('DELETE FROM app_settings WHERE key = ?');
        const res = stmt.run(trimmedKey);
        this.logRunResult('DELETE', `app_settings(${trimmedKey})`, res);
        return;
      }

      const stmt = this.db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, strftime('%s', 'now'))
        ON CONFLICT(key)
        DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      const res = stmt.run(trimmedKey, value);
      this.logRunResult('UPSERT', `app_settings(${trimmedKey})`, res);
    } catch (err) {
      log.error(`[DB] SETTINGS set failed for key=${trimmedKey}: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Get all application settings
   */
  getAllAppSettings(): Array<{ key: string; value: string | null; updated_at: number }> {
    try {
      const stmt = this.db.prepare('SELECT key, value, updated_at FROM app_settings');
      const rows = stmt.all() as Array<{ key: string; value: string | null; updated_at: number }>;
      log.database(`[DB] SETTINGS getAll count=${rows.length}`);
      return rows;
    } catch (err) {
      log.error(`[DB] SETTINGS getAll failed: ${(err as Error).message}`);
      throw err;
    }
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

    try {
      log.database(`[DB] INSERT ${table} columns=[${columns}] values=${this.safeJson(values)}`);
      const stmt = this.db.prepare(query);
      const res = stmt.run(...values);
      this.logRunResult('INSERT', table, res);
      return res;
    } catch (err) {
      log.error(`[DB] INSERT ${table} failed: ${(err as Error).message}`);
      log.database(`[DB] SQL: ${query} params=${this.safeJson(values)}`);
      throw err;
    }
  }

  /**
   * Update a record
   */
  update(
    table: string,
    data: Record<string, unknown>,
    where: string,
    whereParams: unknown[]
  ): BetterSqlite3.RunResult {
    const setClauses = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(', ');
    const values = [...Object.values(data), ...whereParams];
    const query = `UPDATE ${table} SET ${setClauses} WHERE ${where}`;

    try {
      log.database(
        `[DB] UPDATE ${table} set=${this.safeJson(data)} where="${where}" params=${this.safeJson(
          whereParams
        )}`
      );
      const stmt = this.db.prepare(query);
      const res = stmt.run(...values);
      this.logRunResult('UPDATE', table, res);
      return res;
    } catch (err) {
      log.error(`[DB] UPDATE ${table} failed: ${(err as Error).message}`);
      log.database(`[DB] SQL: ${query} params=${this.safeJson(values)}`);
      throw err;
    }
  }

  /**
   * Delete a record
   */
  delete(table: string, where: string, params: unknown[]): BetterSqlite3.RunResult {
    const query = `DELETE FROM ${table} WHERE ${where}`;
    try {
      log.database(`[DB] DELETE ${table} where="${where}" params=${this.safeJson(params)}`);
      const stmt = this.db.prepare(query);
      const res = stmt.run(...params);
      this.logRunResult('DELETE', table, res);
      return res;
    } catch (err) {
      log.error(`[DB] DELETE ${table} failed: ${(err as Error).message}`);
      log.database(`[DB] SQL: ${query} params=${this.safeJson(params)}`);
      throw err;
    }
  }

  /**
   * Execute raw SQL
   */
  exec(sql: string): void {
    try {
      log.database(`[DB] EXEC sql=${JSON.stringify(sql)}`);
      this.db.exec(sql);
      log.success('[DB] EXEC OK');
    } catch (err) {
      log.error(`[DB] EXEC failed: ${(err as Error).message}`);
      log.database(`[DB] SQL: ${JSON.stringify(sql)}`);
      throw err;
    }
  }

  /**
   * Execute custom query
   */
  query<T>(sql: string, params?: unknown[]): T[] {
    try {
      log.database(`[DB] QUERY sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
      const stmt = this.db.prepare(sql);
      const res = (params ? stmt.all(...params) : stmt.all()) as T[];
      log.database(`[DB] QUERY OK rows=${res.length}`);
      return res;
    } catch (err) {
      log.error(`[DB] QUERY failed: ${(err as Error).message}`);
      log.database(`[DB] SQL: ${JSON.stringify(sql)} params=${this.safeJson(params)}`);
      throw err;
    }
  }

  /**
   * Execute custom query (single result)
   */
  queryOne<T>(sql: string, params?: unknown[]): T | undefined {
    try {
      log.database(`[DB] QUERY ONE sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
      const stmt = this.db.prepare(sql);
      const row = (params ? stmt.get(...params) : stmt.get()) as T | undefined;
      log.database(`[DB] QUERY ONE OK ${row ? 'found' : 'not found'}`);
      return row;
    } catch (err) {
      log.error(`[DB] QUERY ONE failed: ${(err as Error).message}`);
      log.database(`[DB] SQL: ${JSON.stringify(sql)} params=${this.safeJson(params)}`);
      throw err;
    }
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
