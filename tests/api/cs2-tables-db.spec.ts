import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { getSchemaSQL, parseSchemaColumns } from '../../api/src/config/database.schema';
import { LEGACY_CS2_TABLES } from '../../api/src/config/cs2TableHandover';
import { validateModuleMigrations } from '../../api/src/config/moduleMigrations';
import { CS2_MIGRATIONS } from '../../api/src/integrations/cs2/migrations';

/**
 * CS2 owns its tables (DESIGN-modules §6 item 10): `cs2_servers`, `cs2_maps`
 * and `cs2_map_pools`, created by CS2's own migration on a fresh database and
 * renamed from the 2.x `servers`, `maps` and `map_pools` on an upgraded one
 * (api/src/config/cs2TableHandover.ts).
 *
 * - after boot the three tables exist under the new names and the old names
 *   do not, and CS2's first migration is recorded;
 * - a map pool created through the API lands in `cs2_map_pools`;
 * - the keys from core's tables onto them (`matches.server_id`, the
 *   templates' `map_pool_id`) are enforced;
 * - running the handover again is a no-op;
 * - on a 2.4-shaped copy in a scratch schema, the handover renames without
 *   losing a row, keeps the keys, finishes half-done states, refuses a
 *   conflict, and ends in the same schema a fresh boot has;
 * - both wipe paths leave the same schema.
 *
 * The real 2.4.15 -> current upgrade is scripts/test-upgrade.ts, which reads
 * the same test routes.
 *
 * @tag api
 */

interface Cs2Schema {
  tables: Record<string, unknown>;
  foreignKeys: Array<{ table: string; name: string; definition: string }>;
}

interface Cs2TablesView {
  tables: Record<string, boolean>;
  legacyTables: Record<string, boolean>;
  counts: Record<string, number>;
  mapPoolNames: string[];
  ledger: Array<{ id: string; checksum: string }>;
  firstMigration: { id: string; checksum: string } | null;
  declared: Array<{ id: string; checksum: string }>;
  state: { status: 'ok' | 'failed'; applied: string[]; reason?: string } | null;
  schema: Cs2Schema;
}

interface HandoverReport {
  renamed: Array<{ from: string; to: string }>;
  renamedObjects: Array<{ kind: string; from: string; to: string }>;
  columnsAdded: string[];
  recorded: boolean;
  conflicts: string[];
  pending: string[];
  error?: string;
}

interface ProbeResult {
  first: HandoverReport;
  second: HandoverReport;
  tables: Record<string, boolean>;
  ledger: Array<{ id: string; checksum: string }>;
  schema: Cs2Schema;
  data: {
    servers: Array<{ id: string; name: string; host: string; port: number; password: string }> | null;
    maps: Array<{ id: string }> | null;
    legacyMaps: Array<{ id: string }> | null;
    mapPools: Array<{ id: number; name: string; map_ids: string }> | null;
    match: Array<{ slug: string; server_id: string | null }>;
    template: Array<{ name: string; pool: string | null }>;
  };
  nextPoolId: number | null;
  templateMissingPool: { code: string | null; constraint: string | null };
}

const NEW_NAMES = { cs2_servers: true, cs2_maps: true, cs2_map_pools: true };
const OLD_GONE = { servers: false, maps: false, map_pools: false };

const NO_OP: HandoverReport = {
  renamed: [],
  renamedObjects: [],
  columnsAdded: [],
  recorded: false,
  conflicts: [],
  pending: [],
};

async function view(request: APIRequestContext): Promise<Cs2TablesView> {
  const res = await request.get('/api/test/cs2-tables');
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as Cs2TablesView;
}

async function handoverProbe(request: APIRequestContext, scenario: string): Promise<ProbeResult> {
  const res = await request.post('/api/test/cs2-tables/handover-probe', { data: { scenario } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as ProbeResult;
}

test.describe('CS2 tables: definitions', () => {
  test("CS2's migrations stay in CS2's namespace", () => {
    expect(validateModuleMigrations('cs2', CS2_MIGRATIONS, { installedModuleIds: ['cs2'] })).toBeNull();
  });

  test("core's schema no longer creates or references the 2.x names", () => {
    const sql = getSchemaSQL();
    for (const { from } of LEGACY_CS2_TABLES) {
      expect(sql).not.toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${from}\\b`));
      expect(sql).not.toMatch(new RegExp(`REFERENCES ${from}\\(`));
      expect(sql).not.toMatch(new RegExp(`\\bON ${from}\\(`));
    }
  });

  test("the handover's index names are the ones CS2's first migration creates", () => {
    const created = [...CS2_MIGRATIONS[0].up.matchAll(/CREATE INDEX IF NOT EXISTS (\w+) ON (\w+)/g)].map(
      (m) => `${m[2]}.${m[1]}`
    );
    const renamed = LEGACY_CS2_TABLES.flatMap((t) => Object.values(t.indexes).map((name) => `${t.to}.${name}`));
    expect(renamed.sort()).toEqual(created.sort());
  });

  test("CS2's first migration declares every column the 2.x tables had", () => {
    const columns = parseSchemaColumns(CS2_MIGRATIONS[0].up).map((c) => `${c.table}.${c.column}`);
    for (const expected of [
      'cs2_servers.name',
      'cs2_servers.status',
      'cs2_servers.server_can_reach_api_at',
      'cs2_maps.display_name',
      'cs2_maps.image_url',
      'cs2_map_pools.map_ids',
      'cs2_map_pools.is_default',
    ]) {
      expect(columns).toContain(expected);
    }
  });
});

test.describe.serial('CS2 tables on the database', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('after boot the tables have their CS2 names and the old names are gone', async ({ request }) => {
    const v = await view(request);
    expect(v.tables).toEqual(NEW_NAMES);
    expect(v.legacyTables).toEqual(OLD_GONE);
    expect(v.state?.status).toBe('ok');
    expect(v.firstMigration?.id).toBe('001-tables');
    expect(v.ledger).toEqual(v.declared);
    expect(v.declared.map((m) => m.id)).toEqual(CS2_MIGRATIONS.map((m) => m.id));
    // The CS2 seed ran on them.
    expect(v.counts.cs2_maps).toBeGreaterThan(0);
    expect(v.mapPoolNames).toContain('Active Duty');

    expect(v.schema.foreignKeys).toEqual([
      {
        table: 'manual_match_templates',
        name: 'manual_match_templates_map_pool_id_fkey',
        definition: 'FOREIGN KEY (map_pool_id) REFERENCES cs2_map_pools(id) ON DELETE SET NULL',
      },
      {
        table: 'matches',
        name: 'matches_server_id_fkey',
        definition: 'FOREIGN KEY (server_id) REFERENCES cs2_servers(id) ON DELETE SET NULL',
      },
      {
        table: 'tournament_templates',
        name: 'tournament_templates_map_pool_id_fkey',
        definition: 'FOREIGN KEY (map_pool_id) REFERENCES cs2_map_pools(id) ON DELETE SET NULL',
      },
    ]);
  });

  test('a map pool created through the API lands in cs2_map_pools', async ({ request }) => {
    const name = `CS2 tables pool ${Date.now()}`;
    const created = await request.post('/api/map-pools', {
      data: { name, mapIds: ['de_dust2', 'de_mirage'] },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { mapPool } = (await created.json()) as { mapPool: { id: number; name: string; mapIds: string[] } };
    expect(mapPool).toMatchObject({ name, mapIds: ['de_dust2', 'de_mirage'] });

    expect((await view(request)).mapPoolNames).toContain(name);

    const deleted = await request.delete(`/api/map-pools/${mapPool.id}`);
    expect(deleted.ok(), await deleted.text()).toBe(true);
    expect((await view(request)).mapPoolNames).not.toContain(name);
  });

  test("core's keys onto CS2's tables are enforced", async ({ request }) => {
    const res = await request.post('/api/test/cs2-tables/foreign-keys');
    expect(res.ok(), await res.text()).toBe(true);
    const body = await res.json();
    expect(body.templateMissingPool).toEqual({
      code: '23503',
      constraint: 'tournament_templates_map_pool_id_fkey',
    });
    expect(body.manualTemplateMissingPool).toEqual({
      code: '23503',
      constraint: 'manual_match_templates_map_pool_id_fkey',
    });
    expect(body.matchMissingServer).toEqual({ code: '23503', constraint: 'matches_server_id_fkey' });
    // ON DELETE SET NULL survived too.
    expect(body.templatePoolAfterPoolDeleted).toBeNull();
  });

  test('running the handover again is a no-op', async ({ request }) => {
    const before = await view(request);
    const res = await request.post('/api/test/cs2-tables/handover');
    expect(res.ok(), await res.text()).toBe(true);
    expect((await res.json()).report).toEqual(NO_OP);
    const after = await view(request);
    expect(after.schema).toEqual(before.schema);
    expect(after.ledger).toEqual(before.ledger);
  });

  test('a 2.4.15 database is renamed in place and ends like a fresh one', async ({ request }) => {
    const fresh = await view(request);
    const probe = await handoverProbe(request, 'legacy');

    expect(probe.first.error).toBeUndefined();
    expect(probe.first.renamed).toEqual([
      { from: 'servers', to: 'cs2_servers' },
      { from: 'maps', to: 'cs2_maps' },
      { from: 'map_pools', to: 'cs2_map_pools' },
    ]);
    expect(probe.first.renamedObjects).toEqual(
      expect.arrayContaining([
        { kind: 'constraint', from: 'servers_pkey', to: 'cs2_servers_pkey' },
        { kind: 'constraint', from: 'maps_pkey', to: 'cs2_maps_pkey' },
        { kind: 'constraint', from: 'map_pools_pkey', to: 'cs2_map_pools_pkey' },
        { kind: 'constraint', from: 'map_pools_name_key', to: 'cs2_map_pools_name_key' },
        { kind: 'index', from: 'idx_servers_status', to: 'cs2_servers_status_idx' },
        { kind: 'index', from: 'idx_servers_last_seen', to: 'cs2_servers_last_seen_idx' },
        { kind: 'index', from: 'idx_servers_enabled', to: 'cs2_servers_enabled_idx' },
        { kind: 'index', from: 'idx_maps_id', to: 'cs2_maps_id_idx' },
        { kind: 'index', from: 'idx_map_pools_name', to: 'cs2_map_pools_name_idx' },
        { kind: 'index', from: 'idx_map_pools_default', to: 'cs2_map_pools_default_idx' },
        { kind: 'index', from: 'idx_map_pools_enabled', to: 'cs2_map_pools_enabled_idx' },
        { kind: 'sequence', from: 'map_pools_id_seq', to: 'cs2_map_pools_id_seq' },
      ])
    );
    expect(probe.first.columnsAdded).toEqual([]);
    expect(probe.first.recorded).toBe(true);
    expect(probe.first.conflicts).toEqual([]);
    expect(probe.first.pending).toEqual([]);

    // A second run changes nothing.
    expect(probe.second).toEqual(NO_OP);

    expect(probe.tables).toEqual({ ...NEW_NAMES, ...OLD_GONE });
    expect(probe.ledger).toEqual([fresh.firstMigration]);

    // Every row, with its id, is where it was.
    expect(probe.data.servers).toEqual([
      { id: 'probe-1', name: 'Probe One', host: '10.0.0.1', port: 27015, password: 'secret-1' },
      { id: 'probe-2', name: 'Probe Two', host: '10.0.0.2', port: 27016, password: 'secret-2' },
    ]);
    expect(probe.data.maps).toEqual([{ id: 'de_dust2' }, { id: 'de_mirage' }]);
    expect(probe.data.mapPools).toEqual([
      { id: 1, name: 'Probe Pool A', map_ids: '["de_dust2"]' },
      { id: 2, name: 'Probe Pool B', map_ids: '["de_dust2","de_mirage"]' },
    ]);
    // The keys onto them followed the rename.
    expect(probe.data.match).toEqual([{ slug: 'probe-match', server_id: 'probe-2' }]);
    expect(probe.data.template).toEqual([{ name: 'Probe Template', pool: 'Probe Pool B' }]);
    expect(probe.schema.foreignKeys).toEqual([
      {
        table: 'matches',
        name: 'matches_server_id_fkey',
        definition: 'FOREIGN KEY (server_id) REFERENCES cs2_servers(id) ON DELETE SET NULL',
      },
      {
        table: 'tournament_templates',
        name: 'tournament_templates_map_pool_id_fkey',
        definition: 'FOREIGN KEY (map_pool_id) REFERENCES cs2_map_pools(id) ON DELETE SET NULL',
      },
    ]);
    expect(probe.templateMissingPool).toEqual({
      code: '23503',
      constraint: 'tournament_templates_map_pool_id_fkey',
    });
    // The renamed sequence carries on after the old ids.
    expect(probe.nextPoolId).toBe(3);

    // Same tables, columns, indexes, constraints and sequences as a fresh boot.
    expect(probe.schema.tables).toEqual(fresh.schema.tables);
  });

  test('an older install missing a column and an index is brought up to date', async ({ request }) => {
    const fresh = await view(request);
    const probe = await handoverProbe(request, 'old-install');
    expect(probe.first.error).toBeUndefined();
    expect(probe.first.columnsAdded).toEqual(['cs2_servers.server_can_reach_api_at']);
    expect(probe.first.recorded).toBe(true);
    expect(probe.second).toEqual(NO_OP);
    expect(probe.schema.tables).toEqual(fresh.schema.tables);
  });

  test('a half-done handover is finished from where it stands', async ({ request }) => {
    const fresh = await view(request);
    // servers was renamed by hand; its index and constraint names, the other
    // two tables and the ledger row were not.
    const probe = await handoverProbe(request, 'renamed-by-hand');
    expect(probe.first.error).toBeUndefined();
    expect(probe.first.renamed).toEqual([
      { from: 'maps', to: 'cs2_maps' },
      { from: 'map_pools', to: 'cs2_map_pools' },
    ]);
    expect(probe.first.renamedObjects).toEqual(
      expect.arrayContaining([
        { kind: 'constraint', from: 'servers_pkey', to: 'cs2_servers_pkey' },
        { kind: 'index', from: 'idx_servers_status', to: 'cs2_servers_status_idx' },
      ])
    );
    expect(probe.first.recorded).toBe(true);
    expect(probe.second).toEqual(NO_OP);
    expect(probe.tables).toEqual({ ...NEW_NAMES, ...OLD_GONE });
    expect(probe.data.match).toEqual([{ slug: 'probe-match', server_id: 'probe-2' }]);
    expect(probe.schema.tables).toEqual(fresh.schema.tables);
  });

  test('both names present is refused, and nothing is dropped', async ({ request }) => {
    const probe = await handoverProbe(request, 'both');
    expect(probe.first.error).toBeUndefined();
    expect(probe.first.conflicts).toEqual(['maps']);
    expect(probe.first.pending).toEqual([]);
    expect(probe.first.renamed).toEqual([
      { from: 'servers', to: 'cs2_servers' },
      { from: 'map_pools', to: 'cs2_map_pools' },
    ]);
    expect(probe.second.conflicts).toEqual(['maps']);
    expect(probe.second.renamed).toEqual([]);
    // The old table and its rows are still there, beside the new one.
    expect(probe.tables).toEqual({ ...NEW_NAMES, servers: false, maps: true, map_pools: false });
    expect(probe.data.legacyMaps).toEqual([{ id: 'de_dust2' }, { id: 'de_mirage' }]);
    expect(probe.data.maps).toEqual([]);
  });

  for (const wipe of ['/api/test/reset-database', '/api/tournament/wipe-database']) {
    test(`a wipe leaves the same schema (${wipe})`, async ({ request }) => {
      const before = await view(request);

      const res = await request.post(wipe, { headers: getAuthHeader(), timeout: 60_000 });
      expect(res.ok(), await res.text()).toBe(true);
      expect(await signInViaRequest(request)).toBe(true);

      const after = await view(request);
      expect(after.tables).toEqual(NEW_NAMES);
      expect(after.legacyTables).toEqual(OLD_GONE);
      expect(after.ledger).toEqual(before.ledger);
      expect(after.state).toEqual({ moduleId: 'cs2', status: 'ok', applied: CS2_MIGRATIONS.map((m) => m.id) });
      expect(after.schema).toEqual(before.schema);
      expect(after.mapPoolNames).toContain('Active Duty');
    });
  }
});
