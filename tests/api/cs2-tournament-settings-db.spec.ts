import { test, expect, type APIRequestContext } from '@playwright/test';
import { signInViaRequest, getAuthHeader } from '../helpers/auth';
import { getSchemaSQL, parseSchemaColumns } from '../../api/src/config/database.schema';
import {
  LEGACY_TEMPLATE_COLUMNS,
  LEGACY_TOURNAMENT_COLUMNS,
} from '../../api/src/config/cs2SettingsFold';
import { SCHEMA_MIGRATIONS } from '../../api/src/config/schemaMigrations';
import { cs2TournamentSettings } from '../../api/src/integrations/cs2/tournamentSettings';

/**
 * CS2's tournament settings are CS2's own (DESIGN-modules §6 item 10, after
 * #343): the map pool, shuffle map sequence, max rounds and overtime that 2.x
 * kept in `tournament` columns, and the pool and maps of `tournament_templates`,
 * are CS2's object in `settings` (`settings.cs2`). The core migration
 * `2026-09-24-cs2-tournament-settings` (api/src/config/cs2SettingsFold.ts)
 * folds the columns in and drops them.
 *
 * - core's schema no longer declares the columns;
 * - the fold, on a 2.4.15-shaped copy and on a 3.0 copy from before it, keeps
 *   every value, is a no-op the second time, and refuses (rolling back) a row
 *   it cannot read;
 * - the API still takes and returns the 2.x top-level fields, and takes CS2's
 *   object in `settings` too;
 * - CS2's `fromRequest` keeps each field's old column rule.
 *
 * The real 2.4.15 -> current upgrade is scripts/test-upgrade.ts.
 *
 * @tag api
 */

interface FoldReport {
  tournaments: number;
  templates: number;
  skipped: number;
  dropped: string[];
}

interface FoldProbe {
  first: { report: FoldReport | null; error: string | null };
  second: { report: FoldReport | null; error: string | null };
  columns: { tournament: string[]; tournament_templates: string[] };
  tournaments: Array<{ id: number; settings: unknown }>;
  templates: Array<{ id: number; settings: unknown }>;
}

const ALL_DROPPED = [
  ...LEGACY_TOURNAMENT_COLUMNS.map((c) => `tournament.${c}`),
  ...LEGACY_TEMPLATE_COLUMNS.map((c) => `tournament_templates.${c}`),
];

async function foldProbe(request: APIRequestContext, scenario: string): Promise<FoldProbe> {
  const res = await request.post('/api/test/cs2-settings-fold/probe', { data: { scenario } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as FoldProbe;
}

function settingsOf(rows: Array<{ id: number; settings: unknown }>, id: number): unknown {
  return rows.find((r) => r.id === id)?.settings;
}

test.describe('CS2 tournament settings: definitions', () => {
  test("core's schema declares none of the folded columns", () => {
    const columns = parseSchemaColumns(getSchemaSQL()).map((c) => `${c.table}.${c.column}`);
    for (const column of ALL_DROPPED) expect(columns).not.toContain(column);
    // What stays: the settings object they moved into, and the game.
    expect(columns).toEqual(
      expect.arrayContaining([
        'tournament.settings',
        'tournament.game',
        'tournament_templates.settings',
        'tournament_templates.game',
      ])
    );
  });

  test('the fold is a core migration, appended after the ones that shipped', () => {
    const ids = SCHEMA_MIGRATIONS.map((m) => m.id);
    expect(ids.indexOf('2026-09-24-cs2-tournament-settings')).toBe(ids.length - 1);
  });

  test("CS2's fromRequest keeps each column's old rule", () => {
    const create = cs2TournamentSettings.fromRequest(
      { maps: ['de_dust2'], overtimeSegments: 0 },
      undefined,
      'tournament'
    );
    // A new tournament gets 24 rounds and overtime on, as the columns defaulted.
    expect(create).toEqual({
      maps: ['de_dust2'],
      maxRounds: 24,
      overtimeMode: 'enabled',
      overtimeSegments: 0,
    });

    // An update only changes what it sends; null segments go back to the default.
    const stored = {
      maps: ['de_dust2'],
      maxRounds: 16,
      overtimeMode: 'disabled' as const,
      overtimeSegments: 0,
    };
    expect(cs2TournamentSettings.fromRequest({ name: 'x' }, stored, 'tournament')).toEqual(stored);
    expect(
      cs2TournamentSettings.fromRequest(
        { overtimeSegments: null, maxRounds: 12 },
        stored,
        'tournament'
      )
    ).toEqual({ maps: ['de_dust2'], maxRounds: 12, overtimeMode: 'disabled' });

    // CS2's object in settings works too; a 2.x top-level field wins over it.
    expect(
      cs2TournamentSettings.fromRequest(
        { settings: { cs2: { maps: ['de_nuke'], maxRounds: 8 } }, maxRounds: 10 },
        stored,
        'tournament'
      )
    ).toEqual({ maps: ['de_nuke'], maxRounds: 10, overtimeMode: 'disabled', overtimeSegments: 0 });

    // A template: `maps: null` and a falsy pool clear them, as the columns did.
    expect(
      cs2TournamentSettings.fromRequest({ mapPoolId: 4, maps: ['de_dust2'] }, undefined, 'template')
    ).toEqual({ mapPoolId: 4, maps: ['de_dust2'] });
    expect(
      cs2TournamentSettings.fromRequest(
        { mapPoolId: null, maps: null },
        { mapPoolId: 4, maps: ['a'] },
        'template'
      )
    ).toEqual({});
  });

  test("CS2's response fields are the 2.x ones", () => {
    expect(
      cs2TournamentSettings.responseFields?.({ maps: ['a'], maxRounds: 16 }, 'tournament')
    ).toEqual({
      maps: ['a'],
      mapSequence: undefined,
      maxRounds: 16,
      overtimeMode: undefined,
      overtimeSegments: undefined,
    });
    expect(cs2TournamentSettings.responseFields?.(undefined, 'template')).toEqual({
      maps: [],
      mapPoolId: undefined,
    });
  });
});

test.describe.serial('CS2 tournament settings on the database', () => {
  test.beforeEach(async ({ request }) => {
    expect(await signInViaRequest(request)).toBe(true);
  });

  test('a 2.4.15 database: every value moves to settings.cs2, then the columns go', async ({
    request,
  }) => {
    const probe = await foldProbe(request, 'legacy');
    expect(probe.first.error).toBeNull();
    expect(probe.first.report).toEqual({
      tournaments: 2,
      templates: 2,
      skipped: 0,
      dropped: ALL_DROPPED,
    });
    // A second run finds nothing to do.
    expect(probe.second).toEqual({
      report: { tournaments: 0, templates: 0, skipped: 0, dropped: [] },
      error: null,
    });
    for (const column of LEGACY_TOURNAMENT_COLUMNS) {
      expect(probe.columns.tournament).not.toContain(column);
    }
    for (const column of LEGACY_TEMPLATE_COLUMNS) {
      expect(probe.columns.tournament_templates).not.toContain(column);
    }

    // Shuffle: every column, 0 segments kept as 0; the rest of settings untouched.
    expect(settingsOf(probe.tournaments, 1)).toEqual({
      matchFormat: 'bo1',
      customVetoOrder: { bo1: [] },
      cs2: {
        maps: ['de_ancient', 'de_nuke'],
        mapSequence: ['de_ancient', 'de_nuke'],
        maxRounds: 16,
        overtimeMode: 'disabled',
        overtimeSegments: 0,
      },
    });
    // NULL settings become an object; NULL columns become absent fields.
    expect(settingsOf(probe.tournaments, 2)).toEqual({
      cs2: {
        maps: ['de_dust2', 'de_mirage', 'de_inferno'],
        maxRounds: 24,
        overtimeMode: 'enabled',
      },
    });
    expect(settingsOf(probe.templates, 1)).toEqual({
      matchFormat: 'bo3',
      maxRounds: 16,
      cs2: { mapPoolId: 7, maps: ['de_dust2', 'de_mirage'] },
    });
    // A template with neither keeps its settings as they were.
    expect(settingsOf(probe.templates, 2)).toEqual({});
    expect(settingsOf(probe.templates, 3)).toEqual({
      matchFormat: 'bo1',
      cs2: { maps: ['de_inferno'] },
    });
  });

  test('a 3.0 database from before the fold: other games and an existing cs2 object', async ({
    request,
  }) => {
    const probe = await foldProbe(request, 'current');
    expect(probe.first.error).toBeNull();
    // Tournaments 1, 2, 4, 5; templates 1 and 3. The Rocket League cup and
    // template held only defaults.
    expect(probe.first.report).toEqual({
      tournaments: 4,
      templates: 2,
      skipped: 2,
      dropped: ALL_DROPPED,
    });
    expect(probe.second.report).toEqual({ tournaments: 0, templates: 0, skipped: 0, dropped: [] });

    expect(settingsOf(probe.tournaments, 3)).toEqual({ manualReport: { gameLabel: 'RL' } });
    // Another game with a value someone set keeps it.
    expect(settingsOf(probe.tournaments, 4)).toEqual({
      cs2: { maps: [], maxRounds: 12, overtimeMode: 'enabled' },
    });
    // The columns win field by field; fields they do not hold stay.
    expect(settingsOf(probe.tournaments, 5)).toEqual({
      cs2: { maps: ['de_vertigo'], mapPoolId: 3, maxRounds: 12, overtimeMode: 'enabled' },
    });
    expect(settingsOf(probe.templates, 4)).toEqual({});
  });

  test('a row it cannot read stops the fold and nothing changes', async ({ request }) => {
    const probe = await foldProbe(request, 'bad-settings');
    expect(probe.first.report).toBeNull();
    expect(probe.first.error).toContain('tournament row 9');
    // Still refused the second time: it never half-applies.
    expect(probe.second.error).toContain('tournament row 9');
    expect(probe.columns.tournament).toEqual(
      expect.arrayContaining([...LEGACY_TOURNAMENT_COLUMNS])
    );
    expect(probe.columns.tournament_templates).toEqual(
      expect.arrayContaining([...LEGACY_TEMPLATE_COLUMNS])
    );
    expect(settingsOf(probe.tournaments, 1)).toEqual({
      matchFormat: 'bo1',
      customVetoOrder: { bo1: [] },
    });
    expect(settingsOf(probe.tournaments, 9)).toBe('not json');
  });

  test('the live database ran the fold and has no CS2 columns', async ({ request }) => {
    const res = await request.get('/api/test/schema-migrations');
    expect(res.ok()).toBe(true);
    expect((await res.json()).applied).toContain('2026-09-24-cs2-tournament-settings');

    const columns = await request.get('/api/test/cs2-settings-fold/columns');
    expect(columns.ok(), await columns.text()).toBe(true);
    const body = (await columns.json()) as { tournament: string[]; tournament_templates: string[] };
    for (const column of LEGACY_TOURNAMENT_COLUMNS) expect(body.tournament).not.toContain(column);
    for (const column of LEGACY_TEMPLATE_COLUMNS) {
      expect(body.tournament_templates).not.toContain(column);
    }
  });

  test('the API takes and returns the 2.x fields, stored as settings.cs2', async ({ request }) => {
    const headers = getAuthHeader();
    const stamp = Date.now();
    const teamIds = [`cs2set-a-${stamp}`, `cs2set-b-${stamp}`];
    for (const [i, id] of teamIds.entries()) {
      const team = await request.post('/api/teams', {
        headers,
        data: {
          id,
          name: id,
          players: [{ steamId: `7656119990${stamp % 1000000}${i}`, name: `P${i}` }],
        },
      });
      expect(team.ok(), await team.text()).toBe(true);
    }

    await request.delete('/api/tournament', { headers });
    const created = await request.post('/api/tournament', {
      headers,
      data: {
        name: `CS2 settings ${stamp}`,
        type: 'single_elimination',
        format: 'bo1',
        maps: ['de_dust2', 'de_mirage'],
        teamIds,
        maxRounds: 16,
        overtimeMode: 'disabled',
        overtimeSegments: 0,
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { tournament } = await created.json();
    expect(tournament).toMatchObject({
      maps: ['de_dust2', 'de_mirage'],
      maxRounds: 16,
      overtimeMode: 'disabled',
      overtimeSegments: 0,
    });
    expect(tournament.settings.cs2).toEqual({
      maps: ['de_dust2', 'de_mirage'],
      maxRounds: 16,
      overtimeMode: 'disabled',
      overtimeSegments: 0,
    });

    // The new shape: CS2's object in settings, merged into what is stored.
    const updated = await request.put('/api/tournament', {
      headers,
      data: { settings: { cs2: { maxRounds: 12, overtimeSegments: null, mapPoolId: 1 } } },
    });
    expect(updated.ok(), await updated.text()).toBe(true);
    const after = (await updated.json()).tournament;
    expect(after).toMatchObject({ maps: ['de_dust2', 'de_mirage'], maxRounds: 12, mapPoolId: 1 });
    expect(after.overtimeSegments).toBeUndefined();
    expect(after.settings.cs2).toEqual({
      maps: ['de_dust2', 'de_mirage'],
      maxRounds: 12,
      overtimeMode: 'disabled',
      mapPoolId: 1,
    });

    // A 2.x update: top-level fields only.
    const legacy = await request.put('/api/tournament', {
      headers,
      data: { maxRounds: 24, overtimeMode: 'enabled' },
    });
    expect(legacy.ok(), await legacy.text()).toBe(true);
    const got = await request.get('/api/tournament', { headers });
    expect((await got.json()).tournament).toMatchObject({
      maxRounds: 24,
      overtimeMode: 'enabled',
      maps: ['de_dust2', 'de_mirage'],
    });

    await request.delete('/api/tournament', { headers });
    for (const id of teamIds) await request.delete(`/api/teams/${id}`, { headers });
  });

  test('templates keep mapPoolId and maps, stored as settings.cs2', async ({ request }) => {
    const headers = getAuthHeader();
    const name = `CS2 settings template ${Date.now()}`;
    const created = await request.post('/api/templates', {
      headers,
      data: {
        name,
        type: 'single_elimination',
        format: 'bo3',
        mapPoolId: 1,
        maps: ['de_dust2', 'de_nuke'],
        settings: { maxRounds: 16 },
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { template } = await created.json();
    expect(template).toMatchObject({ mapPoolId: 1, maps: ['de_dust2', 'de_nuke'], game: 'cs2' });
    expect(template.settings.cs2).toEqual({ mapPoolId: 1, maps: ['de_dust2', 'de_nuke'] });
    // The core's own hints stay where the client saved them.
    expect(template.settings.maxRounds).toBe(16);

    // Saving under the same name updates it; `maps: null` clears the maps.
    const again = await request.post('/api/templates', {
      headers,
      data: { name, type: 'single_elimination', format: 'bo3', mapPoolId: null, maps: null },
    });
    expect(again.ok(), await again.text()).toBe(true);
    const saved = (await again.json()).template;
    expect(saved.maps).toEqual([]);
    expect(saved.mapPoolId).toBeUndefined();

    const removed = await request.delete(`/api/templates/${template.id}`, { headers });
    expect(removed.ok(), await removed.text()).toBe(true);
  });
});
