/**
 * Database adapter interface
 * Abstracts database operations to support multiple database backends
 */
export interface DatabaseAdapter {
  /**
   * Initialize database connection
   */
  connect(): Promise<void>;

  /**
   * Close database connection
   */
  close(): Promise<void>;

  /**
   * Initialize database schema
   */
  initializeSchema(): Promise<void>;

  /**
   * Get all records from a table
   */
  getAll<T>(table: string, where?: string, params?: unknown[]): Promise<T[]>;

  /**
   * Get a single record by condition
   */
  getOne<T>(table: string, where: string, params: unknown[]): Promise<T | undefined>;

  /**
   * Insert a record
   */
  insert(table: string, data: Record<string, unknown>): Promise<{ changes: number; lastInsertRowid: number | string }>;

  /**
   * Update a record
   */
  update(
    table: string,
    data: Record<string, unknown>,
    where: string,
    whereParams: unknown[]
  ): Promise<{ changes: number }>;

  /**
   * Delete a record
   */
  delete(table: string, where: string, params: unknown[]): Promise<{ changes: number }>;

  /**
   * Execute arbitrary write operation (INSERT/UPDATE/DELETE with custom SQL)
   */
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid?: number | string }>;

  /**
   * Execute raw SQL (DDL statements)
   */
  exec(sql: string): Promise<void>;

  /**
   * Execute custom query
   */
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Execute custom query (single result)
   */
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | undefined>;

  /**
   * Get application setting by key
   */
  getAppSetting(key: string): Promise<string | null>;

  /**
   * Set or delete an application setting
   */
  setAppSetting(key: string, value: string | null): Promise<void>;

  /**
   * Get all application settings
   */
  getAllAppSettings(): Promise<Array<{ key: string; value: string | null; updated_at: number }>>;
}

