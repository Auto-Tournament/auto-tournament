import { test, expect } from '@playwright/test';
import { hasIntegration, listIntegrations } from '../../api/src/integrations/registry';
import { fakeIntegration, isFakeIntegrationEnabled } from '../../api/src/integrations/fake';
import type { GameIntegration, MatchContext } from '../../api/src/integrations/types';
import {
  BALANCED_STATS_V1_WEIGHTS,
  PURE_WIN_LOSS_WEIGHTS,
  unknownWeightKeys,
} from '../../api/src/utils/eloWeights';
import { CORE_SETTINGS } from '../../api/src/services/settingsService';

/**
 * Game integration contract (3.0 phase C, PR 14).
 *
 * Every integration the registry holds must honour the same contract, so the
 * core can treat them alike. This spec runs the checks over each registered
 * integration, plus the test-only fake one when this process did not register
 * it (the spec process does not set MAT_TEST_INTEGRATION). The fake is not
 * added to the shared registry here: other specs in the same worker read the
 * route table from it.
 *
 * The checks are the ones that need no database. The fake integration's
 * end-to-end run (tests/api/fake-integration.spec.ts) covers the lifecycle
 * against a live API, and cs2-normalize / the golden specs cover CS2's
 * events and configs.
 *
 * @tag api
 */

const integrations: GameIntegration[] = [
  ...listIntegrations(),
  ...(hasIntegration(fakeIntegration.id) ? [] : [fakeIntegration]),
];

/** Stored configs a describeMatch must survive: missing, empty, broken, wrong shape. */
const JUNK_CONFIGS: unknown[] = [null, undefined, '', '{', '[]', '42', 42, [], {}, { team1: 7 }];

function ctxFor(integration: GameIntegration, overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    slug: 'contract-r1m1',
    matchId: 0,
    game: integration.id,
    tournament: null,
    team1: null,
    team2: null,
    round: 0,
    integrationConfig: {},
    resourceId: null,
    ...overrides,
  };
}

test.describe('Game integration contract', () => {
  test('cs2 and the fake integration are both covered', () => {
    expect(integrations.map((i) => i.id)).toEqual(expect.arrayContaining(['cs2', 'fake']));
  });

  test('ids are unique, lowercase and non-empty, with a display name', () => {
    const ids = integrations.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const integration of integrations) {
      expect(integration.id, integration.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(integration.displayName.trim(), integration.id).not.toBe('');
    }
  });

  for (const integration of integrations) {
    test.describe(integration.id, () => {
      test('declares every capability as a boolean', () => {
        const caps = integration.capabilities;
        for (const key of ['servers', 'veto', 'liveEvents', 'demos', 'playerStats'] as const) {
          expect(typeof caps[key], key).toBe('boolean');
        }
      });

      test('has the lifecycle hooks the core always calls', () => {
        expect(typeof integration.buildMatchConfig).toBe('function');
        expect(typeof integration.describeMatch).toBe('function');
        expect(typeof integration.capacity).toBe('function');
        expect(typeof integration.allocate).toBe('function');
        expect(typeof integration.restart).toBe('function');
      });

      test('servers imply a way to free them; no servers means unlimited capacity', async () => {
        if (integration.capabilities.servers) {
          // The core frees a server after every series and shows the pool.
          expect(typeof integration.release).toBe('function');
          expect(typeof integration.poolStatus).toBe('function');
        } else {
          // The scheduler reads null as "never runs out" and must not wait.
          expect(await integration.capacity({ tournamentId: null })).toBeNull();
          expect(await integration.capacity({ tournamentId: 1, slug: 'contract-r1m1' })).toBeNull();
        }
      });

      test('a pre-match phase can hold a match back from allocation', () => {
        if (!integration.capabilities.veto) return;
        expect(
          typeof integration.isReadyToAllocate === 'function' ||
            typeof integration.startPendingPreMatchPhases === 'function'
        ).toBe(true);
      });

      test('stats schema: unique keys, stable across calls, and a way to store them', () => {
        const schema = integration.statsSchema(null);
        const keys = schema.metrics.map((m) => m.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(integration.statsSchema(null)).toEqual(schema);
        const weightKeys = schema.metrics
          .filter((m) => m.ratingWeightable)
          .map((m) => m.ratingWeightKey ?? m.key);
        expect(new Set(weightKeys).size).toBe(weightKeys.length);
        if (integration.capabilities.playerStats) {
          expect(keys.length).toBeGreaterThan(0);
          expect(typeof integration.playerStatsColumns).toBe('function');
          expect(typeof integration.playerStatsMetrics).toBe('function');
        }
      });

      test('built-in ELO templates only weight metrics the schema declares', () => {
        if (!integration.capabilities.playerStats) return;
        const schema = integration.statsSchema(null);
        expect(unknownWeightKeys(PURE_WIN_LOSS_WEIGHTS, schema)).toEqual([]);
        expect(unknownWeightKeys(BALANCED_STATS_V1_WEIGHTS, schema)).toEqual([]);
      });

      test('instance settings: own keys, declared in setupSchema.instance', () => {
        const keys = (integration.instanceSettings ?? []).map((d) => d.key);
        expect(new Set(keys).size).toBe(keys.length);
        const core = new Set(CORE_SETTINGS.map((d) => d.key));
        expect(keys.filter((k) => core.has(k))).toEqual([]);
        if (keys.length > 0) {
          const declared = Object.keys(
            (integration.setupSchema?.instance?.properties ?? {}) as Record<string, unknown>
          );
          expect(declared.sort()).toEqual([...keys].sort());
        }
      });

      test('describeMatch is total: any stored config describes, never throws', () => {
        for (const config of JUNK_CONFIGS) {
          const d = integration.describeMatch(config);
          const label = JSON.stringify(config) ?? String(config);
          expect(Number.isInteger(d.seriesLength) && d.seriesLength >= 1, label).toBe(true);
          expect(Array.isArray(d.maps), label).toBe(true);
          for (const team of [d.team1, d.team2]) {
            expect(typeof team.name, label).toBe('string');
            expect(Array.isArray(team.players), label).toBe(true);
          }
        }
      });

      test('no two integrations mount routes at the same prefix', () => {
        const mine = new Set((integration.legacyRoutes?.() ?? []).map((r) => r.prefix));
        for (const other of integrations) {
          if (other === integration) continue;
          for (const r of other.legacyRoutes?.() ?? []) {
            expect(mine.has(r.prefix), `${integration.id} and ${other.id}: ${r.prefix}`).toBe(false);
          }
        }
        for (const prefix of mine) expect(prefix).toMatch(/^\/api\//);
      });
    });
  }
});

test.describe('Fake integration (no database needed)', () => {
  test('builds a config describeMatch reads back: series length from the format', async () => {
    for (const [format, length] of [
      ['bo1', 1],
      ['bo3', 3],
      ['bo5', 5],
    ] as const) {
      const config = await fakeIntegration.buildMatchConfig({
        slug: 'r1m1',
        matchId: 0,
        game: 'fake',
        tournament: { id: 1, type: 'single_elimination', format, settings: {} },
        team1: null,
        team2: null,
        round: 1,
      });
      const described = fakeIntegration.describeMatch(JSON.stringify(config));
      expect(described.seriesLength).toBe(length);
      expect(described.maps).toEqual([]);
      expect(fakeIntegration.describeMatch(config)).toEqual(described);
    }
  });

  test('round-trips a roster', () => {
    const described = fakeIntegration.describeMatch({
      game: 'fake',
      slug: 'r1m1',
      seriesLength: 3,
      team1: { id: 'a', name: 'Alpha', players: [{ id: 'p1', name: 'One' }] },
      team2: { id: 'b', name: 'Bravo', players: [{ id: 'p2', name: 'Two' }] },
    });
    expect(described).toEqual({
      seriesLength: 3,
      maps: [],
      team1: {
        id: 'a',
        name: 'Alpha',
        players: [{ account: { provider: 'player', externalId: 'p1' }, name: 'One' }],
      },
      team2: {
        id: 'b',
        name: 'Bravo',
        players: [{ account: { provider: 'player', externalId: 'p2' }, name: 'Two' }],
      },
    });
  });

  test('cancel and release are safe to call twice', async () => {
    const ctx = ctxFor(fakeIntegration);
    for (let i = 0; i < 2; i++) {
      await expect(fakeIntegration.cancel!(ctx, 'force-cancel')).resolves.toBeUndefined();
      await expect(fakeIntegration.release!(ctx)).resolves.toBeUndefined();
    }
  });

  test('stays out of the game catalogue and needs no game account', () => {
    expect(fakeIntegration.catalog).toBeNull();
    expect(fakeIntegration.accountProvider).toBeUndefined();
  });

  test('is registered only in test runs, never by a production process alone', () => {
    const on = (env: Record<string, string>) =>
      isFakeIntegrationEnabled(env as unknown as NodeJS.ProcessEnv);
    expect(on({})).toBe(false);
    expect(on({ NODE_ENV: 'production' })).toBe(false);
    expect(on({ NODE_ENV: 'development' })).toBe(false);
    expect(on({ NODE_ENV: 'test' })).toBe(true);
    expect(on({ MAT_TEST_INTEGRATION: '1' })).toBe(true);
    expect(on({ NODE_ENV: 'development', MAT_TEST_INTEGRATION: 'true' })).toBe(true);
    expect(on({ MAT_TEST_INTEGRATION: '0' })).toBe(false);
    // A production process needs the E2E test endpoints on as well.
    expect(on({ NODE_ENV: 'production', MAT_TEST_INTEGRATION: '1' })).toBe(false);
    expect(on({ NODE_ENV: 'production', ENABLE_TEST_ENDPOINTS: 'true' })).toBe(false);
    expect(
      on({ NODE_ENV: 'production', MAT_TEST_INTEGRATION: '1', ENABLE_TEST_ENDPOINTS: 'true' })
    ).toBe(true);
  });
});
