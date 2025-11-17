import type { DatabaseAdapter } from './database.interface';
import { SqliteAdapter } from './database.adapters';
import { PostgresAdapter } from './database.adapters';
import { log } from '../utils/logger';

/**
 * Create database adapter based on environment configuration
 */
export async function createDatabaseAdapter(): Promise<DatabaseAdapter> {
  const dbType = (process.env.DB_TYPE || 'postgresql').toLowerCase();
  
  let adapter: DatabaseAdapter;

  if (dbType === 'sqlite') {
    log.database('[Factory] Creating SQLite adapter');
    adapter = new SqliteAdapter(process.env.DB_PATH);
  } else if (dbType === 'postgresql' || dbType === 'postgres') {
    log.database('[Factory] Creating PostgreSQL adapter');
    adapter = new PostgresAdapter(process.env.DATABASE_URL);
  } else {
    throw new Error(`Unsupported database type: ${dbType}. Supported types: sqlite, postgresql`);
  }

  await adapter.connect();
  return adapter;
}

