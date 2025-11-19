/**
 * Database manager with PostgreSQL support
 * Provides unified async interface
 */

import { Pool } from 'pg';
import { log } from '../utils/logger';
import { getSchemaSQL, getDefaultMapsSQL, getDefaultMapPoolsSQL } from './database.schema';

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
 * Database class for PostgreSQL
 */
class DatabaseManager {
  private postgresPool?: Pool;
  private initialized = false;

  constructor() {
    // PostgreSQL - will be initialized asynchronously
    const connString =
      process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${
        process.env.DB_HOST || 'localhost'
      }:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'matchzy_tournament'}`;

    this.postgresPool = new Pool({
      connectionString: connString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    log.database(`[PostgreSQL] Database pool created: ${connString.replace(/:[^:@]+@/, ':****@')}`);
  }

  /**
   * Initialize database connection
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.postgresPool) {
      throw new Error('PostgreSQL pool not initialized');
    }

    // Test connection
    const client = await this.postgresPool.connect();
    try {
      await client.query('SELECT 1');
      log.database('[PostgreSQL] Database connection successful');
    } finally {
      client.release();
    }
    await this.initializeSchemaAsync();
    this.initialized = true;
  }

  /**
   * Initialize schema for PostgreSQL (async)
   */
  private async initializeSchemaAsync(): Promise<void> {
    if (!this.postgresPool) return;

    const schema = getSchemaSQL();
    const client = await this.postgresPool.connect();

    try {
      // Split by semicolon, but handle multi-line statements correctly
      // Remove comments first, then split
      const cleanedSchema = schema
        .split('\n')
        .map((line) => {
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
            log.database(
              `[PostgreSQL] Statement ${i + 1}/${statements.length} executed successfully`
            );
          }
        } catch (err) {
          const error = err as Error & { code?: string };
          if (error.code === '42P07' || error.message.includes('already exists')) {
            log.database(
              `[PostgreSQL] Statement ${i + 1}/${statements.length} skipped (already exists)`
            );
          } else {
            log.error(
              `[PostgreSQL] Schema error on statement ${i + 1}/${statements.length}: ${
                error.message
              }`
            );
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
        { table: 'map_pools', column: 'enabled', type: 'INTEGER NOT NULL DEFAULT 1' },
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
        } catch {
          // Ignore errors
        }
      }

      // Insert default maps (only if maps table is empty - first initialization or after wipe)
      // This prevents fetching from GitHub on every server restart/reload
      // But ensures maps are regenerated when database is wiped
      try {
        // The maps table should exist at this point (created by schema SQL above)
        // But handle the case where it might not exist yet
        let mapsCount = 0;
        try {
          const mapsCheck = await client.query('SELECT COUNT(*) as count FROM maps');
          mapsCount = parseInt(mapsCheck.rows[0]?.count || '0', 10);
        } catch (err) {
          const error = err as Error;
          // If table doesn't exist, that's unexpected but we'll skip map insertion
          if (error.message.includes('does not exist')) {
            log.warn('[PostgreSQL] Maps table does not exist, skipping map insertion');
            return;
          }
          throw err; // Re-throw other errors
        }

        if (mapsCount === 0) {
          // Maps table is empty - this is first initialization or after database wipe
          // Fetch fresh maps from GitHub repository
          log.database('[PostgreSQL] Maps table is empty, fetching and inserting default maps from GitHub...');
          const defaultMapsSQL = await getDefaultMapsSQL();
          await client.query(defaultMapsSQL);
          log.success('[PostgreSQL] Default maps inserted (fetched from GitHub)');
        } else {
          // Maps already exist - skip fetching from wiki (saves time and API calls)
          log.database(
            `[PostgreSQL] Maps table already has ${mapsCount} maps, skipping map insertion`
          );
        }
      } catch (err) {
        const error = err as Error;
        log.warn(`[PostgreSQL] Failed to insert default maps: ${error.message}`);
        // Don't throw - continue
      }

      // Insert default map pools
      try {
        const defaultMapPoolsSQL = await getDefaultMapPoolsSQL(client);
        await client.query(defaultMapPoolsSQL);
        log.database('[PostgreSQL] Default map pools inserted');
      } catch (err) {
        const error = err as Error;
        log.warn(`[PostgreSQL] Failed to insert default map pools: ${error.message}`);
        // Don't throw - continue
      }

      log.success('[PostgreSQL] Database schema initialized');
    } finally {
      client.release();
    }
  }

  /**
   * Reset database by dropping all tables and reinitializing schema
   * This will recreate all tables and insert default data (maps, map pools)
   */
  async resetDatabase(): Promise<void> {
    if (!this.postgresPool) {
      throw new Error('Database not initialized');
    }

    const client = await this.postgresPool.connect();
    try {
      log.warn('[PostgreSQL] Resetting database - dropping all tables');

      // Disable foreign key checks temporarily by dropping tables in correct order
      // Drop tables in reverse order of dependencies to avoid foreign key constraint errors
      const tablesToDrop = [
        'match_map_results',
        'match_events',
        'matches',
        'tournament',
        'teams',
        'map_pools',
        'maps',
        'app_settings',
        'servers',
      ];

      // Drop all tables (CASCADE will handle foreign keys)
      for (const table of tablesToDrop) {
        try {
          await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
          log.database(`[PostgreSQL] Dropped table: ${table}`);
        } catch (err) {
          const error = err as Error;
          // Ignore "table does not exist" errors
          if (!error.message.includes('does not exist')) {
            log.warn(`[PostgreSQL] Error dropping table ${table}: ${error.message}`);
          }
        }
      }

      // Reset sequences (in case any were created)
      try {
        await client.query(`
          DO $$ 
          DECLARE 
            r RECORD;
          BEGIN
            FOR r IN (SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public') 
            LOOP
              EXECUTE 'DROP SEQUENCE IF EXISTS ' || quote_ident(r.sequence_name) || ' CASCADE';
            END LOOP;
          END $$;
        `);
        log.database('[PostgreSQL] Reset all sequences');
      } catch (err) {
        const error = err as Error;
        log.warn(`[PostgreSQL] Error resetting sequences: ${error.message}`);
      }

      // Reset initialized flag so schema can be recreated
      this.initialized = false;

      // Reinitialize schema (this will create tables and insert default data)
      // Maps will be regenerated from GitHub since maps table is now empty
      log.database('[PostgreSQL] Reinitializing schema and regenerating maps from GitHub...');
      await this.initializeSchemaAsync();
      this.initialized = true;

      log.success('[PostgreSQL] Database reset completed successfully');
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

  async getAllAsync<T>(table: string, where?: string, params?: unknown[]): Promise<T[]> {
    if (!this.postgresPool) throw new Error('Database not initialized');
    let query = `SELECT * FROM ${table}`;
    if (where) {
      const converted = convertPlaceholders(where, params || []);
      query += ` WHERE ${converted.sql}`;
      params = converted.params;
    }
    const result = await this.postgresPool.query(query, params);
    return result.rows as T[];
  }

  async getOneAsync<T>(table: string, where: string, params: unknown[]): Promise<T | undefined> {
    if (!this.postgresPool) throw new Error('Database not initialized');
    const converted = convertPlaceholders(where, params);
    const query = `SELECT * FROM ${table} WHERE ${converted.sql} LIMIT 1`;
    const result = await this.postgresPool.query(query, converted.params);
    return (result.rows[0] as T) || undefined;
  }

  async insertAsync(
    table: string,
    data: Record<string, unknown>
  ): Promise<{ changes: number; lastInsertRowid: number | string }> {
    if (!this.postgresPool) throw new Error('Database not initialized');
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

  async updateAsync(
    table: string,
    data: Record<string, unknown>,
    where: string,
    whereParams: unknown[]
  ): Promise<{ changes: number }> {
    if (!this.postgresPool) throw new Error('Database not initialized');
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

  async deleteAsync(table: string, where: string, params: unknown[]): Promise<{ changes: number }> {
    if (!this.postgresPool) throw new Error('Database not initialized');
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

  async runAsync(
    sql: string,
    params: unknown[] = []
  ): Promise<{ changes: number; lastInsertRowid?: number | string }> {
    if (!this.postgresPool) throw new Error('Database not initialized');
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

  async execAsync(sql: string): Promise<void> {
    if (!this.postgresPool) throw new Error('Database not initialized');
    try {
      log.database(`[DB] EXEC sql=${JSON.stringify(sql)}`);
      await this.postgresPool.query(sql);
      log.success('[DB] EXEC OK');
    } catch (err) {
      log.error(`[DB] EXEC failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async queryAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.postgresPool) throw new Error('Database not initialized');
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

  async queryOneAsync<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    if (!this.postgresPool) throw new Error('Database not initialized');
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

  async getAppSettingAsync(key: string): Promise<string | null> {
    if (!this.postgresPool) throw new Error('Database not initialized');
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

  async setAppSettingAsync(key: string, value: string | null): Promise<void> {
    if (!this.postgresPool) throw new Error('Database not initialized');
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
  }

  async getAllAppSettingsAsync(): Promise<
    Array<{ key: string; value: string | null; updated_at: number }>
  > {
    if (!this.postgresPool) throw new Error('Database not initialized');
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

  close(): void {
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

// Note: Database initialization must be called explicitly via db.init()
// This is done in src/index.ts before starting the server
