/**
 * Hands CS2's three 2.x tables over to the CS2 module (DESIGN-modules §6 item
 * 10): `servers` → `cs2_servers`, `maps` → `cs2_maps`, `map_pools` →
 * `cs2_map_pools`.
 *
 * Up to 2.4 core's schema created these tables. From 3.0 CS2 creates them
 * with its own migrations (integrations/cs2/migrations.ts), under names in
 * its namespace. A fresh database gets them from CS2's `001-tables`. An
 * upgraded one already has them under the old names, with the host's servers,
 * maps and pools in them, so this renames them instead of copying:
 * `ALTER TABLE … RENAME` is a catalog change and moves no rows. Foreign keys,
 * defaults, the rows and their ids all stay attached to the same table, so
 * `matches.server_id` and `tournament_templates.map_pool_id` keep pointing at
 * the right rows.
 *
 * It runs on every start, in database.ts, before any module's migrations, and
 * works from the state it finds rather than from a ledger row:
 *
 * - Per table: the old name without the new one is renamed. The new name
 *   without the old one is already done. Both present is a conflict (see
 *   below). Neither is a fresh database: CS2's own migration creates them.
 * - The objects Postgres named after the table are renamed with it, so an
 *   upgraded database ends with the names a fresh one gets: constraints and
 *   the indexes behind them (`servers_pkey` → `cs2_servers_pkey`), sequences
 *   (`map_pools_id_seq` → `cs2_map_pools_id_seq`), and core's old indexes
 *   (`idx_servers_status` → `cs2_servers_status_idx`). Each rename happens
 *   only when the old name exists and the new one does not.
 * - Once the tables are there under the new names, CS2's first migration is
 *   recorded as applied, after bringing the tables to exactly what it
 *   declares: missing columns are added (from its SQL, the way core's column
 *   pass does it) and its SQL, which is `IF NOT EXISTS` throughout, is run to
 *   create anything else that is missing. An upgraded and a fresh database
 *   then end in the same schema, and the module's runner skips `001-tables`.
 *
 * Half-done states. All of it is one transaction, under an advisory lock, so
 * a crash or an error leaves the database exactly as it was, and two API
 * processes starting together do it once. A state it did not make itself
 * (tables renamed by hand, dependents not renamed, the ledger row missing) is
 * finished from where it stands, because every step checks before it acts.
 * Running it again changes nothing.
 *
 * Two states are refused rather than guessed at, and nothing is dropped in
 * either:
 * - Both names exist (typically: downgraded to 2.4 without restoring the
 *   backup, which recreated the old tables, then upgraded again). The old
 *   table is left alone and reported; CS2 keeps using `cs2_*`.
 * - The rename failed (the transaction rolled back). The old tables are
 *   reported as pending, and database.ts does not run CS2's migrations or
 *   seed: CS2's `CREATE TABLE IF NOT EXISTS` would otherwise create empty
 *   `cs2_*` tables next to the host's data, and the fleet would look lost.
 */

import type { PoolClient } from 'pg';
import { log } from '../utils/logger';
import { parseSchemaColumns } from './database.schema';
import { migrationChecksum, type MigratingModule } from './moduleMigrations';

type Queryable = Pick<PoolClient, 'query'>;

export const CS2_MODULE_ID = 'cs2';

export interface LegacyCs2Table {
  from: string;
  to: string;
  /** Core's hand-named 2.x indexes on the table, and their CS2 names. */
  indexes: Readonly<Record<string, string>>;
}

export const LEGACY_CS2_TABLES: readonly LegacyCs2Table[] = [
  {
    from: 'servers',
    to: 'cs2_servers',
    indexes: {
      idx_servers_status: 'cs2_servers_status_idx',
      idx_servers_last_seen: 'cs2_servers_last_seen_idx',
      idx_servers_enabled: 'cs2_servers_enabled_idx',
    },
  },
  {
    from: 'maps',
    to: 'cs2_maps',
    indexes: { idx_maps_id: 'cs2_maps_id_idx' },
  },
  {
    from: 'map_pools',
    to: 'cs2_map_pools',
    indexes: {
      idx_map_pools_name: 'cs2_map_pools_name_idx',
      idx_map_pools_default: 'cs2_map_pools_default_idx',
      idx_map_pools_enabled: 'cs2_map_pools_enabled_idx',
    },
  },
];

export interface Cs2HandoverReport {
  /** Tables renamed by this run. */
  renamed: Array<{ from: string; to: string }>;
  /** Constraints, indexes and sequences renamed by this run. */
  renamedObjects: Array<{ kind: 'constraint' | 'index' | 'sequence'; from: string; to: string }>;
  /** `table.column` added to bring a renamed table to CS2's first migration. */
  columnsAdded: string[];
  /** Whether this run recorded CS2's first migration as applied. */
  recorded: boolean;
  /** Old tables left alone because the new name exists too. */
  conflicts: string[];
  /**
   * Old tables still present with no new table: the handover did not happen.
   * CS2's migrations must not run while this is non-empty.
   */
  pending: string[];
  /** Why the transaction rolled back, when it did. */
  error?: string;
}

/** A fixed key for the advisory lock, so two API processes never hand over twice. */
const HANDOVER_LOCK_KEY = 731_946_010;

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** The kind of the relation `name` in the current schema, or null. */
async function relationKind(client: Queryable, name: string): Promise<string | null> {
  const { rows } = await client.query<{ relkind: string }>(
    `SELECT c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = $1`,
    [name]
  );
  return rows[0]?.relkind ?? null;
}

async function tableExists(client: Queryable, name: string): Promise<boolean> {
  const kind = await relationKind(client, name);
  return kind === 'r' || kind === 'p';
}

/**
 * Run one rename of a dependent object under a savepoint. These renames only
 * make an upgraded database's names match a fresh one's; one that Postgres
 * refuses is logged and skipped, and never costs the table rename.
 */
async function renameObject(
  client: Queryable,
  report: Cs2HandoverReport,
  kind: 'constraint' | 'index' | 'sequence',
  from: string,
  to: string,
  sql: string
): Promise<void> {
  await client.query('SAVEPOINT cs2_handover_rename');
  try {
    await client.query(sql);
    await client.query('RELEASE SAVEPOINT cs2_handover_rename');
    report.renamedObjects.push({ kind, from, to });
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT cs2_handover_rename');
    await client.query('RELEASE SAVEPOINT cs2_handover_rename');
    log.warn(
      `[PostgreSQL] CS2 handover: could not rename ${kind} ${from} to ${to}, kept its name: ${
        (err as Error).message
      }`
    );
  }
}

/** Rename what Postgres (and core's 2.x schema) named after `from` on the table now called `to`. */
async function renameDependents(
  client: Queryable,
  table: LegacyCs2Table,
  report: Cs2HandoverReport
): Promise<void> {
  const { from, to } = table;
  const newName = (old: string) => `${to}${old.slice(from.length)}`;

  // Constraints first: renaming a primary key or unique constraint renames
  // its index too. On Postgres 18 this includes the named NOT NULL ones.
  const { rows: constraints } = await client.query<{ conname: string }>(
    `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = $1
      ORDER BY con.conname`,
    [to]
  );
  const constraintNames = new Set(constraints.map((c) => c.conname));
  for (const { conname } of constraints) {
    if (!conname.startsWith(`${from}_`)) continue;
    const target = newName(conname);
    if (constraintNames.has(target) || (await relationKind(client, target))) {
      log.warn(`[PostgreSQL] CS2 handover: not renaming constraint ${conname}, ${target} exists`);
      continue;
    }
    await renameObject(
      client,
      report,
      'constraint',
      conname,
      target,
      `ALTER TABLE ${ident(to)} RENAME CONSTRAINT ${ident(conname)} TO ${ident(target)}`
    );
    constraintNames.add(target);
  }

  // Indexes that back no constraint: core's hand-named ones, and anything
  // else Postgres named after the table.
  const { rows: indexes } = await client.query<{ indexname: string }>(
    `SELECT i.relname AS indexname
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class c ON c.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relname = $1
        AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid)
      ORDER BY i.relname`,
    [to]
  );
  for (const { indexname } of indexes) {
    const target =
      table.indexes[indexname] ?? (indexname.startsWith(`${from}_`) ? newName(indexname) : null);
    if (!target) continue;
    if (await relationKind(client, target)) {
      log.warn(`[PostgreSQL] CS2 handover: not renaming index ${indexname}, ${target} exists`);
      continue;
    }
    await renameObject(
      client,
      report,
      'index',
      indexname,
      target,
      `ALTER INDEX ${ident(indexname)} RENAME TO ${ident(target)}`
    );
  }

  // Sequences owned by the table's columns (map_pools.id is SERIAL). Column
  // defaults refer to the sequence by OID, so they follow the rename.
  const { rows: sequences } = await client.query<{ seqname: string }>(
    `SELECT s.relname AS seqname
       FROM pg_depend d
       JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
       JOIN pg_class c ON c.oid = d.refobjid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
        AND d.deptype IN ('a', 'i')
        AND n.nspname = current_schema() AND c.relname = $1
      ORDER BY s.relname`,
    [to]
  );
  for (const { seqname } of sequences) {
    if (!seqname.startsWith(`${from}_`)) continue;
    const target = newName(seqname);
    if (await relationKind(client, target)) {
      log.warn(`[PostgreSQL] CS2 handover: not renaming sequence ${seqname}, ${target} exists`);
      continue;
    }
    await renameObject(
      client,
      report,
      'sequence',
      seqname,
      target,
      `ALTER SEQUENCE ${ident(seqname)} RENAME TO ${ident(target)}`
    );
  }
}

/**
 * Bring the renamed tables to what CS2's first migration declares and record
 * it as applied, when it is not recorded yet and at least one of its tables
 * exists. A fresh database has none of them here, and CS2's runner creates
 * them itself.
 */
async function adoptFirstMigration(
  client: Queryable,
  cs2: MigratingModule,
  report: Cs2HandoverReport
): Promise<void> {
  const first = cs2.migrations?.[0];
  if (!first) return;

  const present: string[] = [];
  for (const { to } of LEGACY_CS2_TABLES) {
    if (await tableExists(client, to)) present.push(to);
  }
  if (present.length === 0) return;

  const { rows: ledger } = await client.query(
    'SELECT 1 FROM module_migrations WHERE module_id = $1 AND migration_id = $2',
    [cs2.id, first.id]
  );
  if (ledger.length > 0) return;

  const { rows: existing } = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [present]
  );
  const have = new Set(existing.map((c) => `${c.table_name}.${c.column_name}`));
  for (const column of parseSchemaColumns(first.up)) {
    if (!present.includes(column.table)) continue;
    if (have.has(`${column.table}.${column.column}`)) continue;
    await client.query(
      `ALTER TABLE ${ident(column.table)} ADD COLUMN ${ident(column.column)} ${column.type}`
    );
    report.columnsAdded.push(`${column.table}.${column.column}`);
  }

  // IF NOT EXISTS throughout: creates only what is still missing (an index
  // an old install never had, a table it never had).
  await client.query(first.up);
  await client.query(
    `INSERT INTO module_migrations (module_id, migration_id, checksum) VALUES ($1, $2, $3)
     ON CONFLICT (module_id, migration_id) DO NOTHING`,
    [cs2.id, first.id, migrationChecksum(first.up)]
  );
  report.recorded = true;
}

async function pendingTables(client: Queryable): Promise<string[]> {
  const pending: string[] = [];
  for (const { from, to } of LEGACY_CS2_TABLES) {
    if ((await tableExists(client, from)) && !(await tableExists(client, to))) pending.push(from);
  }
  return pending;
}

/**
 * Rename CS2's 2.x tables and record its first migration; see the top of this
 * file. `cs2` is the registered CS2 module (its id and migrations); without it
 * the tables are still renamed and CS2's migration is recorded when it runs.
 * Never throws: a failure rolls everything back and is in the report.
 */
export async function handOverCs2Tables(
  client: Queryable,
  cs2?: MigratingModule
): Promise<Cs2HandoverReport> {
  const report: Cs2HandoverReport = {
    renamed: [],
    renamedObjects: [],
    columnsAdded: [],
    recorded: false,
    conflicts: [],
    pending: [],
  };

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [HANDOVER_LOCK_KEY]);

    for (const table of LEGACY_CS2_TABLES) {
      const hasOld = await tableExists(client, table.from);
      const hasNew = await tableExists(client, table.to);
      if (hasOld && hasNew) {
        report.conflicts.push(table.from);
        continue;
      }
      if (hasOld) {
        await client.query(`ALTER TABLE ${ident(table.from)} RENAME TO ${ident(table.to)}`);
        report.renamed.push({ from: table.from, to: table.to });
      }
      if (hasOld || hasNew) await renameDependents(client, table, report);
    }

    if (cs2) await adoptFirstMigration(client, cs2, report);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    report.error = (err as Error).message;
    report.renamed = [];
    report.renamedObjects = [];
    report.columnsAdded = [];
    report.recorded = false;
  }

  try {
    report.pending = await pendingTables(client);
  } catch (err) {
    // Cannot tell: treat every old table as pending, so CS2 does not migrate.
    report.pending = LEGACY_CS2_TABLES.map((t) => t.from);
    report.error ??= (err as Error).message;
  }

  if (report.renamed.length > 0) {
    log.success(
      `[PostgreSQL] CS2 now owns its tables: renamed ${report.renamed
        .map((r) => `${r.from} → ${r.to}`)
        .join(', ')} (no rows moved)`
    );
  }
  if (report.columnsAdded.length > 0) {
    log.success(`[PostgreSQL] CS2 handover added missing columns: ${report.columnsAdded.join(', ')}`);
  }
  if (report.recorded) {
    log.success(`[PostgreSQL] CS2 migration ${cs2?.migrations?.[0]?.id} recorded as applied`);
  }
  for (const from of report.conflicts) {
    const to = LEGACY_CS2_TABLES.find((t) => t.from === from)?.to;
    log.error(
      `[PostgreSQL] Both ${from} and ${to} exist. CS2 uses ${to}; ${from} was left untouched ` +
        '(usually a 2.4 start against an upgraded database). Nothing reads it: restore the ' +
        'pre-upgrade backup, or copy what you need into ' +
        `${to} and drop ${from} by hand.`
    );
  }
  if (report.error) {
    log.error(`[PostgreSQL] CS2 table handover failed and was rolled back: ${report.error}`);
  }
  if (report.pending.length > 0) {
    log.error(
      `[PostgreSQL] ${report.pending.join(', ')} not handed over to CS2 yet; CS2's migrations are ` +
        'skipped so they do not create empty tables beside your data. Fix the error above and restart.'
    );
  }
  return report;
}
