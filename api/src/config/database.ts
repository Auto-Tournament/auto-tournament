/**
 * Database manager with PostgreSQL support
 * Provides unified async interface.
 *
 * Verbose per-query logging can be enabled with:
 *   LOG_DB_VERBOSE=true
 *
 * When disabled (default), only high-level success logs and errors are written,
 * which keeps dev/prod log files focused on actions instead of every SQL call.
 */

import { Pool, type PoolClient } from 'pg';
import { log, LOG_DB_VERBOSE, LOG_DB_VALUES } from '../utils/logger';
import {
  safeLogJson,
  redactParamsForLog,
  redactInsertValuesForLog,
} from '../utils/dbLogRedaction';
import { getSchemaSQL, getSchemaColumns } from './database.schema';
import { runSchemaMigrations } from './schemaMigrations';
import { markModuleMigrationsFailed, runModuleMigrations } from './moduleMigrations';
import { CS2_MODULE_ID, handOverCs2Tables } from './cs2TableHandover';

const MAX_DB_VALUES_SAMPLE = 5;

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
        // Default to explicit IPv4 loopback instead of "localhost" so we don't
        // accidentally hit ::1 (IPv6) on hosts where Docker only binds 127.0.0.1.
        process.env.DB_HOST || '127.0.0.1'
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

      // gen_random_uuid() (players.uid) is built in from Postgres 13.
      try {
        const { rows } = await client.query<{ server_version_num: string }>(
          'SHOW server_version_num'
        );
        const version = Number(rows[0]?.server_version_num);
        if (Number.isFinite(version) && version < 130000) {
          log.error(
            `[PostgreSQL] Postgres ${version} is older than 13, which this version needs (gen_random_uuid). Upgrade Postgres.`
          );
        }
      } catch (err) {
        log.warn(`[PostgreSQL] Could not read the server version: ${(err as Error).message}`);
      }

      log.database(`[PostgreSQL] Executing ${statements.length} schema statements`);
      // An index on a column that an upgraded database does not have yet fails
      // here with "column does not exist": the column is only added by the
      // migrations below. Those indexes are retried once the columns exist,
      // rather than being logged as a schema error and silently never created.
      const deferredIndexes: string[] = [];
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
          if (error.code === '42703' && /^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(statement)) {
            deferredIndexes.push(statement);
          } else if (error.code === '42P07' || error.message.includes('already exists')) {
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

      // Column migrations, derived from the schema itself so the two cannot drift.
      // See getSchemaColumns() for why this is not a hand-maintained list.
      const migrations = getSchemaColumns();

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
              updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
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

      // One lookup for the whole database rather than one per column.
      const existingColumns = new Set<string>();
      const existingTables = new Set<string>();
      try {
        const { rows } = await client.query<{ table_name: string; column_name: string }>(
          `SELECT table_name, column_name
           FROM information_schema.columns
           WHERE table_schema = current_schema()`
        );
        for (const row of rows) {
          existingTables.add(row.table_name);
          existingColumns.add(`${row.table_name}.${row.column_name}`);
        }
      } catch (err) {
        log.error(
          `[PostgreSQL] Could not read existing columns, skipping migrations: ${
            (err as Error).message
          }`
        );
      }

      let added = 0;
      for (const migration of migrations) {
        // A table that does not exist yet was just created from the schema with
        // all its columns, or genuinely is not ours to touch.
        if (!existingTables.has(migration.table)) continue;
        if (existingColumns.has(`${migration.table}.${migration.column}`)) continue;

        try {
          await client.query(
            `ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.type}`
          );
          added++;
          log.success(
            `[PostgreSQL] Added missing column ${migration.table}.${migration.column} (${migration.type})`
          );
        } catch (err) {
          // Keep going: one column we cannot add should not stop the rest, but it
          // must be visible - a silently skipped migration is how an upgraded
          // instance ends up querying a column that is not there.
          log.error(
            `[PostgreSQL] Failed to add ${migration.table}.${migration.column}: ${
              (err as Error).message
            }`
          );
        }
      }
      if (added > 0) {
        log.success(`[PostgreSQL] Applied ${added} column migration(s)`);
      }

      // Rating history used to cascade away with its match, so deleting a
      // tournament left ratings with no history behind them. It now survives
      // as an orphan (match_slug NULL); upgrade the old NOT NULL + CASCADE key.
      try {
        const { rows } = await client.query<{ conname: string }>(
          `SELECT c.conname
             FROM pg_constraint c
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
            WHERE c.conrelid = to_regclass('player_rating_history')
              AND c.contype = 'f' AND c.confdeltype = 'c' AND a.attname = 'match_slug'`
        );
        for (const { conname } of rows) {
          await client.query('BEGIN');
          try {
            await client.query(
              'ALTER TABLE player_rating_history ALTER COLUMN match_slug DROP NOT NULL'
            );
            await client.query(`ALTER TABLE player_rating_history DROP CONSTRAINT "${conname}"`);
            await client.query(
              `ALTER TABLE player_rating_history ADD CONSTRAINT "${conname}"
                 FOREIGN KEY (match_slug) REFERENCES matches(slug) ON DELETE SET NULL`
            );
            await client.query(
              `UPDATE player_rating_history prh
                  SET match_label = COALESCE(prh.match_label, t1.name || ' vs ' || t2.name, m.slug),
                      tournament_name = COALESCE(prh.tournament_name, t.name)
                 FROM matches m
                 LEFT JOIN tournament t ON t.id = m.tournament_id
                 LEFT JOIN teams t1 ON t1.id = m.team1_id
                 LEFT JOIN teams t2 ON t2.id = m.team2_id
                WHERE m.slug = prh.match_slug`
            );
            await client.query('COMMIT');
            log.success('[PostgreSQL] Rating history now survives match deletion');
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          }
        }
      } catch (err) {
        log.error(
          `[PostgreSQL] Failed to migrate rating history foreign key: ${(err as Error).message}`
        );
      }

      for (const statement of deferredIndexes) {
        try {
          await client.query(statement);
        } catch (err) {
          log.error(
            `[PostgreSQL] Failed to create index after column migrations: ${(err as Error).message}`
          );
          log.error(`[PostgreSQL] Failed statement: ${statement.substring(0, 200)}`);
        }
      }

      // Foreign keys onto players(uid). Not declared inline: on an upgraded
      // instance players.uid only exists after the column migrations and its
      // unique index (deferred above), so the CREATE TABLE would fail.
      const uidForeignKeys: Array<{ table: string; column: string }> = [
        { table: 'player_games', column: 'player_uid' },
        // 3.0 phase D: team membership and reported custom stats.
        { table: 'team_members', column: 'account_uid' },
        { table: 'match_stat_values', column: 'player_uid' },
      ];
      for (const { table, column } of uidForeignKeys) {
        const constraint = `${table}_${column}_fkey`;
        try {
          const { rows } = await client.query(
            `SELECT 1 FROM pg_constraint
              WHERE conrelid = to_regclass($1) AND conname = $2`,
            [table, constraint]
          );
          if (rows.length === 0) {
            await client.query(
              `ALTER TABLE ${table} ADD CONSTRAINT ${constraint}
                 FOREIGN KEY (${column}) REFERENCES players(uid) ON DELETE CASCADE`
            );
          }
        } catch (err) {
          log.error(
            `[PostgreSQL] Failed to add ${table}.${column} foreign key: ${(err as Error).message}`
          );
        }
      }

      // Hand-written migrations (backfills), each once per database: see
      // schemaMigrations.ts. After the column migrations and indexes above,
      // which they may rely on.
      await runSchemaMigrations(client);

      // Each module's own migrations (GameIntegration.migrations), after
      // core's schema and before anything uses it. This function also runs
      // after both wipe paths (resetDatabase), so a wiped database gets them
      // again. A module whose migrations fail is marked failed and the rest
      // carry on; see moduleMigrations.ts.
      const { listIntegrations } = await import('../integrations/registry');
      const installed = listIntegrations();
      const installedModuleIds = installed.map((integration) => integration.id);
      const failedModules = new Set<string>();

      // CS2's 2.x tables (servers, maps, map_pools) become cs2_servers,
      // cs2_maps and cs2_map_pools, and CS2's first migration is recorded, before
      // CS2's migrations run. Renamed in place, never copied; a no-op once done
      // and on a fresh database. See cs2TableHandover.ts. If it did not
      // happen, CS2's migrations must not run: they would create empty cs2_*
      // tables beside the host's data.
      const cs2 = installed.find((integration) => integration.id === CS2_MODULE_ID);
      const handover = await handOverCs2Tables(client, cs2);
      if (handover.pending.length > 0) {
        failedModules.add(CS2_MODULE_ID);
        if (cs2) {
          markModuleMigrationsFailed(
            CS2_MODULE_ID,
            `its 2.x tables (${handover.pending.join(', ')}) were not renamed to cs2_*` +
              (handover.error ? `: ${handover.error}` : '')
          );
        }
      }

      for (const integration of installed) {
        if (failedModules.has(integration.id)) continue;
        const state = await runModuleMigrations(integration, { client, installedModuleIds });
        if (state.status === 'failed') failedModules.add(integration.id);
      }

      // Core columns that reference CS2's tables: matches.server_id and the
      // templates' map_pool_id. The keys cannot be declared in core's CREATE
      // TABLE any more, because on a fresh database CS2's tables are created
      // after core's. An upgraded database kept its keys through the rename
      // (Postgres tracks the referenced table, not its name), so this only
      // adds them where they are missing: fresh databases and wipes. Skipped
      // while the referenced table does not exist (no CS2).
      // Moving these columns out of core is later work.
      const cs2ForeignKeys = [
        { table: 'matches', column: 'server_id', references: 'cs2_servers' },
        { table: 'tournament_templates', column: 'map_pool_id', references: 'cs2_map_pools' },
        { table: 'manual_match_templates', column: 'map_pool_id', references: 'cs2_map_pools' },
      ];
      for (const { table, column, references } of cs2ForeignKeys) {
        try {
          const { rows } = await client.query<{ has_target: boolean; has_key: boolean }>(
            `SELECT to_regclass($2) IS NOT NULL AS has_target,
                    EXISTS (
                      SELECT 1
                        FROM pg_constraint c
                        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
                       WHERE c.conrelid = to_regclass($1) AND c.contype = 'f'
                         AND c.confrelid = to_regclass($2) AND a.attname = $3
                    ) AS has_key`,
            [table, references, column]
          );
          if (!rows[0]?.has_target || rows[0].has_key) continue;
          await client.query(
            `ALTER TABLE ${table} ADD CONSTRAINT ${table}_${column}_fkey
               FOREIGN KEY (${column}) REFERENCES ${references}(id) ON DELETE SET NULL`
          );
        } catch (err) {
          log.error(
            `[PostgreSQL] Failed to add ${table}.${column} foreign key to ${references}: ${
              (err as Error).message
            }`
          );
        }
      }

      // Integration default data (CS2: the map catalogue when cs2_maps is
      // empty, then the default map pools). A rejection fails the schema
      // initialisation; the CS2 seed rethrows the same errors the inline map
      // insert did. Not for a module whose tables did not migrate.
      for (const integration of installed) {
        if (failedModules.has(integration.id)) continue;
        await integration.seed?.(client);
      }

      log.success('[PostgreSQL] Database schema initialized');
    } finally {
      client.release();
    }
  }

  /** Run `fn` with one pooled connection (for work that needs a transaction), then release it. */
  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.postgresPool) throw new Error('Database not initialized');
    const client = await this.postgresPool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /**
   * Reset database by dropping and recreating the public schema
   * This will effectively wipe the entire database schema (all tables, views, sequences, etc.)
   * and then recreate everything using the same initialization logic as on startup.
   *
   * DEV ONLY: This is intended for development tools where a full wipe is desired.
   */
  async resetDatabase(): Promise<void> {
    if (!this.postgresPool) {
      throw new Error('Database not initialized');
    }

    const client = await this.postgresPool.connect();
    try {
      log.warn('[PostgreSQL] Resetting database - dropping and recreating public schema');

      // Drop and recreate the public schema. This removes ALL user tables, views, sequences, etc.
      // This is more robust than maintaining a hard-coded list of tables.
      try {
        await client.query(`
          DROP SCHEMA IF EXISTS public CASCADE;
          CREATE SCHEMA public;
        `);
        log.database('[PostgreSQL] Public schema dropped and recreated');
      } catch (err) {
        const error = err as Error;
        log.error(`[PostgreSQL] Failed to recreate public schema during reset: ${error.message}`);
        throw err;
      }

      // Reset initialized flag so schema can be recreated
      this.initialized = false;

      // Reinitialize schema (this will create tables and insert default data)
      // Maps will be regenerated from GitHub since cs2_maps is now empty
      log.database('[PostgreSQL] Reinitializing schema and regenerating maps from GitHub...');
      await this.initializeSchemaAsync();
      this.initialized = true;

      log.success('[PostgreSQL] Database reset completed successfully');
    } finally {
      client.release();
    }
  }

  // Redaction lives in utils/dbLogRedaction so it can be unit-tested: secrets
  // and Discord IDs (private contact data, some of it children's) must not
  // reach the verbose DB logs.
  private safeJson(value: unknown): string {
    return safeLogJson(value);
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
    if (!LOG_DB_VERBOSE) {
      return;
    }
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
    if (LOG_DB_VERBOSE) {
      const loggedParams = redactParamsForLog(where ?? '', params) ?? [];
      log.database(
        `[DB] GETALL ${table} where=${where ?? 'none'} params=${this.safeJson(loggedParams)}`
      );
    }
    const result = await this.postgresPool.query(query, params);
    const rows = result.rows as T[];
    if (LOG_DB_VERBOSE) {
      log.database(`[DB] GETALL ${table} OK rows=${rows.length}`);
    }
    if (LOG_DB_VALUES && rows.length > 0) {
      const sample = rows.slice(0, MAX_DB_VALUES_SAMPLE);
      log.database(`[DB] GETALL ${table} result sample=${this.safeJson(sample)}`);
    }
    return rows;
  }

  async getOneAsync<T>(table: string, where: string, params: unknown[]): Promise<T | undefined> {
    if (!this.postgresPool) throw new Error('Database not initialized');
    const converted = convertPlaceholders(where, params);
    const query = `SELECT * FROM ${table} WHERE ${converted.sql} LIMIT 1`;
    if (LOG_DB_VERBOSE) {
      log.database(
        `[DB] GETONE ${table} where=${where} params=${this.safeJson(redactParamsForLog(where, params))}`
      );
    }
    const result = await this.postgresPool.query(query, converted.params);
    const row = (result.rows[0] as T) || undefined;
    if (LOG_DB_VERBOSE) {
      log.database(`[DB] GETONE ${table} OK ${row ? 'found' : 'not found'}`);
    }
    if (LOG_DB_VALUES && row) {
      log.database(`[DB] GETONE ${table} result=${this.safeJson(row)}`);
    }
    return row;
  }

  async insertAsync(
    table: string,
    data: Record<string, unknown>
  ): Promise<{ changes: number; lastInsertRowid: number | string }> {
    if (!this.postgresPool) throw new Error('Database not initialized');
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

    // Try to return id, but handle tables without id column gracefully
    let query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
    let lastInsertRowid: number | string = 0;

    // Tables that don't have an 'id' column (composite primary keys)
    const tablesWithoutId = ['shuffle_tournament_players'];

    if (!tablesWithoutId.includes(table)) {
      query += ' RETURNING id';
    }

    try {
      if (LOG_DB_VERBOSE) {
        log.database(
          `[DB] INSERT ${table} columns=[${columns.join(', ')}] values=${this.safeJson(
            redactInsertValuesForLog(columns, values)
          )}`
        );
      }
      const result = await this.postgresPool.query(query, values);
      if (result.rows.length > 0 && result.rows[0]?.id !== undefined) {
        lastInsertRowid = result.rows[0].id;
      }
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
      if (LOG_DB_VERBOSE) {
        log.database(`[DB] UPDATE ${table} set=${this.safeJson(data)} where="${where}"`);
      }
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
      if (LOG_DB_VERBOSE) {
        log.database(`[DB] DELETE ${table} where="${where}"`);
      }
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
      if (LOG_DB_VERBOSE) {
        log.database(
          `[DB] RUN sql=${JSON.stringify(sql)} params=${this.safeJson(redactParamsForLog(sql, params))}`
        );
      }
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
      if (LOG_DB_VERBOSE) {
        log.database(`[DB] EXEC sql=${JSON.stringify(sql)}`);
      }
      await this.postgresPool.query(sql);
      this.logRunResult('EXEC', 'custom', 0);
    } catch (err) {
      log.error(`[DB] EXEC failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async queryAsync<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!this.postgresPool) throw new Error('Database not initialized');
    try {
      if (LOG_DB_VERBOSE) {
        log.database(
          `[DB] QUERY sql=${JSON.stringify(sql)} params=${this.safeJson(redactParamsForLog(sql, params))}`
        );
      }
      const converted = params ? convertPlaceholders(sql, params) : { sql, params: [] };
      const result = await this.postgresPool.query(converted.sql, converted.params);
      const rows = result.rows as T[];
      if (LOG_DB_VERBOSE) {
        log.database(`[DB] QUERY OK rows=${rows.length}`);
      }
      if (LOG_DB_VALUES && rows.length > 0) {
        const sample = rows.slice(0, MAX_DB_VALUES_SAMPLE);
        log.database(`[DB] QUERY result sample=${this.safeJson(sample)}`);
      }
      return rows;
    } catch (err) {
      log.error(`[DB] QUERY failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async queryOneAsync<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    if (!this.postgresPool) throw new Error('Database not initialized');
    try {
      if (LOG_DB_VERBOSE) {
        log.database(
          `[DB] QUERY ONE sql=${JSON.stringify(sql)} params=${this.safeJson(
            redactParamsForLog(sql, params)
          )}`
        );
      }
      const converted = params ? convertPlaceholders(sql, params) : { sql, params: [] };
      const result = await this.postgresPool.query(converted.sql, converted.params);
      const row = result.rows[0] as T | undefined;
      if (LOG_DB_VERBOSE) {
        log.database(`[DB] QUERY ONE OK ${row ? 'found' : 'not found'}`);
      }
      if (LOG_DB_VALUES && row) {
        log.database(`[DB] QUERY ONE result=${this.safeJson(row)}`);
      }
      return row ?? undefined;
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
      if (LOG_DB_VERBOSE) {
        log.database(`[DB] SETTINGS get key=${key} ${row ? 'found' : 'missing'}`);
      }
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
      if (LOG_DB_VERBOSE) {
        log.database(`[DB] SETTINGS getAll count=${result.rows.length}`);
      }
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
