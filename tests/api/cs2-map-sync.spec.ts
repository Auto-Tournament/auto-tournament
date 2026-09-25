import http from 'http';
import type { AddressInfo } from 'net';
import { test, expect } from '@playwright/test';
import { signInViaRequest } from '../helpers/auth';
import {
  bundledMapCatalog,
  isPlayableMapId,
  loadMapCatalog,
  parseMapCatalog,
  MAP_THUMBNAILS_BASE,
  type MapCatalog,
} from '../../api/src/integrations/cs2/maps/mapCatalog';
import {
  ACTIVE_DUTY_POOL,
  LEGACY_ACTIVE_DUTY,
  planMapSync,
  type MapSyncState,
} from '../../api/src/integrations/cs2/maps/mapSync';
import { CS2_MIGRATIONS, CS2_CATALOG_MARKERS_MIGRATION_ID } from '../../api/src/integrations/cs2/migrations';
import { validateModuleMigrations } from '../../api/src/config/moduleMigrations';

/**
 * The CS2 map list comes from maps.json in cs2-server-manager
 * (api/src/integrations/cs2/maps/mapCatalog.ts), and the sync
 * (./mapSync.ts) adds new maps and keeps the platform's own maps and the
 * Active Duty pool in step with it, never what an admin made or edited:
 *
 * - maps.json is read as it is: names from `name`, images from `images.full`,
 *   non-playable entries (`lobby_mapveto`, `random`, `default*`) left out;
 * - GitHub out of reach → the copy bundled with the module;
 * - the sync adds new maps, keeps admin maps, updates an unmodified Active
 *   Duty pool and leaves an edited one alone;
 * - migration 003 marks the old hard-coded Active Duty list as unmodified;
 * - `POST /api/maps/sync` on the running server does the same.
 *
 * @tag api
 */

const NEW_ACTIVE_DUTY = ['de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train', 'de_vertigo'];

function entry(id: string, name: string, mode = 'defusal') {
  return { id, name, mode, images: { full: `${id}.webp`, thumb: `${id}_thumb.webp` }, variants: [] };
}

/** A small maps.json: the new Active Duty, the two it replaced, one new map, and the folder's non-maps. */
const FILE = {
  generatedAt: '2026-09-25T09:00:59Z',
  patchVersion: '1.41.8.3',
  buildId: '25515054',
  maps: [
    entry('cs_office', 'Office', 'hostage'),
    entry('de_ancient', 'Ancient'),
    entry('de_anubis', 'Anubis'),
    entry('de_boulder', 'Boulder'),
    entry('de_dust2', 'Dust II'),
    entry('de_inferno', 'Inferno'),
    entry('de_mirage', 'Mirage'),
    entry('de_nuke', 'Nuke'),
    entry('de_overpass', 'Overpass'),
    entry('de_train', 'Train'),
    entry('de_vertigo', 'Vertigo'),
    entry('lobby_mapveto', 'Map Veto', 'lobby'),
    entry('random', 'Random', 'random'),
    entry('default_thumb', 'Default', 'unknown'),
  ],
  activeDuty: ['de_inferno', 'de_train', 'de_mirage', 'de_nuke', 'de_dust2', 'de_overpass', 'de_vertigo', 'random'],
};

const catalog: MapCatalog = parseMapCatalog(FILE);
const url = (id: string) => `${MAP_THUMBNAILS_BASE}/${id}.webp`;

/** A database seeded by the old code: the legacy maps and Active Duty list, all marked seeded by migration 003. */
function legacyState(overrides: Partial<MapSyncState> = {}): MapSyncState {
  const ids = ['cs_office', 'de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train', 'de_vertigo'];
  return {
    maps: ids.map((id) => ({
      id,
      displayName: id === 'cs_office' ? 'CS Office' : (FILE.maps.find((m) => m.id === id)?.name ?? id),
      imageUrl: url(id),
      systemManaged: true,
    })),
    knownIds: ids,
    pools: [
      { id: 1, name: ACTIVE_DUTY_POOL, mapIds: [...LEGACY_ACTIVE_DUTY], isDefault: true, systemManaged: true },
    ],
    ...overrides,
  };
}

test.describe('CS2 map catalogue (maps.json)', () => {
  test('maps.json is read as written, without the entries nobody can play', { tag: ['@api', '@maps'] }, () => {
    expect(catalog.maps.map((m) => m.id)).not.toContain('lobby_mapveto');
    expect(catalog.maps.map((m) => m.id)).not.toContain('random');
    expect(catalog.maps.map((m) => m.id)).not.toContain('default_thumb');
    expect(['lobby_mapveto', 'random', 'default', 'default_cs'].some(isPlayableMapId)).toBe(false);

    const dust2 = catalog.maps.find((m) => m.id === 'de_dust2');
    expect(dust2).toEqual({ id: 'de_dust2', displayName: 'Dust II', mode: 'defusal', imageUrl: url('de_dust2') });
    // Only ids that are maps, in the file's order.
    expect(catalog.activeDuty).toEqual(['de_inferno', 'de_train', 'de_mirage', 'de_nuke', 'de_dust2', 'de_overpass', 'de_vertigo']);
    expect(catalog.patchVersion).toBe('1.41.8.3');

    expect(() => parseMapCatalog({ maps: 'nope' })).toThrow();
  });

  test('the bundled copy is a whole catalogue with a seven-map Active Duty', { tag: ['@api', '@maps'] }, () => {
    const bundled = bundledMapCatalog();
    expect(bundled.activeDuty).toHaveLength(7);
    const ids = bundled.maps.map((m) => m.id);
    for (const id of bundled.activeDuty) expect(ids).toContain(id);
    expect(ids.every(isPlayableMapId)).toBe(true);
    for (const map of bundled.maps) expect(map.imageUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/.+\.webp$/);
  });

  test('offline, the bundled copy is used', { tag: ['@api', '@maps'] }, async () => {
    // A port nothing listens on: bound, then closed.
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const loaded = await loadMapCatalog({ url: `http://127.0.0.1:${port}/maps.json`, timeoutMs: 1000 });
    expect(loaded.source).toBe('bundled');
    expect(loaded.error).toBeTruthy();
    expect(loaded.catalog).toEqual(bundledMapCatalog());
  });

  test('a failed first try is retried once, then the remote file is used', { tag: ['@api', '@maps'] }, async () => {
    let requests = 0;
    const server = http.createServer((_req, res) => {
      requests += 1;
      if (requests === 1) {
        res.statusCode = 502;
        res.end('bad gateway');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(FILE));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const loaded = await loadMapCatalog({ url: `http://127.0.0.1:${port}/maps.json`, timeoutMs: 2000 });
      expect(loaded.source).toBe('remote');
      expect(requests).toBe(2);
      expect(loaded.catalog).toEqual(catalog);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

test.describe('CS2 map sync', () => {
  test('adds new maps and keeps what an admin made or edited', { tag: ['@api', '@maps'] }, () => {
    const state = legacyState();
    // An admin's own map, and a seeded map an admin renamed (the edit cleared the marker).
    state.maps.push({ id: 'de_custom', displayName: 'My map', imageUrl: '/map-images/de_custom.png', systemManaged: false });
    const nuke = state.maps.find((m) => m.id === 'de_nuke')!;
    nuke.displayName = 'Nuke (LAN edit)';
    nuke.systemManaged = false;

    const plan = planMapSync(state, catalog, 'auto');
    expect(plan.addMaps.map((m) => m.id)).toEqual(['de_boulder']);
    // Seeded and unedited: takes the catalogue's name. The admin's edits and map stay.
    expect(plan.updateMaps).toEqual([{ id: 'cs_office', displayName: 'Office', imageUrl: url('cs_office'), changed: ['name CS Office → Office'] }]);
    expect(plan.updateMaps.map((m) => m.id)).not.toContain('de_nuke');
    expect(plan.knownIds).toEqual(['de_boulder']);
  });

  test('a seeded map an admin deleted comes back from the admin sync only', { tag: ['@api', '@maps'] }, () => {
    const state = legacyState();
    state.maps = state.maps.filter((m) => m.id !== 'de_ancient');
    expect(planMapSync(state, catalog, 'auto').addMaps.map((m) => m.id)).toEqual(['de_boulder']);
    expect(planMapSync(state, catalog, 'admin').addMaps.map((m) => m.id)).toEqual(['de_ancient', 'de_boulder']);
  });

  test('an unmodified Active Duty pool follows maps.json', { tag: ['@api', '@maps'] }, () => {
    const plan = planMapSync(legacyState(), catalog, 'auto');
    expect(plan.updatePools).toEqual([
      {
        id: 1,
        name: ACTIVE_DUTY_POOL,
        mapIds: NEW_ACTIVE_DUTY,
        added: ['de_overpass', 'de_train'],
        removed: ['de_ancient', 'de_anubis'],
      },
    ]);
    expect(plan.keptPools).toEqual([]);
  });

  test('an Active Duty pool an admin edited is left alone, and so are admin pools', { tag: ['@api', '@maps'] }, () => {
    const state = legacyState({
      pools: [
        { id: 1, name: ACTIVE_DUTY_POOL, mapIds: ['de_ancient', 'de_dust2'], isDefault: true, systemManaged: false },
        { id: 2, name: 'LAN finals', mapIds: ['de_ancient', 'de_anubis'], isDefault: false, systemManaged: false },
      ],
    });
    const plan = planMapSync(state, catalog, 'auto');
    expect(plan.updatePools).toEqual([]);
    expect(plan.keptPools).toEqual([{ name: ACTIVE_DUTY_POOL, catalogue: NEW_ACTIVE_DUTY }]);
    expect(plan.activeDuty).toBe('kept');
    expect(JSON.stringify(plan)).not.toContain('LAN finals');
  });

  test('a fresh database gets every map and the default pools', { tag: ['@api', '@maps'] }, () => {
    const plan = planMapSync({ maps: [], knownIds: [], pools: [] }, catalog, 'auto');
    expect(plan.addMaps).toHaveLength(catalog.maps.length);
    const activeDuty = plan.insertPools.find((p) => p.name === ACTIVE_DUTY_POOL);
    expect(activeDuty).toEqual({ name: ACTIVE_DUTY_POOL, mapIds: NEW_ACTIVE_DUTY, isDefault: true, enabled: true });
    expect(plan.insertPools.find((p) => p.name === 'Hostage only')?.mapIds).toEqual(['cs_office']);
    // A second run changes nothing once the rows are there.
    const after: MapSyncState = {
      maps: plan.addMaps.map((m) => ({ id: m.id, displayName: m.displayName, imageUrl: m.imageUrl, systemManaged: true })),
      knownIds: plan.knownIds,
      pools: plan.insertPools.map((p, i) => ({ id: i + 1, name: p.name, mapIds: p.mapIds, isDefault: p.isDefault, systemManaged: true })),
    };
    const again = planMapSync(after, catalog, 'auto');
    expect([again.addMaps, again.updateMaps, again.insertPools, again.updatePools, again.knownIds]).toEqual([[], [], [], [], []]);
  });

  test('an older catalogue (the bundled copy, offline) only adds maps', { tag: ['@api', '@maps'] }, () => {
    const state = legacyState({ appliedGeneratedAt: '2027-01-01T00:00:00Z' });
    const plan = planMapSync(state, catalog, 'auto');
    expect(plan.stale).toBe(true);
    expect(plan.addMaps.map((m) => m.id)).toEqual(['de_boulder']);
    expect([plan.updateMaps, plan.updatePools]).toEqual([[], []]);
    expect(plan.activeDuty).toBe('stale');

    const current = planMapSync(legacyState({ appliedGeneratedAt: catalog.generatedAt }), catalog, 'auto');
    expect(current.stale).toBe(false);
    expect(current.activeDuty).toBe('updated');
  });

  test('migration 003 marks the old hard-coded Active Duty list as unmodified', { tag: ['@api', '@maps'] }, () => {
    const migration = CS2_MIGRATIONS.find((m) => m.id === CS2_CATALOG_MARKERS_MIGRATION_ID);
    expect(migration).toBeDefined();
    expect(migration!.up).toContain(`map_ids = '${JSON.stringify(LEGACY_ACTIVE_DUTY)}'`);
    expect(validateModuleMigrations('cs2', CS2_MIGRATIONS)).toBeNull();
  });
});

test.describe('POST /api/maps/sync', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('keeps admin maps and pools, and an unmodified Active Duty follows maps.json', { tag: ['@api', '@maps'] }, async ({ request }) => {
    const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const mapId = `de_sync_test_${suffix}`;
    const poolName = `Sync test pool ${suffix}`;
    const created = await request.post('/api/maps', { data: { id: mapId, displayName: 'Admin map' } });
    expect(created.ok(), await created.text()).toBe(true);
    const pool = await request.post('/api/map-pools', { data: { name: poolName, mapIds: ['de_ancient', 'de_anubis'] } });
    expect(pool.ok(), await pool.text()).toBe(true);
    const poolId = (await pool.json()).mapPool.id as number;

    try {
      const res = await request.post('/api/maps/sync');
      expect(res.ok(), await res.text()).toBe(true);
      const body = await res.json();
      expect(['remote', 'bundled']).toContain(body.source);
      expect(body.activeDuty).toHaveLength(7);
      expect(['created', 'updated', 'kept', 'unchanged', 'stale']).toContain(body.activeDutyPool);

      const map = (await (await request.get(`/api/maps/${mapId}`)).json()).map;
      expect(map).toMatchObject({ id: mapId, displayName: 'Admin map', systemManaged: false });

      const pools = (await (await request.get('/api/map-pools')).json()).mapPools as Array<{
        id: number;
        name: string;
        mapIds: string[];
        systemManaged: boolean;
      }>;
      expect(pools.find((p) => p.id === poolId)?.mapIds).toEqual(['de_ancient', 'de_anubis']);
      const activeDuty = pools.find((p) => p.name === ACTIVE_DUTY_POOL);
      if (activeDuty?.systemManaged) {
        expect(activeDuty.mapIds).toEqual([...body.activeDuty].sort());
      }
    } finally {
      await request.delete(`/api/map-pools/${poolId}`);
      await request.delete(`/api/maps/${mapId}`);
    }
  });
});
