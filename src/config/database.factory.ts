import type { DatabaseAdapter } from './database.interface';
import { PostgresAdapter } from './database.adapters';
import { log } from '../utils/logger';

/**
 * Create PostgreSQL database adapter
 */
export async function createDatabaseAdapter(): Promise<DatabaseAdapter> {
  log.database('[Factory] Creating PostgreSQL adapter');
  const adapter = new PostgresAdapter(process.env.DATABASE_URL);
  await adapter.connect();
  return adapter;
}

