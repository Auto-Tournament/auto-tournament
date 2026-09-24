import { test, expect } from '@playwright/test';
import {
  checkMigrationSql,
  checkModuleId,
  coreObjectNames,
  migrationChecksum,
  moduleNamespace,
  planModuleMigrations,
  runModuleMigrations,
  splitSqlStatements,
  validateModuleMigrations,
} from '../../api/src/config/moduleMigrations';
import type { ModuleMigration } from '../../api/src/integrations/types';

/**
 * Module-owned migrations (DESIGN-modules §6 item 5), the parts that need no
 * database: the namespace check, checksums, planning, and the run loop's
 * transaction handling against a stub client. The real-database path is
 * module-migrations-db.spec.ts.
 *
 * Runs in-process (no `request`, no `page`).
 *
 * @tag api
 */

const A: ModuleMigration = { id: '001-a', up: 'CREATE TABLE demo_a (id INTEGER);' };
const B: ModuleMigration = { id: '002-b', up: 'CREATE TABLE demo_b (id INTEGER);' };
const C: ModuleMigration = { id: '003-c', up: 'ALTER TABLE demo_a ADD COLUMN c TEXT;' };

function row(migration: ModuleMigration, up = migration.up) {
  return { migration_id: migration.id, checksum: migrationChecksum(up) };
}

test.describe('module migrations: names', () => {
  test('the namespace is the id with hyphens as underscores', () => {
    expect(moduleNamespace('cs2')).toBe('cs2_');
    expect(moduleNamespace('manual-report')).toBe('manual_report_');
  });

  test('core tables are known', () => {
    const core = coreObjectNames();
    for (const name of ['matches', 'players', 'tournament', 'teams', 'module_migrations', 'tournament_templates']) {
      expect(core.has(name), name).toBe(true);
    }
  });

  test('the built-in module ids are allowed', () => {
    for (const id of ['cs2', 'manual-report', 'fake']) expect(checkModuleId(id)).toBeNull();
  });

  test('a module id whose namespace overlaps core is refused', () => {
    // `match_` would own core's match_reports; `player_` player_games.
    expect(checkModuleId('match')).toContain("overlaps core's 'match_");
    expect(checkModuleId('player')).toContain('player_');
    // `matches_x_` would share `matches_…` with core's own derived names.
    expect(checkModuleId('matches-x')).toContain("'matches'");
    expect(checkModuleId('Bad_Id')).toContain('not lower-case');
  });
});

test.describe('module migrations: the DDL check', () => {
  const ok = (sql: string, id = 'demo') => expect(checkMigrationSql(sql, id), sql).toEqual([]);
  const refused = (sql: string, reason: string | RegExp, id = 'demo') => {
    const problems = checkMigrationSql(sql, id).join(' | ');
    expect(problems, sql).not.toBe('');
    if (typeof reason === 'string') expect(problems, sql).toContain(reason);
    else expect(problems, sql).toMatch(reason);
  };

  test('accepts what a module does to its own objects', () => {
    ok(`CREATE TABLE IF NOT EXISTS demo_items (
          id SERIAL PRIMARY KEY,
          match_slug TEXT REFERENCES matches(slug) ON DELETE CASCADE, -- reading core is fine
          label TEXT NOT NULL DEFAULT 'x;y'
        );`);
    ok('CREATE UNIQUE INDEX IF NOT EXISTS demo_items_label ON demo_items (label)');
    ok('CREATE INDEX ON demo_items (match_slug)');
    ok('CREATE SEQUENCE demo_seq OWNED BY demo_items.id');
    ok('ALTER TABLE demo_items ADD COLUMN note TEXT');
    ok('ALTER TABLE IF EXISTS ONLY demo_items RENAME TO demo_things');
    ok('ALTER TABLE demo_items RENAME COLUMN label TO title');
    ok('ALTER INDEX demo_items_label RENAME TO demo_items_title');
    ok('DROP TABLE IF EXISTS demo_old, demo_older');
    ok('DROP INDEX demo_items_label');
    ok(`INSERT INTO demo_items (label) SELECT name FROM teams`);
    ok(`UPDATE demo_items SET label = t.name FROM teams t WHERE t.id = demo_items.label`);
    ok('DELETE FROM demo_items WHERE id > 1');
    ok(`COMMENT ON TABLE demo_items IS 'hello'; COMMENT ON COLUMN demo_items.label IS $$ok$$`);
    ok('CREATE TABLE "demo_Quoted" (id INTEGER)');
    ok('CREATE TABLE manual_report_x (id INTEGER)', 'manual-report');
  });

  test('refuses anything that touches a core table', () => {
    refused('ALTER TABLE matches ADD COLUMN demo_flag TEXT', "'matches' is a core table");
    refused('CREATE INDEX demo_idx ON players (name)', "'players' is a core table");
    refused('DROP TABLE tournament', "'tournament' is a core table");
    refused('INSERT INTO app_settings (key, value) VALUES (1, 2)', "'app_settings' is a core table");
    refused('UPDATE teams SET name = 1', "'teams' is a core table");
    refused('DELETE FROM matches', "'matches' is a core table");
    refused('ALTER TABLE demo_items RENAME TO matches', "'matches' is a core table");
    refused('ALTER TABLE "MATCHES" ADD x INT', 'outside the module');
    refused('ALTER TABLE public.matches ADD x INT', 'schema-qualified');
    refused('COMMENT ON COLUMN matches.slug IS $$x$$', "'matches' is a core table");
    // A core table the module's prefix happens to cover is still core's.
    refused('ALTER TABLE match_reports ADD x INT', "'match_reports' is a core table", 'match');
  });

  test('refuses names outside the namespace and statements it does not know', () => {
    refused('CREATE TABLE other_items (id INTEGER)', "must start with 'demo_'");
    refused('CREATE TABLE demo_ (id INTEGER)', 'outside');
    refused('CREATE INDEX other_idx ON demo_items (id)', "'other_idx' is outside");
    refused('CREATE TABLE demo_x (id INT) INHERITS (matches)', 'inherit');
    refused('DROP TABLE demo_items CASCADE', 'CASCADE');
    refused('CREATE INDEX CONCURRENTLY demo_i ON demo_items (id)', 'CONCURRENTLY');
    refused('ALTER TABLE demo_items SET SCHEMA other', 'SET SCHEMA');
    refused('TRUNCATE demo_items', 'is not allowed');
    refused('DO $$ BEGIN EXECUTE $q$DROP TABLE matches$q$; END $$', 'is not allowed');
    refused('CREATE FUNCTION demo_f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql', 'is not allowed');
    refused('CREATE TRIGGER demo_t AFTER INSERT ON matches EXECUTE FUNCTION demo_f()', 'is not allowed');
    refused('CREATE VIEW demo_v AS SELECT * FROM matches', 'is not allowed');
    refused('COMMIT', 'is not allowed');
    refused('GRANT ALL ON demo_items TO public', 'is not allowed');
    refused('WITH d AS (DELETE FROM matches RETURNING 1) SELECT 1', 'is not allowed');
    refused('   ', 'no SQL');
    refused("CREATE TABLE demo_x (label TEXT DEFAULT 'oops)", 'unterminated');
  });

  test('a statement hidden in a literal or comment is not a statement', () => {
    ok(`INSERT INTO demo_items (label) VALUES ('; DROP TABLE matches; --')`);
    ok(`INSERT INTO demo_items (label) VALUES (E'it\\'s; DROP TABLE matches')`);
    ok('/* ALTER TABLE matches ADD x INT; */ CREATE TABLE demo_c (id INT) -- ; DROP TABLE matches');
    expect(splitSqlStatements(`SELECT 'a;b'; SELECT $x$;$x$;`).statements).toEqual([
      "SELECT ''",
      "SELECT ''",
    ]);
  });

  test("a module cannot write into a more specific module's namespace", () => {
    expect(
      checkMigrationSql('CREATE TABLE demo_extra_t (id INT)', 'demo', {
        installedModuleIds: ['demo', 'demo-extra'],
      }).join()
    ).toContain("namespace of module 'demo-extra'");
    expect(
      checkMigrationSql('CREATE TABLE demo_extra_t (id INT)', 'demo-extra', {
        installedModuleIds: ['demo', 'demo-extra'],
      })
    ).toEqual([]);
  });

  test('validation names the migration and refuses bad or duplicate ids', () => {
    expect(validateModuleMigrations('demo', [A, B])).toBeNull();
    expect(
      validateModuleMigrations('demo', [A, { id: '002-core', up: 'ALTER TABLE matches ADD x INT' }])
    ).toMatch(/^migration '002-core' is refused: 'matches' is a core table/);
    expect(validateModuleMigrations('demo', [A, A])).toContain('declared twice');
    expect(validateModuleMigrations('demo', [{ id: '', up: 'x' }])).toContain('migration id');
  });
});

test.describe('module migrations: checksums and planning', () => {
  test('the checksum is stable, ignores CRLF, and sees any other edit', () => {
    expect(migrationChecksum(A.up)).toMatch(/^[0-9a-f]{64}$/);
    expect(migrationChecksum('a\r\nb')).toBe(migrationChecksum('a\nb'));
    expect(migrationChecksum(A.up)).not.toBe(migrationChecksum(`${A.up} `));
  });

  test('a fresh database runs everything, in declared order', () => {
    expect(planModuleMigrations([A, B, C], [])).toEqual({ pending: [A, B, C], warnings: [] });
  });

  test('applied migrations are skipped; an up-to-date module runs nothing', () => {
    expect(planModuleMigrations([A, B, C], [row(A)])).toEqual({ pending: [B, C], warnings: [] });
    expect(planModuleMigrations([A, B], [row(B), row(A)])).toEqual({ pending: [], warnings: [] });
  });

  test('an edited, already-applied migration is refused', () => {
    const plan = planModuleMigrations([A, B], [row(A, 'CREATE TABLE demo_a (id BIGINT);')]);
    expect('error' in plan && plan.error).toContain("migration '001-a' was already applied with different SQL");
  });

  test('a migration inserted before an applied one is refused', () => {
    const plan = planModuleMigrations([A, B, C], [row(A), row(C)]);
    expect('error' in plan && plan.error).toContain("'002-b' is declared before '003-c'");
  });

  test('an applied migration the module no longer declares is only a warning', () => {
    const plan = planModuleMigrations([A], [row(A), row(B)]);
    expect(plan).toEqual({ pending: [], warnings: ["migration '002-b' was applied but is no longer declared"] });
  });
});

/** A client that answers the ledger queries and fails any SQL containing FAIL. */
function stubClient(appliedRows: Array<{ migration_id: string; checksum: string }> = []) {
  const log: string[] = [];
  const ledger = [...appliedRows];
  const client = {
    async query(sql: string, params?: unknown[]) {
      log.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
      if (sql.startsWith('SELECT migration_id, checksum FROM module_migrations')) {
        return { rows: ledger, rowCount: ledger.length };
      }
      if (sql.startsWith('SELECT checksum FROM module_migrations')) {
        const found = ledger.filter((r) => r.migration_id === params?.[1]);
        return { rows: found, rowCount: found.length };
      }
      if (sql.startsWith('INSERT INTO module_migrations')) {
        ledger.push({ migration_id: String(params?.[1]), checksum: String(params?.[2]) });
      }
      if (sql.includes('FAIL')) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    },
  };
  return { client: client as never, log, ledger };
}

test.describe('module migrations: the run loop', () => {
  const installedModuleIds = ['demo'];

  test('each migration is its own transaction, recorded inside it', async () => {
    const { client, log, ledger } = stubClient();
    const state = await runModuleMigrations({ id: 'demo', migrations: [A, B] }, { client, installedModuleIds });
    expect(state).toEqual({ moduleId: 'demo', status: 'ok', applied: ['001-a', '002-b'] });
    expect(ledger.map((r) => r.migration_id)).toEqual(['001-a', '002-b']);
    expect(log.filter((l) => /^(BEGIN|COMMIT|ROLLBACK|CREATE|INSERT)/.test(l))).toEqual([
      'BEGIN', 'CREATE TABLE', 'INSERT INTO', 'COMMIT',
      'BEGIN', 'CREATE TABLE', 'INSERT INTO', 'COMMIT',
    ]);
  });

  test('a failure rolls back that migration only, stops, and never throws', async () => {
    const broken: ModuleMigration = { id: '002-broken', up: 'INSERT INTO demo_a (id) VALUES (1); -- FAIL' };
    const { client, log, ledger } = stubClient();
    const state = await runModuleMigrations(
      { id: 'demo', migrations: [A, broken, C] },
      { client, installedModuleIds }
    );
    expect(state.status).toBe('failed');
    expect(state.applied).toEqual(['001-a']);
    expect(state.reason).toBe("migration '002-broken' failed and was rolled back: boom");
    expect(ledger.map((r) => r.migration_id)).toEqual(['001-a']);
    expect(log.filter((l) => /^(COMMIT|ROLLBACK)/.test(l))).toEqual(['COMMIT', 'ROLLBACK']);
  });

  test('a refused module touches nothing', async () => {
    const { client, log } = stubClient();
    const state = await runModuleMigrations(
      { id: 'demo', migrations: [A, { id: '002-core', up: 'ALTER TABLE matches ADD x INT' }] },
      { client, installedModuleIds }
    );
    expect(state.status).toBe('failed');
    expect(state.reason).toContain("'matches' is a core table");
    expect(log).toEqual([]);
  });

  test('a module with no migrations is fine and touches nothing', async () => {
    const { client, log } = stubClient();
    expect(await runModuleMigrations({ id: 'demo' }, { client, installedModuleIds })).toEqual({
      moduleId: 'demo',
      status: 'ok',
      applied: [],
    });
    expect(log).toEqual([]);
  });

  test('a ledger it cannot read fails the module, not the caller', async () => {
    const client = { query: async () => Promise.reject(new Error('relation does not exist')) } as never;
    const state = await runModuleMigrations({ id: 'demo', migrations: [A] }, { client, installedModuleIds });
    expect(state.status).toBe('failed');
    expect(state.reason).toContain('relation does not exist');
  });
});
