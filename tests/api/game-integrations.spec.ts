import { test, expect } from '@playwright/test';
import {
  getIntegration,
  hasIntegration,
  integrationForMatch,
  listIntegrations,
  registerIntegration,
  UnknownGameError,
} from '../../api/src/integrations/registry';
import { DEFAULT_GAME } from '../../api/src/integrations/types';
import { getSchemaColumns } from '../../api/src/config/database.schema';

/**
 * Game integration registry and the `game` column (3.0 module split, PR 2).
 *
 * CS2 is registered as a pure wrapper around today's services; nothing in the
 * core calls it yet, so these checks stay at the registry / schema level. The
 * behaviour it wraps is pinned by the golden specs.
 *
 * @tag api
 */
test.describe('Game integration registry', () => {
  test('cs2 is registered and is the default game', () => {
    expect(DEFAULT_GAME).toBe('cs2');
    expect(hasIntegration('cs2')).toBe(true);
    expect(listIntegrations().map((i) => i.id)).toContain('cs2');
    const cs2 = getIntegration('cs2');
    expect(cs2.id).toBe('cs2');
    expect(cs2.displayName).toBe('Counter-Strike 2');
  });

  test('cs2 declares every capability', () => {
    expect(getIntegration('cs2').capabilities).toEqual({
      servers: true,
      veto: true,
      liveEvents: true,
      demos: true,
      playerStats: true,
    });
  });

  test('rows without a game (or selected without the column) resolve to cs2', () => {
    expect(integrationForMatch({}).id).toBe('cs2');
    expect(integrationForMatch({ game: null }).id).toBe('cs2');
    expect(integrationForMatch({ game: '' }).id).toBe('cs2');
    expect(integrationForMatch({ game: 'cs2' }).id).toBe('cs2');
  });

  test('an unknown game id is an error; a game ref falls back to the catch-all module', () => {
    // `getIntegration` is the by-id lookup and stays strict.
    expect(() => getIntegration('no-such-game')).toThrow(UnknownGameError);
    expect(hasIntegration('no-such-game')).toBe(false);

    // A `game` *ref* is a catalogue id from 3.0 phase D onwards, and the
    // manual-report module runs any catalogue game (`runsAnyCatalogGame`), so
    // a row for a game no dedicated module claims resolves to it rather than
    // throwing. That is the whole point of the flag: a tournament created for
    // a game someone found through IGDB search must still find a module.
    const fallback = integrationForMatch({ game: 'no-such-game' });
    expect(fallback.id).toBe('manual-report');
    expect(fallback.runsAnyCatalogGame).toBe(true);
    // The cost of that fallback: a typo'd game id is a manual-report
    // tournament rather than an error. Rows the core writes come from the
    // catalogue, so it only bites a hand-written one.
    expect(integrationForMatch({ game: 'cs3' }).id).toBe('manual-report');
  });

  test('registering the same id twice is rejected', () => {
    expect(() => registerIntegration(getIntegration('cs2'))).toThrow(/already registered/);
  });

  test('cs2 stats schema is a function of the tournament and lists the MatchZy metrics', () => {
    const cs2 = getIntegration('cs2');
    const standalone = cs2.statsSchema(null);
    const inTournament = cs2.statsSchema({
      id: 1,
      type: 'single_elimination',
      format: 'bo3',
      settings: {},
    });
    const keys = standalone.metrics.map((m) => m.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'adr',
        'kills',
        'deaths',
        'assists',
        'headshots',
        'kast',
        'flash_assists',
        'utility_damage',
        'mvps',
        'score',
        'rounds_played',
      ])
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(inTournament.metrics.map((m) => m.key)).toEqual(keys);
  });

  test('cs2 describeMatch reads the MatchZy config into the neutral shape', () => {
    const config = {
      matchid: 7,
      skip_veto: true,
      players_per_team: 2,
      num_maps: 3,
      maplist: ['de_ancient', 'de_anubis', 'de_nuke'],
      team1: { id: 'alpha', name: 'Alpha', players: { '76561198000000001': 'a1' } },
      team2: { name: 'Bravo', players: { '76561198000000002': 'b1' } },
    };
    const expected = {
      seriesLength: 3,
      maps: ['de_ancient', 'de_anubis', 'de_nuke'],
      playersPerTeam: 2,
      team1: {
        id: 'alpha',
        name: 'Alpha',
        players: [{ account: { provider: 'steam', externalId: '76561198000000001' }, name: 'a1' }],
      },
      team2: {
        name: 'Bravo',
        players: [{ account: { provider: 'steam', externalId: '76561198000000002' }, name: 'b1' }],
      },
    };
    const cs2 = getIntegration('cs2');
    expect(cs2.describeMatch(config)).toEqual(expected);
    // matches.config is stored as a string; both forms are accepted.
    expect(cs2.describeMatch(JSON.stringify(config))).toEqual(expected);
  });

  test('cs2 describeMatch reads stored manual configs (player arrays, tag, veto flag)', () => {
    // The shape the "Create manual match" modal posts and matches.config keeps.
    const config = {
      vetoDisabled: false,
      num_maps: 1,
      maplist: null,
      team1: {
        id: 'alpha',
        name: 'Alpha',
        tag: 'ALP',
        players: [{ steamid: '76561198000000001', name: 'a1' }],
      },
      team2: { name: 'Mix', players: [{ steamId: '76561198000000002', name: 'b1' }] },
    };
    expect(getIntegration('cs2').describeMatch(config)).toEqual({
      seriesLength: 1,
      maps: [],
      skipPreMatchPhase: false,
      team1: {
        id: 'alpha',
        name: 'Alpha',
        tag: 'ALP',
        players: [{ account: { provider: 'steam', externalId: '76561198000000001' }, name: 'a1' }],
      },
      team2: {
        name: 'Mix',
        players: [{ account: { provider: 'steam', externalId: '76561198000000002' }, name: 'b1' }],
      },
    });
    // Unreadable or empty configs describe as an empty match instead of throwing.
    for (const bad of ['not json', 'null', '', null]) {
      expect(getIntegration('cs2').describeMatch(bad)).toMatchObject({ seriesLength: 1, maps: [] });
    }
  });

  test('cs2 exports the lifecycle hooks core will call', () => {
    const cs2 = getIntegration('cs2');
    expect(typeof cs2.onMatchReady).toBe('function');
    expect(typeof cs2.buildMatchConfig).toBe('function');
    expect(typeof cs2.capacity).toBe('function');
    expect(typeof cs2.allocate).toBe('function');
    expect(typeof cs2.restart).toBe('function');
  });
});

test.describe('game column', () => {
  for (const table of ['tournament', 'matches', 'tournament_templates', 'manual_match_templates']) {
    test(`${table}.game is auto-migrated with a cs2 default`, () => {
      const column = getSchemaColumns().find((c) => c.table === table && c.column === 'game');
      expect(column, `${table}.game missing from the schema`).toBeDefined();
      // NOT NULL is kept because there is a DEFAULT, so existing rows backfill to 'cs2'.
      expect(column!.type).toBe("TEXT NOT NULL DEFAULT 'cs2'");
    });
  }
});
