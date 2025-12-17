import { Pool, Client } from 'pg';
import { log } from '../utils/logger';
import type { DatabaseAdapter } from './database.interface';
import { getSchemaSQL } from './database.schema';

/**
 * Helper to convert ? placeholders to PostgreSQL placeholders ($1, $2, etc.)
 */
function convertPlaceholders(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  if (sql.includes('?')) {
    let paramIndex = 1;
    const convertedSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    return { sql: convertedSql, params };
  }
  return { sql, params };
}

/**
 * PostgreSQL adapter
 */
export class PostgresAdapter implements DatabaseAdapter {
  private pool: Pool;
  private client?: Client;

  constructor(connectionString?: string) {
    const connString = connectionString || process.env.DATABASE_URL || 
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'matchzy_tournament'}`;

    this.pool = new Pool({
      connectionString: connString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    log.database(`[PostgreSQL] Database pool created: ${connString.replace(/:[^:@]+@/, ':****@')}`);
  }

  async connect(): Promise<void> {
    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      log.database('[PostgreSQL] Database connection successful');
    } finally {
      client.release();
    }
    await this.initializeSchema();
  }

  async close(): Promise<void> {
    await this.pool.end();
    if (this.client) {
      await this.client.end();
    }
    log.database('[PostgreSQL] Database connection closed');
  }

  async initializeSchema(): Promise<void> {
    const schema = getSchemaSQL();
    const client = await this.pool.connect();

    try {
      // Split by semicolon and execute each statement
      const statements = schema
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        try {
          await client.query(statement);
        } catch (err) {
          // Ignore "already exists" errors
          const error = err as Error & { code?: string };
          if (error.code !== '42P07' && !error.message.includes('already exists')) {
            log.error(`[PostgreSQL] Schema initialization error: ${error.message}`);
            throw err;
          }
        }
      }

      // Handle migrations (check if columns exist before adding)
      const migrations = [
        { table: 'matches', column: 'demo_file_path', type: 'TEXT' },
        { table: 'matches', column: 'veto_state', type: 'TEXT' },
        { table: 'matches', column: 'current_map', type: 'TEXT' },
        { table: 'matches', column: 'map_number', type: 'INTEGER DEFAULT 0' },
        { table: 'map_pools', column: 'enabled', type: 'INTEGER NOT NULL DEFAULT 1' },
        { table: 'tournament_templates', column: 'team_ids', type: 'TEXT' },
        { table: 'tournament', column: 'map_sequence', type: 'TEXT' },
        { table: 'tournament', column: 'team_size', type: 'INTEGER DEFAULT 5' },
        { table: 'tournament', column: 'round_limit_type', type: 'TEXT' },
        { table: 'tournament', column: 'max_rounds', type: 'INTEGER DEFAULT 24' },
        { table: 'tournament', column: 'overtime_mode', type: 'TEXT DEFAULT \'enabled\'' },
        { table: 'tournament', column: 'overtime_segments', type: 'INTEGER' },
        { table: 'tournament', column: 'elo_template_id', type: 'TEXT' },
        { table: 'player_rating_history', column: 'base_elo_after', type: 'INTEGER' },
        { table: 'player_rating_history', column: 'stat_adjustment', type: 'INTEGER' },
        { table: 'player_rating_history', column: 'template_id', type: 'TEXT' },
        { table: 'player_match_stats', column: 'flash_assists', type: 'INTEGER' },
        { table: 'player_match_stats', column: 'utility_damage', type: 'INTEGER' },
        { table: 'player_match_stats', column: 'kast', type: 'REAL' },
        { table: 'player_match_stats', column: 'mvps', type: 'INTEGER' },
        { table: 'player_match_stats', column: 'score', type: 'INTEGER' },
        { table: 'player_match_stats', column: 'rounds_played', type: 'INTEGER' },
      ];

      // Check if tournament_templates table exists, create if not
      try {
        const tableCheck = await client.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'tournament_templates'
          )`
        );
        if (!tableCheck.rows[0].exists) {
          // Table doesn't exist, create it
          await client.query(`
            CREATE TABLE tournament_templates (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT,
              type TEXT NOT NULL,
              format TEXT NOT NULL,
              map_pool_id INTEGER,
              maps TEXT,
              team_ids TEXT,
              settings TEXT NOT NULL,
              created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
              updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
              FOREIGN KEY (map_pool_id) REFERENCES map_pools(id) ON DELETE SET NULL
            );
            CREATE INDEX idx_tournament_templates_name ON tournament_templates(name);
            CREATE INDEX idx_tournament_templates_type ON tournament_templates(type);
          `);
        }
      } catch (err) {
        // Only ignore "table already exists" errors, log others
        const error = err as Error;
        if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
          log.warn(`[PostgreSQL] Table creation warning: ${error.message}`);
        }
      }

      for (const migration of migrations) {
        try {
          // Check if column exists
          const checkResult = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = $1 AND column_name = $2
          `, [migration.table, migration.column]);

          if (checkResult.rows.length === 0) {
            await client.query(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.type}`);
          }
        } catch (err) {
          // Column might already exist or table doesn't exist yet
          const error = err as Error;
          if (!error.message.includes('already exists') && !error.message.includes('duplicate')) {
            log.warn(`[PostgreSQL] Migration warning: ${error.message}`);
          }
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

  private logRunResult(op: string, table: string, changes: number, lastInsertRowid?: number | string): void {
    const meta = `changes=${changes}${lastInsertRowid !== undefined ? ` lastInsertRowid=${lastInsertRowid}` : ''}`;
    if (changes > 0) {
      log.success(`[DB] ${op} ${table} OK (${meta})`);
    } else {
      log.database(`[DB] ${op} ${table}: no rows changed (${meta})`);
    }
  }

  async getAll<T>(table: string, where?: string, params?: unknown[]): Promise<T[]> {
    let query = `SELECT * FROM ${table}`;
    if (where) {
      const converted = convertPlaceholders(where, params || []);
      query += ` WHERE ${converted.sql}`;
      params = converted.params;
    }
    const result = await this.pool.query(query, params);
    return result.rows as T[];
  }

  async getOne<T>(table: string, where: string, params: unknown[]): Promise<T | undefined> {
    const converted = convertPlaceholders(where, params);
    const query = `SELECT * FROM ${table} WHERE ${converted.sql} LIMIT 1`;
    const result = await this.pool.query(query, converted.params);
    return (result.rows[0] as T) || undefined;
  }

  async insert(table: string, data: Record<string, unknown>): Promise<{ changes: number; lastInsertRowid: number | string }> {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`;

    try {
      log.database(`[DB] INSERT ${table} columns=[${columns.join(', ')}] values=${this.safeJson(values)}`);
      const result = await this.pool.query(query, values);
      const lastInsertRowid = result.rows[0]?.id || 0;
      this.logRunResult('INSERT', table, result.rowCount || 0, lastInsertRowid);
      return { changes: result.rowCount || 0, lastInsertRowid };
    } catch (err) {
      log.error(`[DB] INSERT ${table} failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async update(table: string, data: Record<string, unknown>, where: string, whereParams: unknown[]): Promise<{ changes: number }> {
    const setClauses = Object.keys(data).map((key, i) => `${key} = $${i + 1}`).join(', ');
    const values = [...Object.values(data), ...whereParams];
    const converted = convertPlaceholders(where, whereParams);
    const whereClause = converted.sql.replace(/\?/g, (_, offset) => {
      const paramIndex = Object.keys(data).length + Math.floor(offset / 2) + 1;
      return `$${paramIndex}`;
    });
    const query = `UPDATE ${table} SET ${setClauses} WHERE ${whereClause}`;

    try {
      log.database(`[DB] UPDATE ${table} set=${this.safeJson(data)} where="${where}"`);
      const result = await this.pool.query(query, values);
      this.logRunResult('UPDATE', table, result.rowCount || 0);
      return { changes: result.rowCount || 0 };
    } catch (err) {
      log.error(`[DB] UPDATE ${table} failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async delete(table: string, where: string, params: unknown[]): Promise<{ changes: number }> {
    const converted = convertPlaceholders(where, params);
    const query = `DELETE FROM ${table} WHERE ${converted.sql}`;
    try {
      log.database(`[DB] DELETE ${table} where="${where}"`);
      const result = await this.pool.query(query, converted.params);
      this.logRunResult('DELETE', table, result.rowCount || 0);
      return { changes: result.rowCount || 0 };
    } catch (err) {
      log.error(`[DB] DELETE ${table} failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid?: number | string }> {
    try {
      log.database(`[DB] RUN sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
      const converted = convertPlaceholders(sql, params);
      const result = await this.pool.query(converted.sql, converted.params);
      const lastInsertRowid = result.rows[0]?.id;
      this.logRunResult('RUN', 'custom', result.rowCount || 0, lastInsertRowid);
      return { changes: result.rowCount || 0, lastInsertRowid };
    } catch (err) {
      log.error(`[DB] RUN failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async exec(sql: string): Promise<void> {
    try {
      log.database(`[DB] EXEC sql=${JSON.stringify(sql)}`);
      await this.pool.query(sql);
      log.success('[DB] EXEC OK');
    } catch (err) {
      log.error(`[DB] EXEC failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    try {
      log.database(`[DB] QUERY sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
      const converted = params ? convertPlaceholders(sql, params) : { sql, params: [] };
      const result = await this.pool.query(converted.sql, converted.params);
      log.database(`[DB] QUERY OK rows=${result.rows.length}`);
      return result.rows as T[];
    } catch (err) {
      log.error(`[DB] QUERY failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async queryOne<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    try {
      log.database(`[DB] QUERY ONE sql=${JSON.stringify(sql)} params=${this.safeJson(params)}`);
      const converted = params ? convertPlaceholders(sql, params) : { sql, params: [] };
      const result = await this.pool.query(converted.sql, converted.params);
      log.database(`[DB] QUERY ONE OK ${result.rows[0] ? 'found' : 'not found'}`);
      return (result.rows[0] as T) || undefined;
    } catch (err) {
      log.error(`[DB] QUERY ONE failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async getAppSetting(key: string): Promise<string | null> {
    try {
      const result = await this.pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
      const row = result.rows[0];
      log.database(`[DB] SETTINGS get key=${key} ${row ? 'found' : 'missing'}`);
      return row?.value ?? null;
    } catch (err) {
      log.error(`[DB] SETTINGS get failed for key=${key}: ${(err as Error).message}`);
      throw err;
    }
  }

  async setAppSetting(key: string, value: string | null): Promise<void> {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      throw new Error('Setting key is required');
    }

    try {
      if (value === null) {
        const result = await this.pool.query('DELETE FROM app_settings WHERE key = $1', [trimmedKey]);
        this.logRunResult('DELETE', `app_settings(${trimmedKey})`, result.rowCount || 0);
        return;
      }

      const result = await this.pool.query(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ($1, $2, EXTRACT(EPOCH FROM NOW())::INTEGER)
        ON CONFLICT(key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
      `, [trimmedKey, value]);
      this.logRunResult('UPSERT', `app_settings(${trimmedKey})`, result.rowCount || 0);
    } catch (err) {
      log.error(`[DB] SETTINGS set failed for key=${trimmedKey}: ${(err as Error).message}`);
      throw err;
    }
  }

  async getAllAppSettings(): Promise<Array<{ key: string; value: string | null; updated_at: number }>> {
    try {
      const result = await this.pool.query('SELECT key, value, updated_at FROM app_settings');
      log.database(`[DB] SETTINGS getAll count=${result.rows.length}`);
      return result.rows as Array<{ key: string; value: string | null; updated_at: number }>;
    } catch (err) {
      log.error(`[DB] SETTINGS getAll failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
