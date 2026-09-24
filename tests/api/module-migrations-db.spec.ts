import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';

/**
 * Module-owned migrations against the real database (DESIGN-modules §6 item 5).
 *
 * A fixture module (`migration-fixture`, defined in api/src/routes/test.ts so
 * no SQL travels in a request) is run through `runModuleMigrations` by
 * `POST /api/test/module-migrations/run`:
 *
 * - migrations apply in order and are recorded in `module_migrations`;
 * - a second run applies nothing;
 * - an applied migration whose SQL was edited is refused, and nothing runs;
 * - a failing migration rolls back only itself; earlier ones stay applied and
 *   later ones never run;
 * - a migration that touches a core table is refused before any of it runs.
 *
 * The test-only fake module declares one real migration
 * (`fake_migration_probe`), so the boot and both wipe paths are proved on it:
 * each wipe re-creates the schema and its migration runs again.
 *
 * The pure parts (the namespace check, planning, checksums) are
 * module-migrations.spec.ts.
 *
 * @tag api
 */

interface ModuleMigrationsView {
  applied: Array<{ id: string; checksum: string }>;
  tables: string[];
  coreColumns: string[];
  state: { status: 'ok' | 'failed'; applied: string[]; reason?: string } | null;
}

interface RunResult {
  moduleId: string;
  status: 'ok' | 'failed';
  applied: string[];
  reason?: string;
}

async function view(request: APIRequestContext, moduleId?: string): Promise<ModuleMigrationsView> {
  const res = await request.get(
    `/api/test/module-migrations${moduleId ? `?moduleId=${moduleId}` : ''}`
  );
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as ModuleMigrationsView;
}

async function run(request: APIRequestContext, fixture: string): Promise<RunResult> {
  const res = await request.post('/api/test/module-migrations/run', { data: { fixture } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).result as RunResult;
}

async function reset(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/test/module-migrations/reset');
  expect(res.ok(), await res.text()).toBe(true);
}

const ids = (v: ModuleMigrationsView) => v.applied.map((a) => a.id);

test.describe.serial('module migrations on the database', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('apply in order, are recorded, and a second run applies nothing', async ({ request }) => {
    await reset(request);

    const first = await run(request, 'v1');
    expect(first).toEqual({
      moduleId: 'migration-fixture',
      status: 'ok',
      applied: ['001-items', '002-items-label'],
    });
    const after = await view(request);
    expect(ids(after)).toEqual(['001-items', '002-items-label']);
    expect(after.applied.every((a) => /^[0-9a-f]{64}$/.test(a.checksum))).toBe(true);
    expect(after.tables).toEqual(['migration_fixture_items']);

    // 001 has no IF NOT EXISTS: running it again would fail. It is not run.
    const second = await run(request, 'v1');
    expect(second).toEqual({ moduleId: 'migration-fixture', status: 'ok', applied: [] });
    expect((await view(request)).applied).toEqual(after.applied);

    // A new version appends; only the new one runs.
    const third = await run(request, 'v2');
    expect(third).toEqual({ moduleId: 'migration-fixture', status: 'ok', applied: ['003-items-note'] });
  });

  test('an edited, already-applied migration is refused and nothing runs', async ({ request }) => {
    await reset(request);
    await run(request, 'v1');

    const edited = await run(request, 'edited');
    expect(edited.status).toBe('failed');
    expect(edited.applied).toEqual([]);
    expect(edited.reason).toContain("migration '001-items' was already applied with different SQL");

    const after = await view(request);
    // 003 was pending in that version, and still did not run.
    expect(ids(after)).toEqual(['001-items', '002-items-label']);
    expect(after.state?.status).toBe('failed');
    expect(after.state?.reason).toBe(edited.reason);
  });

  test('a failing migration rolls back only itself', async ({ request }) => {
    await reset(request);
    await run(request, 'v1');

    const result = await run(request, 'failing');
    expect(result.status).toBe('failed');
    expect(result.applied).toEqual(['003-items-note']);
    expect(result.reason).toMatch(/^migration '004-broken' failed and was rolled back: .*missing_column/);

    const after = await view(request);
    expect(ids(after)).toEqual(['001-items', '002-items-label', '003-items-note']);
    // 004 created migration_fixture_partial before it failed: rolled back.
    // 005 came after the failure: never ran.
    expect(after.tables).toEqual(['migration_fixture_items']);

    // Fixed or not, the next run tries 004 again and fails the same way; the
    // earlier ones are not touched.
    const again = await run(request, 'failing');
    expect(again.applied).toEqual([]);
    expect(again.reason).toContain("'004-broken'");
  });

  test('a migration touching a core table is refused before any of it runs', async ({ request }) => {
    await reset(request);

    const result = await run(request, 'core');
    expect(result.status).toBe('failed');
    expect(result.applied).toEqual([]);
    expect(result.reason).toContain("migration '001-touch-core' is refused");
    expect(result.reason).toContain("'matches' is a core table");

    const after = await view(request);
    expect(after.applied).toEqual([]);
    // Its first statement is the module's own table, and it did not run either.
    expect(after.tables).toEqual([]);
    expect(after.coreColumns).toEqual([]);
  });

  for (const wipe of ['/api/test/reset-database', '/api/tournament/wipe-database']) {
    test(`a wipe re-runs the modules' migrations (${wipe})`, async ({ request }) => {
      // Booted with the fake module: its migration ran at start-up.
      const booted = await view(request, 'fake');
      expect(ids(booted)).toEqual(['0001-migration-probe']);
      expect(booted.tables).toEqual(['fake_migration_probe']);

      await run(request, 'v1');
      expect(ids(await view(request))).toEqual(['001-items', '002-items-label']);

      const res = await request.post(wipe, { headers: getAuthHeader(), timeout: 60_000 });
      expect(res.ok(), await res.text()).toBe(true);
      expect(await signInViaRequest(request)).toBe(true);

      // The ledger went with the schema, and the installed module's migration
      // ran again on the fresh one.
      const fake = await view(request, 'fake');
      expect(ids(fake)).toEqual(['0001-migration-probe']);
      expect(fake.tables).toEqual(['fake_migration_probe']);
      expect(fake.state).toEqual({ moduleId: 'fake', status: 'ok', applied: ['0001-migration-probe'] });

      // The fixture is not an installed module: gone, and not re-run.
      const fixture = await view(request);
      expect(fixture.applied).toEqual([]);
      expect(fixture.tables).toEqual([]);
    });
  }
});
