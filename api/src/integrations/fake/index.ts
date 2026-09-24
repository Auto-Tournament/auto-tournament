/**
 * Fake game integration: test-only.
 *
 * Proves that the core runs a tournament end to end with no CS2 code on the
 * path: create, start, allocate, results, bracket progression. It has no
 * servers (`capacity` is unlimited and `allocate` assigns at once), no veto,
 * no live events, no demos and no player stats. Results come in as
 * `NormalizedEvent[]` through a test-only route (./routes), straight into the
 * core's `matchLifecycle.ingest`.
 *
 * It is registered only in test runs (see `isFakeIntegrationEnabled`), never
 * in a production deployment, and it stays out of the game catalogue.
 *
 * Like CS2, services are imported lazily inside each method so that loading
 * the registry stays free of side effects and import cycles.
 */

import type {
  AllocateResult,
  BuildMatchConfigContext,
  GameIntegration,
  MatchContext,
  MatchDescription,
  MatchDescriptionTeam,
  ResourceActionResult,
  StatsSchema,
} from '../types';

export const FAKE_GAME_ID = 'fake';

/** The `matches.config` blob the fake integration stores. */
export interface FakeMatchConfig {
  game: typeof FAKE_GAME_ID;
  slug: string;
  seriesLength: number;
  team1: FakeTeam;
  team2: FakeTeam;
}

interface FakeTeam {
  id?: string;
  name: string;
  /** `players.id` of each rostered player. */
  players: Array<{ id: string; name: string }>;
}

const FAKE_STATS_SCHEMA: StatsSchema = { metrics: [] };

function isOn(value: string | undefined): boolean {
  const v = (value || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Whether the fake integration is registered: under `NODE_ENV=test`, or with
 * `MAT_TEST_INTEGRATION=1`. A production process (`NODE_ENV=production`) also
 * needs the E2E test endpoints on (`ENABLE_TEST_ENDPOINTS`), the switch the CI
 * stack already sets, so a real deployment never gets it by one stray
 * variable.
 */
export function isFakeIntegrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'test') return true;
  if (!isOn(env.MAT_TEST_INTEGRATION)) return false;
  if (env.NODE_ENV === 'production') return isOn(env.ENABLE_TEST_ENDPOINTS);
  return true;
}

/** 'bo3' -> 3; anything unreadable is a single game. */
function seriesLengthOf(format: string | undefined): number {
  const n = Number(/^bo(\d+)$/i.exec(format ?? '')?.[1]);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

async function readTeam(teamId: string | undefined): Promise<FakeTeam> {
  if (!teamId) return { name: '', players: [] };
  const { db } = await import('../../config/database');
  const row = await db.queryOneAsync<{ id: string; name: string; players: string | null }>(
    'SELECT id, name, players FROM teams WHERE id = ?',
    [teamId]
  );
  if (!row) return { id: teamId, name: '', players: [] };
  const players: FakeTeam['players'] = [];
  try {
    const parsed: unknown = JSON.parse(row.players || '[]');
    const list = parsed && typeof parsed === 'object' ? Object.values(parsed) : [];
    for (const p of list) {
      const player = p as { steamId?: unknown; id?: unknown; name?: unknown };
      const id = typeof player.steamId === 'string' ? player.steamId : player.id;
      if (typeof id === 'string' && id) {
        players.push({ id, name: typeof player.name === 'string' ? player.name : '' });
      }
    }
  } catch {
    // An unreadable roster describes as empty.
  }
  return { id: row.id, name: row.name, players };
}

function parseConfig(config: unknown): Partial<FakeMatchConfig> {
  let value = config;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<FakeMatchConfig>)
    : {};
}

function describeTeam(team: Partial<FakeTeam> | undefined): MatchDescriptionTeam {
  const players = Array.isArray(team?.players) ? team.players : [];
  return {
    ...(typeof team?.id === 'string' ? { id: team.id } : {}),
    name: typeof team?.name === 'string' ? team.name : '',
    players: players
      .filter((p) => p && typeof p.id === 'string')
      .map((p) => ({ account: { provider: 'player', externalId: p.id }, name: p.name ?? '' })),
  };
}

const done = (message: string): ResourceActionResult => ({ ok: true, message });

/** Put a ready match straight into `loaded`: there is no server to load it on. */
async function markLoaded(ctx: MatchContext): Promise<AllocateResult> {
  const { db } = await import('../../config/database');
  await db.runAsync(
    "UPDATE matches SET status = 'loaded', loaded_at = ? WHERE slug = ? AND status = 'ready'",
    [Math.floor(Date.now() / 1000), ctx.slug]
  );
  return { status: 'assigned' };
}

export const fakeIntegration: GameIntegration = {
  id: FAKE_GAME_ID,
  displayName: 'Fake game (tests)',
  catalog: null,
  capabilities: {
    servers: false,
    veto: false,
    liveEvents: false,
    demos: false,
    playerStats: false,
  },

  statsSchema: () => FAKE_STATS_SCHEMA,
  setupSchema: { instance: { type: 'object', properties: {} } },
  instanceSettings: [],

  // One harmless table, so the E2E suite sees a module's migrations run on
  // boot and again after each wipe (tests/api/module-migrations-db.spec.ts).
  // Nothing reads it, and this module only exists in test runs.
  migrations: [
    {
      id: '0001-migration-probe',
      up: `CREATE TABLE fake_migration_probe (
             id INTEGER PRIMARY KEY,
             note TEXT NOT NULL
           );
           INSERT INTO fake_migration_probe (id, note) VALUES (1, 'module migrations ran');`,
    },
  ],

  async buildMatchConfig(ctx: BuildMatchConfigContext): Promise<FakeMatchConfig> {
    const standalone = parseConfig(ctx.settings);
    const seriesLength = ctx.tournament
      ? seriesLengthOf(ctx.tournament.format)
      : typeof standalone.seriesLength === 'number' && standalone.seriesLength > 0
        ? standalone.seriesLength
        : 1;
    const [team1, team2] = await Promise.all([readTeam(ctx.team1?.id), readTeam(ctx.team2?.id)]);
    return { game: FAKE_GAME_ID, slug: ctx.slug, seriesLength, team1, team2 };
  },

  describeMatch(config: unknown): MatchDescription {
    const cfg = parseConfig(config);
    const seriesLength =
      typeof cfg.seriesLength === 'number' && cfg.seriesLength > 0 ? cfg.seriesLength : 1;
    return {
      seriesLength,
      maps: [],
      team1: describeTeam(cfg.team1),
      team2: describeTeam(cfg.team2),
    };
  },

  async capacity(): Promise<number | null> {
    return null;
  },

  allocate(ctx: MatchContext): Promise<AllocateResult> {
    return markLoaded(ctx);
  },

  async restart(): Promise<ResourceActionResult> {
    return done('Fake match restarted');
  },

  async load(ctx: MatchContext): Promise<ResourceActionResult> {
    await markLoaded(ctx);
    return done('Fake match loaded');
  },

  async cancel(): Promise<void> {
    // Nothing runs anywhere, so there is nothing to stop.
  },

  async release(): Promise<void> {
    // No resource to free.
  },

  legacyRoutes() {
    // Required here, not at the top: loading the registry must not load routers.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fakeEventRoutes } = require('./routes') as typeof import('./routes');
    return [
      {
        prefix: '/api/test/integration/fake',
        router: fakeEventRoutes,
        title: 'Test helpers (fake integration)',
        description:
          'Test-only: create a tournament for the fake game and post NormalizedEvents for its matches. Registered only in test runs.',
        // Out of the API reference and the OpenAPI spec: this integration is
        // only registered in test runs, so the generated docs must not depend
        // on whether it was.
        testOnly: true,
      },
    ];
  },
};
