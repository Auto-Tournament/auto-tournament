/**
 * Database manager with support for both SQLite and PostgreSQL
 * Provides unified interface that works with both databases
 */

import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';
import { log } from '../utils/logger';
import { getSchemaSQL } from './database.schema';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'tournament.db');

// Determine database type
const DB_TYPE = (process.env.DB_TYPE || 'postgresql').toLowerCase();
const isPostgres = DB_TYPE === 'postgresql' || DB_TYPE === 'postgres';

/**
 * Helper to convert SQLite placeholders (?) to PostgreSQL placeholders ($1, $2, etc.)
 */
function convertPlaceholders(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  if (!isPostgres || !sql.includes('?')) {
    return { sql, params };
  }
  let paramIndex = 1;
  const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
  return { sql: convertedSql, params };
}

/**
 * Database class that supports both SQLite (sync) and PostgreSQL (async)
 */
class DatabaseManager {
  private sqliteDb?: BetterSqlite3.Database;
  private postgresPool?: Pool;
  private initialized = false;

  constructor() {
    if (isPostgres) {
      // PostgreSQL - will be initialized asynchronously
      const connString =
        process.env.DATABASE_URL ||
        `postgresql://${process.env.DB_USER || 'postgres'}:${
          process.env.DB_PASSWORD || 'postgres'
        }@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${
          process.env.DB_NAME || 'matchzy_tournament'
        }`;

      this.postgresPool = new Pool({
        connectionString: connString,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      log.database(
        `[PostgreSQL] Database pool created: ${connString.replace(/:[^:@]+@/, ':****@')}`
      );
    } else {
      // SQLite - initialize synchronously
      if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
      }

      this.sqliteDb = new Database(DB_PATH, {
        verbose: process.env.LOG_LEVEL === 'debug' ? console.log : undefined,
      });

      this.sqliteDb.pragma('foreign_keys = ON');
      log.database(`[SQLite] Database connected: ${DB_PATH}`);
      this.initializeSchemaSync();
      this.initialized = true;
    }
  }

  /**
   * Initialize database connection (async for PostgreSQL)
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (isPostgres && this.postgresPool) {
      // Test connection
      const client = await this.postgresPool.connect();
      try {
        await client.query('SELECT 1');
        log.database('[PostgreSQL] Database connection successful');
      } finally {
        client.release();
      }
      await this.initializeSchemaAsync();
    }

    this.initialized = true;
  }

  /**
   * Initialize schema for SQLite (synchronous)
   */
  private initializeSchemaSync(): void {
    if (!this.sqliteDb) return;

    const schema = getSchemaSQL('sqlite');
    const statements = schema
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      try {
        this.sqliteDb.exec(statement + ';');
      } catch (err) {
        const error = err as Error;
        if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
          log.error(`[SQLite] Schema error: ${error.message}`);
        }
      }
    }

    // Migrations
    const migrations = [
      `ALTER TABLE matches ADD COLUMN demo_file_path TEXT;`,
      `ALTER TABLE matches ADD COLUMN veto_state TEXT;`,
      `ALTER TABLE matches ADD COLUMN current_map TEXT;`,
      `ALTER TABLE matches ADD COLUMN map_number INTEGER DEFAULT 0;`,
    ];

    for (const migration of migrations) {
      try {
        this.sqliteDb.exec(migration);
      } catch {
        // Column already exists
      }
    }

    log.success('[SQLite] Database schema initialized');
  }

  /**
   * Initialize schema for PostgreSQL (async)
   */
  private async initializeSchemaAsync(): Promise<void> {
    if (!this.postgresPool) return;

    const schema = getSchemaSQL('postgres');
    const client = await this.postgresPool.connect();

    try {
      // Split by semicolon, but handle multi-line statements correctly
      // Remove comments first, then split
      const cleanedSchema = schema
        .split('\n')
        .map(line => {
          const commentIndex = line.indexOf('--');
          return commentIndex >= 0 ? line.substring(0, commentIndex) : line;
        })
        .join('\n');
      
      const statements = cleanedSchema
        .split(';')
        .map((s) => s.trim().replace(/\n\s*\n/g, '\n')) // Normalize whitespace
        .filter((s) => s.length > 0 && s.length > 10); // Filter out empty or very short strings

      log.database(`[PostgreSQL] Executing ${statements.length} schema statements`);
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        try {
          if (statement.trim().length > 0) {
            await client.query(statement);
            log.database(`[PostgreSQL] Statement ${i + 1}/${statements.length} executed successfully`);
          }
        } catch (err) {
          const error = err as Error & { code?: string };
          if (error.code === '42P07' || error.message.includes('already exists')) {
            log.database(`[PostgreSQL] Statement ${i + 1}/${statements.length} skipped (already exists)`);
          } else {
            log.error(`[PostgreSQL] Schema error on statement ${i + 1}/${statements.length}: ${error.message}`);
            log.error(`[PostgreSQL] Failed statement: ${statement.substring(0, 200)}`);
            // Don't throw - continue with other statements
          }
        }
      }

      // Migrations
      const migrations = [
        { table: 'matches', column: 'demo_file_path', type: 'TEXT' },
        { table: 'matches', column: 'veto_state', type: 'TEXT' },
        { table: 'matches', column: 'current_map', type: 'TEXT' },
        { table: 'matches', column: 'map_number', type: 'INTEGER DEFAULT 0' },
      ];

      for (const migration of migrations) {
        try {
          const checkResult = await client.query(
            `
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = $1 AND column_name = $2
          `,
            [migration.table, migration.column]
          );

          if (checkResult.rows.length === 0) {
            await client.query(
              `ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.type}`
            );
          }
        } catch (err) {
          // Ignore errors
        }
      }

      log.success('[PostgreSQL] Database schema initialized');
    } finally {
      client.release();
    }
  }

  private safeJson(value: unknown): string {
    try {
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

  private logRunResult(
    op: string,
    table: string,
    changes: number,
    lastInsertRowid?: number | string
  ): void {
    const meta = `changes=${changes}${
      lastInsertRowid !== undefined ? ` lastInsertRowid=${lastInsertRowid}` : ''
    }`;
    if (changes > 0) {
      log.success(`[DB] ${op} ${table} OK (${meta})`);
    } else {
      log.database(`[DB] ${op} ${table}: no rows changed (${meta})`);
    }
  }

  // Unified methods that work with both databases
  // For SQLite: synchronous, for PostgreSQL: async (but we'll make them all async-compatible)

  getAll<T>(table: string, where?: string, params?: unknown[]): T[] {
    if (isPostgres) {
      throw new Error(
        'getAll is synchronous but PostgreSQL requires async. Use getAllAsync instead.'
      );
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    let query = `SELECT * FROM ${table}`;
    if (where) {
      query += ` WHERE ${where}`;
    }
    const stmt = this.sqliteDb.prepare(query);
    return (params ? stmt.all(...params) : stmt.all()) as T[];
  }

  async getAllAsync<T>(table: string, where?: string, params?: unknown[]): Promise<T[]> {
    if (isPostgres && this.postgresPool) {
      let query = `SELECT * FROM ${table}`;
      if (where) {
        const converted = convertPlaceholders(where, params || []);
        query += ` WHERE ${converted.sql}`;
        params = converted.params;
      }
      const result = await this.postgresPool.query(query, params);
      return result.rows as T[];
    }
    // SQLite - call sync version
    return this.getAll<T>(table, where, params);
  }

  getOne<T>(table: string, where: string, params: unknown[]): T | undefined {
    if (isPostgres) {
      throw new Error(
        'getOne is synchronous but PostgreSQL requires async. Use getOneAsync instead.'
      );
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    const query = `SELECT * FROM ${table} WHERE ${where} LIMIT 1`;
    const stmt = this.sqliteDb.prepare(query);
    return stmt.get(...params) as T | undefined;
  }

  async getOneAsync<T>(table: string, where: string, params: unknown[]): Promise<T | undefined> {
    if (isPostgres && this.postgresPool) {
      const converted = convertPlaceholders(where, params);
      const query = `SELECT * FROM ${table} WHERE ${converted.sql} LIMIT 1`;
      const result = await this.postgresPool.query(query, converted.params);
      return (result.rows[0] as T) || undefined;
    }
    // SQLite - call sync version
    return this.getOne<T>(table, where, params);
  }

  insert(table: string, data: Record<string, unknown>): BetterSqlite3.RunResult {
    if (isPostgres) {
      throw new Error(
        'insert is synchronous but PostgreSQL requires async. Use insertAsync instead.'
      );
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    const columns = Object.keys(data).join(', ');
    const placeholders = Object.keys(data)
      .map(() => '?')
      .join(', ');
    const values = Object.values(data);
    const query = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;

    try {
      log.database(`[DB] INSERT ${table} columns=[${columns}] values=${this.safeJson(values)}`);
      const stmt = this.sqliteDb.prepare(query);
      const res = stmt.run(...values);
      const lastInsertRowid = typeof res.lastInsertRowid === 'bigint' ? Number(res.lastInsertRowid) : res.lastInsertRowid;
      this.logRunResult('INSERT', table, res.changes, lastInsertRowid);
      return res;
    } catch (err) {
      log.error(`[DB] INSERT ${table} failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async insertAsync(
    table: string,
    data: Record<string, unknown>
  ): Promise<{ changes: number; lastInsertRowid: number | string }> {
    if (isPostgres && this.postgresPool) {
      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const query = `INSERT INTO ${table} (${columns.join(
        ', '
      )}) VALUES (${placeholders}) RETURNING id`;

      try {
        log.database(
          `[DB] INSERT ${table} columns=[${columns.join(', ')}] values=${this.safeJson(values)}`
        );
        const result = await this.postgresPool.query(query, values);
        const lastInsertRowid = result.rows[0]?.id || 0;
        this.logRunResult('INSERT', table, result.rowCount || 0, lastInsertRowid);
        return { changes: result.rowCount || 0, lastInsertRowid };
      } catch (err) {
        log.error(`[DB] INSERT ${table} failed: ${(err as Error).message}`);
        throw err;
      }
    }
    // SQLite - call sync version
    const res = this.insert(table, data);
    return { changes: res.changes, lastInsertRowid: Number(res.lastInsertRowid) };
  }

  update(
    table: string,
    data: Record<string, unknown>,
    where: string,
    whereParams: unknown[]
  ): BetterSqlite3.RunResult {
    if (isPostgres) {
      throw new Error(
        'update is synchronous but PostgreSQL requires async. Use updateAsync instead.'
      );
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    const setClauses = Object.keys(data)
      .map((key) => `${key} = ?`)
      .join(', ');
    const values = [...Object.values(data), ...whereParams];
    const query = `UPDATE ${table} SET ${setClauses} WHERE ${where}`;

    try {
      log.database(`[DB] UPDATE ${table} set=${this.safeJson(data)} where="${where}"`);
      const stmt = this.sqliteDb.prepare(query);
      const res = stmt.run(...values);
      this.logRunResult('UPDATE', table, res.changes);
      return res;
    } catch (err) {
      log.error(`[DB] UPDATE ${table} failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async updateAsync(
    table: string,
    data: Record<string, unknown>,
    where: string,
    whereParams: unknown[]
  ): Promise<{ changes: number }> {
    if (isPostgres && this.postgresPool) {
      const setClauses = Object.keys(data)
        .map((key, i) => `${key} = $${i + 1}`)
        .join(', ');
      const values = [...Object.values(data), ...whereParams];
      const converted = convertPlaceholders(where, whereParams);
      // Rebuild where clause with proper parameter indices
      let whereClause = converted.sql;
      let paramOffset = Object.keys(data).length;
      whereClause = whereClause.replace(/\$(\d+)/g, (_, num) => `$${paramOffset + parseInt(num)}`);
      const query = `UPDATE ${table} SET ${setClauses} WHERE ${whereClause}`;

      try {
        log.database(`[DB] UPDATE ${table} set=${this.safeJson(data)} where="${where}"`);
        const result = await this.postgresPool.query(query, values);
        this.logRunResult('UPDATE', table, result.rowCount || 0);
        return { changes: result.rowCount || 0 };
      } catch (err) {
        log.error(`[DB] UPDATE ${table} failed: ${(err as Error).message}`);
        throw err;
      }
    }
    // SQLite - call sync version
    const res = this.update(table, data, where, whereParams);
    return { changes: res.changes };
  }

  delete(table: string, where: string, params: unknown[]): BetterSqlite3.RunResult {
    if (isPostgres) {
      throw new Error(
        'delete is synchronous but PostgreSQL requires async. Use deleteAsync instead.'
      );
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    const query = `DELETE FROM ${table} WHERE ${where}`;
    try {
      log.database(`[DB] DELETE ${table} where="${where}"`);
      const stmt = this.sqliteDb.prepare(query);
      const res = stmt.run(...params);
      this.logRunResult('DELETE', table, res.changes);
      return res;
    } catch (err) {
      log.error(`[DB] DELETE ${table} failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async deleteAsync(table: string, where: string, params: unknown[]): Promise<{ changes: number }> {
    if (isPostgres && this.postgresPool) {
      const converted = convertPlaceholders(where, params);
      const query = `DELETE FROM ${table} WHERE ${converted.sql}`;
      try {
        log.database(`[DB] DELETE ${table} where="${where}"`);
        const result = await this.postgresPool.query(query, converted.params);
        this.logRunResult('DELETE', table, result.rowCount || 0);
        return { changes: result.rowCount || 0 };
      } catch (err) {
        log.error(`[DB] DELETE ${table} failed: ${(err as Error).message}`);
        throw err;
      }
    }
    // SQLite - call sync version
    const res = this.delete(table, where, params);
    return { changes: res.changes };
  }

  run(sql: string, params: unknown[] = []): BetterSqlite3.RunResult {
    if (isPostgres) {
      throw new Error('run is synchronous but PostgreSQL requires async. Use runAsync instead.');
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    try {
      log.database(`[DB] RUN sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
      const stmt = this.sqliteDb.prepare(sql);
      const res = stmt.run(...params);
      const lastInsertRowid = typeof res.lastInsertRowid === 'bigint' ? Number(res.lastInsertRowid) : res.lastInsertRowid;
      this.logRunResult('RUN', 'custom', res.changes, lastInsertRowid);
      return res;
    } catch (err) {
      log.error(`[DB] RUN failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async runAsync(
    sql: string,
    params: unknown[] = []
  ): Promise<{ changes: number; lastInsertRowid?: number | string }> {
    if (isPostgres && this.postgresPool) {
      try {
        log.database(`[DB] RUN sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
        const converted = convertPlaceholders(sql, params);
        const result = await this.postgresPool.query(converted.sql, converted.params);
        const lastInsertRowid = result.rows[0]?.id;
        this.logRunResult('RUN', 'custom', result.rowCount || 0, lastInsertRowid);
        return { changes: result.rowCount || 0, lastInsertRowid };
      } catch (err) {
        log.error(`[DB] RUN failed: ${(err as Error).message}`);
        throw err;
      }
    }
    // SQLite - call sync version
    const res = this.run(sql, params);
    return { changes: res.changes, lastInsertRowid: Number(res.lastInsertRowid) };
  }

  exec(sql: string): void {
    if (isPostgres) {
      throw new Error('exec is synchronous but PostgreSQL requires async. Use execAsync instead.');
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    try {
      log.database(`[DB] EXEC sql=${JSON.stringify(sql)}`);
      this.sqliteDb.exec(sql);
      log.success('[DB] EXEC OK');
    } catch (err) {
      log.error(`[DB] EXEC failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async execAsync(sql: string): Promise<void> {
    if (isPostgres && this.postgresPool) {
      try {
        log.database(`[DB] EXEC sql=${JSON.stringify(sql)}`);
        await this.postgresPool.query(sql);
        log.success('[DB] EXEC OK');
      } catch (err) {
        log.error(`[DB] EXEC failed: ${(err as Error).message}`);
        throw err;
      }
    } else {
      // SQLite - call sync version
      this.exec(sql);
    }
  }

  query<T>(sql: string, params?: unknown[]): T[] {
    if (isPostgres) {
      throw new Error(
        'query is synchronous but PostgreSQL requires async. Use queryAsync instead.'
      );
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    try {
      log.database(`[DB] QUERY sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
      const stmt = this.sqliteDb.prepare(sql);
      const res = (params ? stmt.all(...params) : stmt.all()) as T[];
      log.database(`[DB] QUERY OK rows=${res.length}`);
      return res;
    } catch (err) {
      log.error(`[DB] QUERY failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async queryAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (isPostgres && this.postgresPool) {
      try {
        log.database(`[DB] QUERY sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
        const converted = params ? convertPlaceholders(sql, params) : { sql, params: [] };
        const result = await this.postgresPool.query(converted.sql, converted.params);
        log.database(`[DB] QUERY OK rows=${result.rows.length}`);
        return result.rows as T[];
      } catch (err) {
        log.error(`[DB] QUERY failed: ${(err as Error).message}`);
        throw err;
      }
    }
    // SQLite - call sync version
    return this.query<T>(sql, params);
  }

  queryOne<T>(sql: string, params?: unknown[]): T | undefined {
    if (isPostgres) {
      throw new Error(
        'queryOne is synchronous but PostgreSQL requires async. Use queryOneAsync instead.'
      );
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    try {
      log.database(`[DB] QUERY ONE sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
      const stmt = this.sqliteDb.prepare(sql);
      const row = (params ? stmt.get(...params) : stmt.get()) as T | undefined;
      log.database(`[DB] QUERY ONE OK ${row ? 'found' : 'not found'}`);
      return row;
    } catch (err) {
      log.error(`[DB] QUERY ONE failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async queryOneAsync<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    if (isPostgres && this.postgresPool) {
      try {
        log.database(`[DB] QUERY ONE sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
        const converted = params ? convertPlaceholders(sql, params) : { sql, params: [] };
        const result = await this.postgresPool.query(converted.sql, converted.params);
        log.database(`[DB] QUERY ONE OK ${result.rows[0] ? 'found' : 'not found'}`);
        return (result.rows[0] as T) || undefined;
      } catch (err) {
        log.error(`[DB] QUERY ONE failed: ${(err as Error).message}`);
        throw err;
      }
    }
    // SQLite - call sync version
    return this.queryOne<T>(sql, params);
  }

  getAppSetting(key: string): string | null {
    if (isPostgres) {
      throw new Error(
        'getAppSetting is synchronous but PostgreSQL requires async. Use getAppSettingAsync instead.'
      );
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    try {
      const stmt = this.sqliteDb.prepare('SELECT value FROM app_settings WHERE key = ?');
      const row = stmt.get(key) as { value: string | null } | undefined;
      log.database(`[DB] SETTINGS get key=${key} ${row ? 'found' : 'missing'}`);
      return row?.value ?? null;
    } catch (err) {
      log.error(`[DB] SETTINGS get failed for key=${key}: ${(err as Error).message}`);
      throw err;
    }
  }

  async getAppSettingAsync(key: string): Promise<string | null> {
    if (isPostgres && this.postgresPool) {
      try {
        const result = await this.postgresPool.query(
          'SELECT value FROM app_settings WHERE key = $1',
          [key]
        );
        const row = result.rows[0];
        log.database(`[DB] SETTINGS get key=${key} ${row ? 'found' : 'missing'}`);
        return row?.value ?? null;
      } catch (err) {
        log.error(`[DB] SETTINGS get failed for key=${key}: ${(err as Error).message}`);
        throw err;
      }
    }
    // SQLite - call sync version
    return this.getAppSetting(key);
  }

  setAppSetting(key: string, value: string | null): void {
    if (isPostgres) {
      throw new Error(
        'setAppSetting is synchronous but PostgreSQL requires async. Use setAppSettingAsync instead.'
      );
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    const trimmedKey = key.trim();
    if (!trimmedKey) {
      throw new Error('Setting key is required');
    }

    try {
      if (value === null) {
        const stmt = this.sqliteDb.prepare('DELETE FROM app_settings WHERE key = ?');
        const res = stmt.run(trimmedKey);
        this.logRunResult('DELETE', `app_settings(${trimmedKey})`, res.changes);
        return;
      }

      const stmt = this.sqliteDb.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, strftime('%s', 'now'))
        ON CONFLICT(key)
        DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      const res = stmt.run(trimmedKey, value);
      this.logRunResult('UPSERT', `app_settings(${trimmedKey})`, res.changes);
    } catch (err) {
      log.error(`[DB] SETTINGS set failed for key=${trimmedKey}: ${(err as Error).message}`);
      throw err;
    }
  }

  async setAppSettingAsync(key: string, value: string | null): Promise<void> {
    if (isPostgres && this.postgresPool) {
      const trimmedKey = key.trim();
      if (!trimmedKey) {
        throw new Error('Setting key is required');
      }

      try {
        if (value === null) {
          const result = await this.postgresPool.query('DELETE FROM app_settings WHERE key = $1', [
            trimmedKey,
          ]);
          this.logRunResult('DELETE', `app_settings(${trimmedKey})`, result.rowCount || 0);
          return;
        }

        const result = await this.postgresPool.query(
          `
          INSERT INTO app_settings (key, value, updated_at)
          VALUES ($1, $2, EXTRACT(EPOCH FROM NOW())::INTEGER)
          ON CONFLICT(key)
          DO UPDATE SET value = EXCLUDED.value, updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
        `,
          [trimmedKey, value]
        );
        this.logRunResult('UPSERT', `app_settings(${trimmedKey})`, result.rowCount || 0);
      } catch (err) {
        log.error(`[DB] SETTINGS set failed for key=${trimmedKey}: ${(err as Error).message}`);
        throw err;
      }
    } else {
      // SQLite - call sync version
      this.setAppSetting(key, value);
    }
  }

  getAllAppSettings(): Array<{ key: string; value: string | null; updated_at: number }> {
    if (isPostgres) {
      throw new Error(
        'getAllAppSettings is synchronous but PostgreSQL requires async. Use getAllAppSettingsAsync instead.'
      );
    }
    if (!this.sqliteDb) throw new Error('Database not initialized');

    try {
      const stmt = this.sqliteDb.prepare('SELECT key, value, updated_at FROM app_settings');
      const rows = stmt.all() as Array<{ key: string; value: string | null; updated_at: number }>;
      log.database(`[DB] SETTINGS getAll count=${rows.length}`);
      return rows;
    } catch (err) {
      log.error(`[DB] SETTINGS getAll failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async getAllAppSettingsAsync(): Promise<
    Array<{ key: string; value: string | null; updated_at: number }>
  > {
    if (isPostgres && this.postgresPool) {
      try {
        const result = await this.postgresPool.query(
          'SELECT key, value, updated_at FROM app_settings'
        );
        log.database(`[DB] SETTINGS getAll count=${result.rows.length}`);
        return result.rows as Array<{ key: string; value: string | null; updated_at: number }>;
      } catch (err) {
        log.error(`[DB] SETTINGS getAll failed: ${(err as Error).message}`);
        throw err;
      }
    }
    // SQLite - call sync version
    return this.getAllAppSettings();
  }

  close(): void {
    if (this.sqliteDb) {
      this.sqliteDb.close();
      log.database('[SQLite] Database connection closed');
    }
    if (this.postgresPool) {
      this.postgresPool.end().catch((err) => {
        log.error('Failed to close PostgreSQL pool', err as Error);
      });
      log.database('[PostgreSQL] Database pool closed');
    }
  }
}

// Export singleton instance
export const db = new DatabaseManager();

// Initialize database on import if PostgreSQL
if (isPostgres) {
  db.init().catch((err) => {
    log.error('Failed to initialize PostgreSQL database', err as Error);
    process.exit(1);
  });
}
