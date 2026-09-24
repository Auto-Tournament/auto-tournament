/**
 * Renames a 2.x database to its 3.0 name, before the platform connects.
 *
 * 2.x called the database `matchzy_tournament`; 3.0 calls it
 * `auto_tournament`. Postgres' `POSTGRES_DB` only applies when the data
 * volume is first created, so on an upgraded install nothing renames it: the
 * volume holds `matchzy_tournament`, and the platform asks for
 * `auto_tournament`. This step closes that gap, once, from a connection to the
 * maintenance database (`postgres`, or `template1` when a role cannot connect
 * to `postgres`), because a database cannot be renamed from a session that is
 * connected to it.
 *
 * It only acts when the platform is configured for `auto_tournament`, the old
 * database exists and the new one does not. Every other state is left alone:
 *
 * - Neither exists: a fresh install, or a custom `DB_NAME`. Nothing to do.
 * - Only the new one exists: already renamed. Nothing to do.
 * - Both exist: logged as an error and left untouched. The platform uses
 *   `auto_tournament`; nothing is dropped or merged.
 * - Another session is connected to the old database (typically the 2.x
 *   container, still running): refused, and the platform does not start.
 *   Connections are never terminated.
 * - The role may not rename it (it must own the database and have CREATEDB,
 *   or be a superuser): refused, with the exact statement to run by hand.
 * - `DB_NAME` / `DATABASE_URL` still names `matchzy_tournament`: refused, with
 *   what to change. 3.0 does not use the old name.
 *
 * An advisory lock makes two API processes starting together rename it once.
 */

import { Client, type ClientConfig } from 'pg';
import { log } from '../utils/logger';

/** The platform's database name from 3.0 on. */
export const DATABASE_NAME = 'auto_tournament';
/** Its 2.x name, which this step renames. */
export const LEGACY_DATABASE_NAME = 'matchzy_tournament';

const MAINTENANCE_DATABASES = ['postgres', 'template1'] as const;

/** Connection errors that mean Postgres is not reachable at all. */
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH']);

/** A fixed key for the advisory lock, so two API processes never rename twice. */
const RENAME_LOCK_KEY = 731_946_011;

export type DatabaseRenameOutcome =
  /** `ALTER DATABASE … RENAME` ran. */
  | 'renamed'
  /** Only `auto_tournament` exists. */
  | 'already-renamed'
  /** Neither name exists (fresh install; Postgres creates the database itself). */
  | 'nothing-to-rename'
  /** Both names exist; `auto_tournament` is used, the old one is left alone. */
  | 'both-exist'
  /** The platform is configured for another database name. */
  | 'not-applicable'
  /** No maintenance database could be reached, so it could not check. */
  | 'unchecked';

/** Why the platform must not start. Carries the message the operator needs. */
export class DatabaseRenameRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseRenameRefused';
  }
}

/** The database a connection string names, or null when it cannot be parsed. */
export function databaseNameOf(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return name || null;
  } catch {
    return null;
  }
}

/** The same connection string, pointed at another database. */
export function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

const RENAME_SQL = `ALTER DATABASE ${LEGACY_DATABASE_NAME} RENAME TO ${DATABASE_NAME};`;

function byHand(): string {
  return (
    'Run this once as a superuser (or the database owner with CREATEDB), ' +
    `connected to the "postgres" database, then start again:\n    ${RENAME_SQL}\n` +
    'With the Docker Compose setup:\n' +
    '    docker compose exec postgres psql -U postgres -d postgres ' +
    `-c "${RENAME_SQL}"`
  );
}

async function connectMaintenance(
  connectionString: string,
  clientOptions: Omit<ClientConfig, 'connectionString'>
): Promise<{ client: Client; database: string } | { errors: string[] }> {
  const errors: string[] = [];
  for (const database of MAINTENANCE_DATABASES) {
    const client = new Client({
      ...clientOptions,
      connectionString: withDatabase(connectionString, database),
      application_name: 'auto-tournament-db-rename',
    });
    try {
      await client.connect();
      return { client, database };
    } catch (err) {
      await client.end().catch(() => undefined);
      // Postgres itself is unreachable: the platform's own connection fails
      // next with the usual guidance, so do not blame the maintenance database.
      const code = (err as { code?: string }).code;
      if (code && UNREACHABLE.has(code)) throw err;
      errors.push(`${database}: ${(err as Error).message}`);
    }
  }
  return { errors };
}

interface OtherSession {
  application_name: string | null;
  client_addr: string | null;
  usename: string | null;
}

/**
 * Rename `matchzy_tournament` to `auto_tournament` when that is what an
 * upgraded install needs; see the top of this file. Throws
 * `DatabaseRenameRefused` when the platform must not start; never terminates
 * a connection, drops or merges anything.
 */
export async function renameLegacyDatabase(
  connectionString: string,
  clientOptions: Omit<ClientConfig, 'connectionString'> = {}
): Promise<DatabaseRenameOutcome> {
  const target = databaseNameOf(connectionString);

  if (target === LEGACY_DATABASE_NAME) {
    throw new DatabaseRenameRefused(
      `The platform is configured to use the database "${LEGACY_DATABASE_NAME}", its 2.x name. ` +
        `3.0 calls it "${DATABASE_NAME}". Set DB_NAME=${DATABASE_NAME} in your .env (and change ` +
        'DATABASE_URL too, if you set it), then start again: the platform renames the existing ' +
        'database in place, with its data. Nothing was changed.'
    );
  }
  if (target !== DATABASE_NAME) return 'not-applicable';

  const connected = await connectMaintenance(connectionString, clientOptions);
  if ('errors' in connected) {
    log.warn(
      `[PostgreSQL] Could not reach a maintenance database to check for the 2.x database ` +
        `"${LEGACY_DATABASE_NAME}" (${connected.errors.join('; ')}). If this install was ` +
        `upgraded from 2.x and "${DATABASE_NAME}" does not exist yet, rename it by hand. ${byHand()}`
    );
    return 'unchecked';
  }

  const { client, database: maintenance } = connected;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [RENAME_LOCK_KEY]);

    const { rows } = await client.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE datname = ANY($1::text[])',
      [[LEGACY_DATABASE_NAME, DATABASE_NAME]]
    );
    const hasOld = rows.some((r) => r.datname === LEGACY_DATABASE_NAME);
    const hasNew = rows.some((r) => r.datname === DATABASE_NAME);

    if (hasOld && hasNew) {
      log.error(
        `[PostgreSQL] Both "${LEGACY_DATABASE_NAME}" and "${DATABASE_NAME}" exist. The platform ` +
          `uses "${DATABASE_NAME}"; "${LEGACY_DATABASE_NAME}" was left untouched and nothing reads ` +
          'it. If your data is in the old one, stop the platform, move "' +
          DATABASE_NAME +
          `" out of the way, and start again so the old one is renamed. Otherwise drop ` +
          `"${LEGACY_DATABASE_NAME}" by hand once you no longer need it.`
      );
      return 'both-exist';
    }
    if (!hasOld) return hasNew ? 'already-renamed' : 'nothing-to-rename';

    // Anything connected to the old database (the 2.x container, a psql
    // session, a backup job) makes the rename fail, and must not lose its
    // connection to it. Refuse, and say who it is.
    const { rows: others } = await client.query<OtherSession>(
      `SELECT application_name, host(client_addr) AS client_addr, usename
         FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [LEGACY_DATABASE_NAME]
    );
    if (others.length > 0) {
      const who = others
        .map(
          (s) =>
            `${s.application_name || 'unnamed client'}` +
            `${s.usename ? ` as ${s.usename}` : ''}` +
            `${s.client_addr ? ` from ${s.client_addr}` : ''}`
        )
        .join(', ');
      throw new DatabaseRenameRefused(
        `Cannot rename the 2.x database "${LEGACY_DATABASE_NAME}" to "${DATABASE_NAME}": ` +
          `${others.length} other session(s) are connected to it (${who}). Usually that is the ` +
          '2.x app container, still running: stop it (docker compose down with the old compose ' +
          'file), or close whatever else is connected, then start again. No connection was ' +
          'closed and nothing was changed.'
      );
    }

    const { rows: rights } = await client.query<{
      rolsuper: boolean;
      rolcreatedb: boolean;
      owns: boolean;
    }>(
      `SELECT r.rolsuper, r.rolcreatedb, pg_has_role(current_user, d.datdba, 'MEMBER') AS owns
         FROM pg_roles r, pg_database d
        WHERE r.rolname = current_user AND d.datname = $1`,
      [LEGACY_DATABASE_NAME]
    );
    const right = rights[0];
    if (right && !right.rolsuper && !(right.owns && right.rolcreatedb)) {
      throw new DatabaseRenameRefused(
        `Cannot rename the 2.x database "${LEGACY_DATABASE_NAME}" to "${DATABASE_NAME}": the ` +
          `role the platform connects as may not (it needs to own the database and have ` +
          `CREATEDB, or be a superuser). Nothing was changed. ${byHand()}`
      );
    }

    try {
      await client.query(
        `ALTER DATABASE ${ident(LEGACY_DATABASE_NAME)} RENAME TO ${ident(DATABASE_NAME)}`
      );
    } catch (err) {
      const e = err as { code?: string; message: string };
      if (e.code === '55006') {
        throw new DatabaseRenameRefused(
          `Cannot rename the 2.x database "${LEGACY_DATABASE_NAME}" to "${DATABASE_NAME}": ` +
            'something connected to it just now. Stop whatever uses it (usually the 2.x app ' +
            'container) and start again. No connection was closed and nothing was changed.'
        );
      }
      if (e.code === '42501') {
        throw new DatabaseRenameRefused(
          `Cannot rename the 2.x database "${LEGACY_DATABASE_NAME}" to "${DATABASE_NAME}": ` +
            `${e.message}. Nothing was changed. ${byHand()}`
        );
      }
      throw err;
    }

    log.success(
      `[PostgreSQL] Renamed the 2.x database "${LEGACY_DATABASE_NAME}" to "${DATABASE_NAME}" ` +
        `(from "${maintenance}"; no rows moved)`
    );
    return 'renamed';
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [RENAME_LOCK_KEY]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}
