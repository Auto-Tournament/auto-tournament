import { test, expect } from '@playwright/test';
import {
  mapsOfOtherModes,
  modeFromCatalog,
  modeFromMapName,
  modeFromWorkshopTags,
  normalizeMapMode,
  rememberMapModes,
} from '../../api/src/integrations/cs2/maps/mapModes';
import {
  cs2TournamentSettings,
  validateCs2TournamentSettings,
} from '../../api/src/integrations/cs2/tournamentSettings';
import {
  CS2_MIGRATIONS,
  CS2_MAP_MODES_MIGRATION_ID,
} from '../../api/src/integrations/cs2/migrations';
import { validateModuleMigrations } from '../../api/src/config/moduleMigrations';

/**
 * A map's type (api/src/integrations/cs2/maps/mapModes.ts):
 *
 * - from maps.json's `mode`, the Workshop tags, or the id prefix;
 * - a tournament with `settings.cs2.mapMode` refuses maps of another type
 *   (a wingman tournament cannot load a classic map); maps of no known type pass;
 * - migration 004 adds the column and fills it from the id prefix.
 *
 * Pure: no server, no database.
 *
 * @tag api
 * @tag maps
 */

test.describe('CS2 map types', () => {
  test('types from maps.json, the id and the Workshop tags', () => {
    expect(normalizeMapMode('Defusal')).toBe('defusal');
    expect(normalizeMapMode('Arms Race')).toBe('armsrace');
    expect(normalizeMapMode('retakes')).toBeNull();
    expect(modeFromMapName('de_dust2')).toBe('defusal');
    expect(modeFromMapName('cs_office')).toBe('hostage');
    expect(modeFromMapName('ar_baggage')).toBe('armsrace');
    expect(modeFromMapName('3793104017')).toBeNull();
    expect(modeFromCatalog('hostage', 'cs_italy')).toBe('hostage');
    expect(modeFromCatalog('unknown', 'de_train')).toBe('defusal');

    expect(modeFromWorkshopTags(['Map', 'Wingman'], 'Rooftop')).toBe('wingman');
    expect(modeFromWorkshopTags(['Classic', 'Wingman'], 'de_shortdust')).toBe('wingman');
    expect(modeFromWorkshopTags(['Classic'], 'de_cache')).toBe('defusal');
    expect(modeFromWorkshopTags(['Classic'], 'cs_assault')).toBe('hostage');
    expect(modeFromWorkshopTags(['Classic', 'Hostage'], 'Warehouse')).toBe('hostage');
    expect(modeFromWorkshopTags(['Arms Race'], 'Stadium')).toBe('armsrace');
    expect(modeFromWorkshopTags(['Deathmatch'], 'Aim map')).toBe('deathmatch');
    expect(modeFromWorkshopTags(['Map'], 'de_cbble')).toBe('defusal');
    expect(modeFromWorkshopTags([], 'Surf Kitsune')).toBeNull();
  });

  test('a tournament map type refuses maps of another type', () => {
    rememberMapModes(
      [
        { id: 'de_dust2', gameMode: 'defusal' },
        { id: 'de_shortdust', gameMode: 'wingman' },
        { id: 'cs_office', gameMode: 'hostage' },
        { id: '3793104017', gameMode: null },
      ],
      true
    );
    expect(
      mapsOfOtherModes(['de_dust2', 'de_shortdust', '3793104017', 'de_unknown'], 'wingman')
    ).toEqual([{ id: 'de_dust2', mode: 'defusal' }]);

    const create = (body: Record<string, unknown>) =>
      validateCs2TournamentSettings({ mode: 'create', body, settings: {} } as never);

    const wingman = create({
      maps: ['de_shortdust', '3793104017'],
      settings: { cs2: { mapMode: 'wingman' } },
    });
    expect(wingman.valid).toBe(true);

    const mixed = create({ maps: ['de_shortdust', 'de_dust2'], mapMode: 'wingman' });
    expect(mixed.valid).toBe(false);
    expect(mixed.fieldErrors).toEqual([
      'Map de_dust2 is a defusal map; this tournament only plays wingman maps',
    ]);

    expect(create({ maps: ['de_dust2', 'cs_office'] }).valid).toBe(true);
    expect(create({ maps: ['de_dust2'], mapMode: 'classic-ish' }).fieldErrors?.[0]).toMatch(
      /^mapMode must be one of/
    );

    // An update checks the stored maps against a new type, and new maps against the stored type.
    const stored = {
      settings: JSON.stringify({ cs2: { maps: ['de_dust2'], mapMode: 'defusal' } }),
    };
    const update = (body: Record<string, unknown>) =>
      validateCs2TournamentSettings({ mode: 'update', body, settings: {}, stored } as never);
    expect(update({ name: 'x' }).valid).toBe(true);
    expect(update({ mapMode: 'hostage' }).valid).toBe(false);
    expect(update({ maps: ['cs_office'] }).valid).toBe(false);
    expect(update({ maps: ['cs_office'], mapMode: null }).valid).toBe(true);

    const shuffle = validateCs2TournamentSettings({
      mode: 'create-shuffle',
      body: {
        mapSequence: ['de_dust2', 'cs_office'],
        maxRounds: 12,
        overtimeMode: 'enabled',
        mapMode: 'hostage',
      },
      settings: {},
    } as never);
    expect(shuffle.fieldErrors).toEqual([
      'Map de_dust2 is a defusal map; this tournament only plays hostage maps',
    ]);
  });

  test('settings.cs2.mapMode is stored, and null clears it', () => {
    const set = cs2TournamentSettings.fromRequest(
      { settings: { cs2: { maps: ['de_shortdust'], mapMode: 'wingman' } } },
      undefined,
      'tournament'
    );
    expect(set.mapMode).toBe('wingman');
    const cleared = cs2TournamentSettings.fromRequest(
      { settings: { cs2: { mapMode: null } } },
      set,
      'tournament'
    );
    expect(cleared.mapMode).toBeUndefined();
    const ignored = cs2TournamentSettings.fromRequest({ mapMode: 'nonsense' }, set, 'tournament');
    expect(ignored.mapMode).toBe('wingman');
  });

  test('migration 004 adds the column and types existing maps by prefix', () => {
    expect(validateModuleMigrations('cs2', CS2_MIGRATIONS)).toBeNull();
    const migration = CS2_MIGRATIONS.find((m) => m.id === CS2_MAP_MODES_MIGRATION_ID);
    expect(migration).toBeDefined();
    // Migrations are append-only: 004 stays the fourth, whatever comes after it.
    expect(CS2_MIGRATIONS[3]).toBe(migration);
    expect(migration!.up).toContain(
      'ALTER TABLE cs2_maps ADD COLUMN IF NOT EXISTS game_mode TEXT;'
    );
    expect(migration!.up).toContain(
      "SET game_mode = 'hostage' WHERE game_mode IS NULL AND id LIKE 'cs\\_%'"
    );
  });
});
