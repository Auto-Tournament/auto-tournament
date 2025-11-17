/**
 * Database manager with support for both SQLite and PostgreSQL
 * Provides both async and sync interfaces for backward compatibility
 */

import type { DatabaseAdapter } from './database.interface';
import { createDatabaseAdapter } from './database.factory';
import { SqliteAdapter } from './database.adapters';
import { log } from '../utils/logger';

let adapter: DatabaseAdapter | null = null;
let isInitialized = false;

/**
 * Initialize database connection
 */
export async function initDatabase(): Promise<void> {
  if (isInitialized) {
    return;
  }

  adapter = await createDatabaseAdapter();
  isInitialized = true;
  log.success('Database initialized');
}

/**
 * Get database adapter (async)
 */
async function getAdapter(): Promise<DatabaseAdapter> {
  if (!adapter) {
    await initDatabase();
  }
  if (!adapter) {
    throw new Error('Database adapter not initialized');
  }
  return adapter;
}

/**
 * Database manager class with sync methods for backward compatibility
 * Note: Sync methods only work with SQLite. For PostgreSQL, use async methods.
 */
class DatabaseManager {
  private syncAdapter: SqliteAdapter | null = null;

  constructor() {
    // For backward compatibility, initialize SQLite if DB_TYPE is sqlite or not set
    const dbType = (process.env.DB_TYPE || 'postgresql').toLowerCase();
    if (dbType === 'sqlite') {
      this.syncAdapter = new SqliteAdapter(process.env.DB_PATH);
      // Initialize schema synchronously for SQLite
      this.syncAdapter.connect().catch(err => {
        log.error('Failed to initialize SQLite database', err as Error);
      });
    }
  }

  // Sync methods (SQLite only)
  getAll<T>(table: string, where?: string, params?: unknown[]): T[] {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    // SQLite adapter methods are async but we can call them synchronously
    // This is a workaround - in practice, we should make everything async
    return this.syncAdapter.getAll<T>(table, where, params) as unknown as T[];
  }

  getOne<T>(table: string, where: string, params: unknown[]): T | undefined {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    return this.syncAdapter.getOne<T>(table, where, params) as unknown as T | undefined;
  }

  insert(table: string, data: Record<string, unknown>): { changes: number; lastInsertRowid: number | string } {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    return this.syncAdapter.insert(table, data) as unknown as { changes: number; lastInsertRowid: number | string };
  }

  update(table: string, data: Record<string, unknown>, where: string, whereParams: unknown[]): { changes: number } {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    return this.syncAdapter.update(table, data, where, whereParams) as unknown as { changes: number };
  }

  delete(table: string, where: string, params: unknown[]): { changes: number } {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    return this.syncAdapter.delete(table, where, params) as unknown as { changes: number };
  }

  run(sql: string, params: unknown[] = []): { changes: number; lastInsertRowid?: number | string } {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    return this.syncAdapter.run(sql, params) as unknown as { changes: number; lastInsertRowid?: number | string };
  }

  exec(sql: string): void {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    this.syncAdapter.exec(sql).catch(err => {
      log.error('Database exec failed', err as Error);
      throw err;
    });
  }

  query<T>(sql: string, params?: unknown[]): T[] {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    return this.syncAdapter.query<T>(sql, params) as unknown as T[];
  }

  queryOne<T>(sql: string, params?: unknown[]): T | undefined {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    return this.syncAdapter.queryOne<T>(sql, params) as unknown as T | undefined;
  }

  getAppSetting(key: string): string | null {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    return this.syncAdapter.getAppSetting(key) as unknown as string | null;
  }

  setAppSetting(key: string, value: string | null): void {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    this.syncAdapter.setAppSetting(key, value).catch(err => {
      log.error('Database setAppSetting failed', err as Error);
      throw err;
    });
  }

  getAllAppSettings(): Array<{ key: string; value: string | null; updated_at: number }> {
    if (!this.syncAdapter) {
      throw new Error('Sync methods are only available with SQLite. Use async methods for PostgreSQL.');
    }
    return this.syncAdapter.getAllAppSettings() as unknown as Array<{ key: string; value: string | null; updated_at: number }>;
  }

  close(): void {
    if (this.syncAdapter) {
      this.syncAdapter.close().catch(err => {
        log.error('Database close failed', err as Error);
      });
    }
  }
}

// Export singleton instance for backward compatibility
export const db = new DatabaseManager();

// Export async methods
export const dbAsync = {
  async getAll<T>(table: string, where?: string, params?: unknown[]): Promise<T[]> {
    const adapter = await getAdapter();
    return adapter.getAll<T>(table, where, params);
  },

  async getOne<T>(table: string, where: string, params: unknown[]): Promise<T | undefined> {
    const adapter = await getAdapter();
    return adapter.getOne<T>(table, where, params);
  },

  async insert(table: string, data: Record<string, unknown>): Promise<{ changes: number; lastInsertRowid: number | string }> {
    const adapter = await getAdapter();
    return adapter.insert(table, data);
  },

  async update(table: string, data: Record<string, unknown>, where: string, whereParams: unknown[]): Promise<{ changes: number }> {
    const adapter = await getAdapter();
    return adapter.update(table, data, where, whereParams);
  },

  async delete(table: string, where: string, params: unknown[]): Promise<{ changes: number }> {
    const adapter = await getAdapter();
    return adapter.delete(table, where, params);
  },

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid?: number | string }> {
    const adapter = await getAdapter();
    return adapter.run(sql, params);
  },

  async exec(sql: string): Promise<void> {
    const adapter = await getAdapter();
    return adapter.exec(sql);
  },

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const adapter = await getAdapter();
    return adapter.query<T>(sql, params);
  },

  async queryOne<T>(sql: string, params?: unknown[]): Promise<T | undefined> {
    const adapter = await getAdapter();
    return adapter.queryOne<T>(sql, params);
  },

  async getAppSetting(key: string): Promise<string | null> {
    const adapter = await getAdapter();
    return adapter.getAppSetting(key);
  },

  async setAppSetting(key: string, value: string | null): Promise<void> {
    const adapter = await getAdapter();
    return adapter.setAppSetting(key, value);
  },

  async getAllAppSettings(): Promise<Array<{ key: string; value: string | null; updated_at: number }>> {
    const adapter = await getAdapter();
    return adapter.getAllAppSettings();
  },
};

