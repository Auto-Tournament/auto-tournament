/**
 * Migrations a game module brings with it (`GameIntegration.migrations`), so a
 * module owns its tables instead of core's schema file creating them.
 *
 * `runModuleMigrations(integration)` applies a module's migrations that this
 * database has not seen, in the order the module declares them, and records
 * each in `module_migrations` with a checksum of its SQL:
 *
 * - Each migration runs in its own transaction together with its ledger row.
 *   A failure rolls back that migration only; the ones before it stay applied
 *   and the ones after it are not attempted.
 * - An applied migration whose SQL has since changed (a different checksum)
 *   is refused: somebody edited a migration that had shipped. Nothing runs.
 * - Every problem marks the module as failed with a reason naming the
 *   migration (`getModuleMigrationState`). It never throws: one broken module
 *   must not stop the platform from booting.
 * - Running it again applies nothing.
 *
 * Namespacing. A module may only create or change objects named
 * `<moduleId>_…`, hyphens turned into underscores (`manual-report` →
 * `manual_report_matches`), and never a core table, whatever its name. This is
 * checked statically, before anything runs: every statement of every
 * migration must be one of a small set of shapes (CREATE/ALTER/DROP of a
 * table, index or sequence; INSERT/UPDATE/DELETE on a table; COMMENT ON one),
 * and each object it names must be the module's. Anything else — DO blocks,
 * functions, triggers, views, schemas, GRANT, TRUNCATE, transaction control —
 * is refused, so an unexpected statement fails closed.
 *
 * Why a static check and not a Postgres schema per module plus `search_path`:
 * `search_path` is only a default, so `public.matches` still resolves inside
 * it; real isolation would need a role per module, which needs CREATEROLE the
 * platform's database user often does not have, and the app runs every query
 * through one pool. A second schema would also escape `resetDatabase` (it
 * drops `public` only), the column auto-migrator (`current_schema()`), and
 * every query that names a table unqualified. The check guards against
 * mistakes and collisions between modules, not against a hostile module: code
 * modules are installed on disk by the operator and run in-process with the
 * same pool, so they could query anything from JavaScript anyway.
 */

import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { log } from '../utils/logger';
import { getSchemaSQL } from './database.schema';
import type { ModuleMigration } from '../integrations/types';

type Queryable = Pick<PoolClient, 'query'>;

/** What `runModuleMigrations` needs of a module: its id and its migrations. */
export interface MigratingModule {
  id: string;
  migrations?: ReadonlyArray<ModuleMigration>;
}

export interface ModuleMigrationState {
  moduleId: string;
  status: 'ok' | 'failed';
  /** Migration ids applied by the last run, in order. */
  applied: string[];
  /** Why the module failed: which migration, and what went wrong. */
  reason?: string;
}

export interface RunModuleMigrationsOptions {
  /** Run on this connection (the schema initialisation's) instead of one from the pool. */
  client?: Queryable;
  /**
   * The ids of every installed module, so a module cannot create names in a
   * more specific module's namespace (`a` writing `a_b_x`, which is `a-b`'s).
   * Defaults to the registry's.
   */
  installedModuleIds?: readonly string[];
}

// ---------------------------------------------------------------------------
// Pure parts: names, checksums, planning, the DDL check
// ---------------------------------------------------------------------------

const MODULE_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MIGRATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The prefix every object a module owns starts with: `manual-report` → `manual_report_`. */
export function moduleNamespace(moduleId: string): string {
  return `${moduleId.replace(/-/g, '_')}_`;
}

/**
 * sha256 of a migration's SQL. Line endings are normalised so a checkout with
 * CRLF does not look like an edited migration; nothing else is.
 */
export function migrationChecksum(up: string): string {
  return createHash('sha256').update(up.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

let coreNamesCache: ReadonlySet<string> | null = null;

/**
 * Every table and index core's schema creates. A module may never touch one,
 * even when its name happens to start with the module's prefix.
 */
export function coreObjectNames(): ReadonlySet<string> {
  if (coreNamesCache) return coreNamesCache;
  const sql = getSchemaSQL();
  const names = new Set<string>([
    // Created in database.ts rather than the schema string.
    'tournament_templates',
    'idx_tournament_templates_name',
    'idx_tournament_templates_type',
  ]);
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)) {
    names.add(m[1].toLowerCase());
  }
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)) {
    names.add(m[1].toLowerCase());
  }
  coreNamesCache = names;
  return names;
}

/** Why a module id cannot own migrations, or null. */
export function checkModuleId(
  moduleId: string,
  coreNames: ReadonlySet<string> = coreObjectNames()
): string | null {
  if (!MODULE_ID_RE.test(moduleId)) {
    return `module id '${moduleId}' is not lower-case letters, digits and single hyphens`;
  }
  const prefix = moduleNamespace(moduleId);
  for (const name of coreNames) {
    // `match` would own `match_reports`; `matches-x` would share `matches_…`
    // with the names Postgres gives core's constraints and sequences.
    if (name.startsWith(prefix) || prefix.startsWith(`${name}_`)) {
      return `module id '${moduleId}' gives the namespace '${prefix}', which overlaps core's '${name}'`;
    }
  }
  return null;
}

/** Split SQL into statements with comments removed and literals masked as `''`. */
export function splitSqlStatements(sql: string): { statements: string[]; error?: string } {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const n = sql.length;
  const isIdentChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c);

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      current += ' ';
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (depth > 0) return { statements, error: 'unterminated /* comment' };
      current += ' ';
      continue;
    }
    if (c === "'") {
      // E'...' strings take backslash escapes.
      const escapes = /[Ee]$/.test(current) && !isIdentChar(current[current.length - 2]);
      i++;
      let closed = false;
      while (i < n) {
        if (escapes && sql[i] === '\\') {
          i += 2;
        } else if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
          } else {
            i++;
            closed = true;
            break;
          }
        } else {
          i++;
        }
      }
      if (!closed) return { statements, error: 'unterminated string literal' };
      current += "''";
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
          } else {
            j++;
            closed = true;
            break;
          }
        } else {
          j++;
        }
      }
      if (!closed) return { statements, error: 'unterminated quoted identifier' };
      current += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === '$' && !isIdentChar(current[current.length - 1])) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        if (end < 0) return { statements, error: `unterminated ${tag[0]} string` };
        i = end + tag[0].length;
        current += "''";
        continue;
      }
    }
    if (c === ';') {
      const statement = current.replace(/\s+/g, ' ').trim();
      if (statement) statements.push(statement);
      current = '';
      i++;
      continue;
    }
    current += c;
    i++;
  }
  const last = current.replace(/\s+/g, ' ').trim();
  if (last) statements.push(last);
  return { statements };
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`;

/** `a."B".c` → ['a', 'B', 'c']: unquoted parts fold to lower case, as Postgres does. */
function nameParts(raw: string): string[] {
  const parts: string[] = [];
  const re = new RegExp(IDENT, 'g');
  for (const m of raw.matchAll(re)) {
    const part = m[0];
    parts.push(part.startsWith('"') ? part.slice(1, -1).replace(/""/g, '"') : part.toLowerCase());
  }
  return parts;
}

interface NamespaceRules {
  prefix: string;
  coreNames: ReadonlySet<string>;
  /** Namespaces of more specific modules (`a_b_` when this is `a_`). */
  foreignPrefixes: ReadonlyArray<{ moduleId: string; prefix: string }>;
}

/** Why the module may not touch the object `raw` names, or null. */
function checkOwned(raw: string, rules: NamespaceRules): string | null {
  const parts = nameParts(raw);
  if (parts.length !== 1) {
    return `'${raw}' is schema-qualified; a module's objects are named without a schema`;
  }
  const name = parts[0];
  if (rules.coreNames.has(name)) return `'${name}' is a core table`;
  if (!name.startsWith(rules.prefix) || name.length === rules.prefix.length) {
    return `'${name}' is outside the module's namespace (names must start with '${rules.prefix}')`;
  }
  const foreign = rules.foreignPrefixes.find((f) => name.startsWith(f.prefix));
  if (foreign) return `'${name}' is in the namespace of module '${foreign.moduleId}'`;
  return null;
}

function match(statement: string, pattern: string): RegExpExecArray | null {
  return new RegExp(pattern, 'i').exec(statement);
}

/** Why one statement is not allowed in a module migration, or null. */
function checkStatement(statement: string, rules: NamespaceRules): string | null {
  const owned = (raw: string) => checkOwned(raw, rules);
  const renameTo = () => {
    const m = match(statement, String.raw`\bRENAME\s+TO\s+(${QNAME})`);
    return m ? owned(m[1]) : null;
  };
  const refuseIf = (pattern: string, why: string) =>
    new RegExp(pattern, 'i').test(statement) ? why : null;

  let m = match(statement, String.raw`^CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`);
  if (m) {
    return (
      owned(m[1]) ??
      refuseIf(String.raw`\bINHERITS\b|\bPARTITION\s+OF\b`, 'a module table may not inherit from or partition another table')
    );
  }

  m = match(
    statement,
    String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:(${QNAME})\s+)?ON\s+(?:ONLY\s+)?(${QNAME})`
  );
  if (m) {
    if (m[1]) return 'CREATE INDEX CONCURRENTLY cannot run inside the migration transaction';
    return (m[2] ? owned(m[2]) : null) ?? owned(m[3]);
  }

  const ownedBy = () => {
    const by = match(statement, String.raw`\bOWNED\s+BY\s+(${QNAME})`);
    if (!by || /^none$/i.test(by[1])) return null;
    const parts = nameParts(by[1]);
    return parts.length === 2 ? owned(`"${parts[0]}"`) : `OWNED BY '${by[1]}' must be <table>.<column>`;
  };

  m = match(statement, String.raw`^CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`);
  if (m) return owned(m[1]) ?? ownedBy();

  m = match(statement, String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QNAME})`);
  if (m) {
    return (
      owned(m[1]) ??
      refuseIf(String.raw`\bSET\s+SCHEMA\b`, 'SET SCHEMA moves the table out of the platform schema') ??
      refuseIf(String.raw`\bINHERIT\b|\b(?:ATTACH|DETACH)\s+PARTITION\b`, 'a module table may not inherit from or partition another table') ??
      renameTo()
    );
  }

  m = match(statement, String.raw`^ALTER\s+(INDEX|SEQUENCE)\s+(?:IF\s+EXISTS\s+)?(${QNAME})`);
  if (m) {
    return (
      owned(m[2]) ??
      refuseIf(String.raw`\bSET\s+SCHEMA\b`, 'SET SCHEMA moves the object out of the platform schema') ??
      refuseIf(String.raw`\bATTACH\s+PARTITION\b`, 'a module index may not attach to another index') ??
      renameTo() ??
      (m[1].toUpperCase() === 'SEQUENCE' ? ownedBy() : null)
    );
  }

  m = match(
    statement,
    String.raw`^DROP\s+(?:TABLE|INDEX|SEQUENCE)\s+(CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(${QNAME}(?:\s*,\s*${QNAME})*)(?:\s+(CASCADE|RESTRICT))?$`
  );
  if (m) {
    if (m[1]) return 'DROP INDEX CONCURRENTLY cannot run inside the migration transaction';
    if (m[3] && m[3].toUpperCase() === 'CASCADE') {
      return 'DROP … CASCADE may drop objects the module does not own';
    }
    for (const raw of m[2].split(/\s*,\s*/)) {
      const problem = owned(raw);
      if (problem) return problem;
    }
    return null;
  }

  m =
    match(statement, String.raw`^INSERT\s+INTO\s+(${QNAME})`) ??
    match(statement, String.raw`^UPDATE\s+(?:ONLY\s+)?(${QNAME})`) ??
    match(statement, String.raw`^DELETE\s+FROM\s+(?:ONLY\s+)?(${QNAME})`);
  if (m) return owned(m[1]);

  m = match(statement, String.raw`^COMMENT\s+ON\s+(?:TABLE|INDEX|SEQUENCE)\s+(${QNAME})\s+IS\b`);
  if (m) return owned(m[1]);
  m = match(statement, String.raw`^COMMENT\s+ON\s+COLUMN\s+(${QNAME})\s+IS\b`);
  if (m) {
    const parts = nameParts(m[1]);
    return parts.length === 2 ? owned(`"${parts[0]}"`) : `COMMENT ON COLUMN '${m[1]}' must be <table>.<column>`;
  }

  const head = statement.length > 60 ? `${statement.slice(0, 60)}…` : statement;
  return (
    `'${head}' is not allowed: a module migration may only CREATE, ALTER or DROP its own ` +
    'tables, indexes and sequences, INSERT/UPDATE/DELETE its own tables, and COMMENT ON them'
  );
}

/** Every problem with one migration's SQL, in statement order. Empty when it is allowed. */
export function checkMigrationSql(
  sql: string,
  moduleId: string,
  options: { coreNames?: ReadonlySet<string>; installedModuleIds?: readonly string[] } = {}
): string[] {
  const prefix = moduleNamespace(moduleId);
  const rules: NamespaceRules = {
    prefix,
    coreNames: options.coreNames ?? coreObjectNames(),
    foreignPrefixes: (options.installedModuleIds ?? [])
      .filter((id) => id !== moduleId)
      .map((id) => ({ moduleId: id, prefix: moduleNamespace(id) }))
      .filter((f) => f.prefix.startsWith(prefix)),
  };
  const { statements, error } = splitSqlStatements(sql);
  if (error) return [error];
  if (statements.length === 0) return ['the migration has no SQL'];
  const problems: string[] = [];
  for (const statement of statements) {
    const problem = checkStatement(statement, rules);
    if (problem) problems.push(problem);
  }
  return problems;
}

/**
 * Why a module's migrations cannot run at all (bad ids, a statement outside
 * its namespace), naming the migration; null when they may.
 */
export function validateModuleMigrations(
  moduleId: string,
  migrations: ReadonlyArray<ModuleMigration>,
  options: { coreNames?: ReadonlySet<string>; installedModuleIds?: readonly string[] } = {}
): string | null {
  const idProblem = checkModuleId(moduleId, options.coreNames ?? coreObjectNames());
  if (idProblem) return idProblem;
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (typeof migration?.id !== 'string' || !MIGRATION_ID_RE.test(migration.id)) {
      return `migration id '${String(migration?.id)}' is not 1–128 letters, digits, '.', '_' or '-'`;
    }
    if (seen.has(migration.id)) return `migration '${migration.id}' is declared twice`;
    seen.add(migration.id);
    if (typeof migration.up !== 'string') return `migration '${migration.id}' has no SQL`;
    const problems = checkMigrationSql(migration.up, moduleId, options);
    if (problems.length > 0) {
      return `migration '${migration.id}' is refused: ${problems.join('; ')}`;
    }
  }
  return null;
}

export interface AppliedMigrationRow {
  migration_id: string;
  checksum: string;
}

/**
 * Which declared migrations still have to run, given the ledger rows this
 * database has for the module; or why none may. Refuses an applied migration
 * whose SQL changed, and a new migration declared before one already applied
 * (migrations are append only). A ledger row the module no longer declares is
 * only a warning: the module was downgraded, and its tables are still there.
 */
export function planModuleMigrations(
  declared: ReadonlyArray<ModuleMigration>,
  applied: ReadonlyArray<AppliedMigrationRow>
): { pending: ModuleMigration[]; warnings: string[] } | { error: string } {
  const appliedById = new Map(applied.map((row) => [row.migration_id, row.checksum]));
  const warnings: string[] = [];
  const declaredIds = new Set(declared.map((m) => m.id));
  for (const row of applied) {
    if (!declaredIds.has(row.migration_id)) {
      warnings.push(`migration '${row.migration_id}' was applied but is no longer declared`);
    }
  }

  let lastApplied = -1;
  declared.forEach((migration, index) => {
    if (appliedById.has(migration.id)) lastApplied = index;
  });

  const pending: ModuleMigration[] = [];
  for (let index = 0; index < declared.length; index++) {
    const migration = declared[index];
    const checksum = appliedById.get(migration.id);
    if (checksum === undefined) {
      if (index < lastApplied) {
        return {
          error:
            `migration '${migration.id}' is declared before '${declared[lastApplied].id}', ` +
            'which is already applied: new migrations must be appended at the end',
        };
      }
      pending.push(migration);
    } else if (checksum !== migrationChecksum(migration.up)) {
      return {
        error:
          `migration '${migration.id}' was already applied with different SQL ` +
          `(checksum ${checksum.slice(0, 12)}…, now ${migrationChecksum(migration.up).slice(0, 12)}…): ` +
          'a shipped migration was edited. Ship the change as a new migration instead',
      };
    }
  }
  return { pending, warnings };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

const states = new Map<string, ModuleMigrationState>();

/** The result of the module's last migration run, or undefined when none ran. */
export function getModuleMigrationState(moduleId: string): ModuleMigrationState | undefined {
  const state = states.get(moduleId);
  return state ? { ...state, applied: [...state.applied] } : undefined;
}

/** Every module's last migration run. */
export function listModuleMigrationStates(): ModuleMigrationState[] {
  return [...states.keys()].map((id) => getModuleMigrationState(id)!);
}

/** A fixed first key for the advisory lock; the second is the module id's hash. */
const MODULE_MIGRATION_LOCK_KEY = 731_946_002;

function settle(state: ModuleMigrationState): ModuleMigrationState {
  states.set(state.moduleId, state);
  if (state.status === 'failed') {
    log.error(`[Modules] ${state.moduleId}: migrations failed, module marked failed: ${state.reason}`);
  }
  return { ...state, applied: [...state.applied] };
}

async function installedIdsFromRegistry(): Promise<string[]> {
  const { listIntegrations } = await import('../integrations/registry');
  return listIntegrations().map((integration) => integration.id);
}

async function runOn(
  client: Queryable,
  moduleId: string,
  migrations: ReadonlyArray<ModuleMigration>
): Promise<ModuleMigrationState> {
  const applied: string[] = [];
  const failed = (reason: string): ModuleMigrationState => ({
    moduleId,
    status: 'failed',
    applied,
    reason,
  });

  let rows: AppliedMigrationRow[];
  try {
    ({ rows } = await client.query<AppliedMigrationRow>(
      'SELECT migration_id, checksum FROM module_migrations WHERE module_id = $1',
      [moduleId]
    ));
  } catch (err) {
    return failed(`could not read module_migrations: ${(err as Error).message}`);
  }

  const plan = planModuleMigrations(migrations, rows);
  if ('error' in plan) return failed(plan.error);
  for (const warning of plan.warnings) log.warn(`[Modules] ${moduleId}: ${warning}`);

  for (const migration of plan.pending) {
    const checksum = migrationChecksum(migration.up);
    try {
      await client.query('BEGIN');
      // Two API processes starting together: the second waits, then sees the row.
      await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        MODULE_MIGRATION_LOCK_KEY,
        moduleId,
      ]);
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM module_migrations WHERE module_id = $1 AND migration_id = $2',
        [moduleId, migration.id]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        if (existing.rows[0].checksum !== checksum) {
          return failed(
            `migration '${migration.id}' was applied meanwhile with different SQL: a shipped migration was edited`
          );
        }
        continue;
      }
      await client.query(migration.up);
      await client.query(
        'INSERT INTO module_migrations (module_id, migration_id, checksum) VALUES ($1, $2, $3)',
        [moduleId, migration.id, checksum]
      );
      await client.query('COMMIT');
      applied.push(migration.id);
      log.success(`[Modules] ${moduleId}: applied migration ${migration.id}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      return failed(`migration '${migration.id}' failed and was rolled back: ${(err as Error).message}`);
    }
  }
  return { moduleId, status: 'ok', applied };
}

/**
 * Mark a module failed without running its migrations: something core does
 * before them did not complete (for CS2, handing over its 2.x tables;
 * config/cs2TableHandover.ts). Kept for `getModuleMigrationState`, like any
 * other failure.
 */
export function markModuleMigrationsFailed(moduleId: string, reason: string): ModuleMigrationState {
  return settle({ moduleId, status: 'failed', applied: [], reason });
}

/**
 * Apply `module`'s pending migrations; see the top of this file. Never throws:
 * the outcome is returned and kept for `getModuleMigrationState`. Exported for
 * the loader of modules installed on disk as well as the schema initialisation.
 */
export async function runModuleMigrations(
  module: MigratingModule,
  options: RunModuleMigrationsOptions = {}
): Promise<ModuleMigrationState> {
  const moduleId = module.id;
  try {
    const migrations = module.migrations ?? [];
    if (migrations.length === 0) {
      return settle({ moduleId, status: 'ok', applied: [] });
    }

    const installedModuleIds = options.installedModuleIds ?? (await installedIdsFromRegistry());
    const invalid = validateModuleMigrations(moduleId, migrations, { installedModuleIds });
    if (invalid) return settle({ moduleId, status: 'failed', applied: [], reason: invalid });

    if (options.client) {
      return settle(await runOn(options.client, moduleId, migrations));
    }
    const { db } = await import('./database');
    return settle(await db.withClient((client) => runOn(client, moduleId, migrations)));
  } catch (err) {
    return settle({
      moduleId,
      status: 'failed',
      applied: [],
      reason: `migrations could not run: ${(err as Error).message}`,
    });
  }
}
